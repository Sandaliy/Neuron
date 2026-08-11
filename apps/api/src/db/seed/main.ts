import process from 'node:process';

import {
  DEFAULT_SCHEDULER_CONFIG,
  createSchedulerConfig,
  createSeededRandom,
  newCard,
  review,
} from '@neuron/core';
import type { RandomSource, Rating, ReviewLog, SchedulerConfig, SchedulingState, CardDirection  } from '@neuron/core';

import { createDb } from '../client.js';
import { createRepositories } from '../repositories/index.js';
import { stableId } from '../stable-id.js';
import { installSystemNoteTypes } from '../system-note-types.js';
import { describeConnection, requireUrl, withPool } from '../tooling.js';

import {
  BASIC_NOTES,
  CLOZE_NOTES,
  ENGLISH_WORDS,
  GERMAN_LESSON_ONE,
  GERMAN_LESSON_TWO,
} from './data.js';

import type { GermanWord } from './data.js';
import type { CreateCard } from '../repositories/cards.js';
import type { Repositories } from '../repositories/index.js';

/**
 * Fills the database with a collection worth looking at.
 *
 * Everything it writes belongs to one fixed user. It starts by erasing that
 * user and writing the whole collection again, so running it twice leaves the
 * same thing rather than two copies of it, and it can never touch a row it did
 * not create.
 *
 * The review history is generated first, and the state of each card is then
 * whatever the scheduler produced while generating it. Nothing here invents a
 * stability or a due date. That is what makes the round trip test in
 * seed.test.ts meaningful: it reads the log back out of the database, replays
 * it, and expects the card row to match to the last digit.
 */

const DEMO_USER_ID = 'seed-demo-user';
const DEMO_EMAIL = 'demo@neuron.local';
const HISTORY_DAYS = 90;
const MS_PER_DAY = 86_400_000;

/**
 * A stable id for a seeded row.
 *
 * Derived from a name rather than generated, so that a second run produces the
 * same collection down to the identifiers.
 *
 * @param key what the row is
 * @returns the id
 */
function seedId(key: string): string {
  return stableId(`seed:${key}`);
}

/** How long an answer of each kind takes, in milliseconds. */
const ANSWER_MS: Record<CardDirection, number> = {
  recognition: 4200,
  recall: 6400,
  production: 12_500,
  cloze: 9800,
  listening: 6000,
};

/**
 * Picks an answer.
 *
 * Weighted the way a person who knows most of their deck answers: mostly Good,
 * a tenth of the time Again. Numbers close to the prior the forecast uses.
 *
 * @param rng the seeded generator
 * @returns the rating
 */
function pickRating(rng: RandomSource): Rating {
  const draw = rng();

  if (draw < 0.1) {
    return 1;
  }

  if (draw < 0.25) {
    return 2;
  }

  return draw < 0.92 ? 3 : 4;
}

interface StudiedCard {
  readonly logs: readonly ReviewLog[];
  readonly state: SchedulingState;
}

/**
 * How much history a card has behind it.
 *
 * Four kinds, because a collection where every card is in the same state does
 * not tell you whether the states work. `fresh` was started minutes ago and is
 * still walking its learning steps. `lapsed` was going fine until the last
 * answer, and is now in relearning.
 */
type HistoryKind = 'none' | 'settled' | 'fresh' | 'lapsed';

/**
 * Answers one card over and over, from its first day until now.
 *
 * @param startedAt when the card was first seen
 * @param until the moment the history stops, which is now
 * @param direction which kind of card, for how long answers take
 * @param config the scheduler settings
 * @param rng the seeded generator
 * @param endOnLapse whether to finish with a forgotten answer
 * @returns the log it produced and the state it ended in
 */
function studyCard(
  startedAt: Date,
  until: Date,
  direction: CardDirection,
  config: SchedulerConfig,
  rng: RandomSource,
  endOnLapse = false,
): StudiedCard {
  const logs: ReviewLog[] = [];
  let state: SchedulingState = newCard(startedAt);
  let at = startedAt;

  // A card in learning comes back in minutes, so a ninety day window holds a
  // lot of steps. The cap is a guard against a pathological sequence, not an
  // expected outcome.
  for (let answered = 0; answered < 80; answered += 1) {
    if (at.getTime() > until.getTime()) {
      break;
    }

    const rating = pickRating(rng);
    const outcome = review(state, rating, at, config, rng, ANSWER_MS[direction]);

    logs.push(outcome.log);
    state = outcome.next;

    // People answer a few hours after a card falls due rather than at midnight.
    at = new Date(state.due.getTime() + Math.floor(rng() * 6 * 3_600_000));
  }

  // A card that has just been forgotten, so the collection has something in
  // relearning to look at. Half an hour ago, which is recent enough that the
  // card is still on its relearning step now.
  if (endOnLapse && state.state !== 'new') {
    const outcome = review(
      state,
      1,
      new Date(until.getTime() - 30 * 60_000),
      config,
      rng,
      ANSWER_MS[direction],
    );

    logs.push(outcome.log);
    state = outcome.next;
  }

  return { logs, state };
}

/** A vocab note built from one of the word lists. */
function vocabFields(word: GermanWord) {
  return {
    term: word.article ? `${word.article} ${word.term}` : word.term,
    translation: word.translation,
    partOfSpeech: word.partOfSpeech,
    ...(word.example === undefined ? {} : { example: word.example }),
    ...(word.article === undefined && word.plural === undefined
      ? {}
      : {
          grammar: {
            ...(word.article === undefined ? {} : { article: word.article }),
            ...(word.plural === undefined ? {} : { plural: word.plural }),
          },
        }),
  };
}

/**
 * Puts the three built in note types in place.
 *
 * They belong to nobody and are shared by every account, so they are written by
 * the owner: the isolation policy on that table lets everyone read a row with
 * no owner and lets nobody write one.
 *
 * @param ownerUrl the owner connection
 */
async function ensureNoteTypes(ownerUrl: string): Promise<void> {
  await withPool(ownerUrl, installSystemNoteTypes);
}

/**
 * Erases the demo user and puts an empty one back.
 *
 * The cascade reaches everything the previous run wrote, review log included,
 * which is the one case where removing a review row is legitimate. It says so
 * by setting the flag the trigger looks for.
 *
 * @param ownerUrl the owner connection
 */
async function resetDemoUser(ownerUrl: string): Promise<void> {
  await withPool(ownerUrl, async (pool) => {
    const connection = await pool.connect();

    try {
      await connection.query('begin');
      await connection.query("select set_config('app.erasing_account', 'on', true)");
      await connection.query('delete from "user" where id = $1', [DEMO_USER_ID]);
      await connection.query(
        `insert into "user" (id, name, email, email_verified, timezone, day_cutoff_hour, locale, theme, settings)
         values ($1, $2, $3, true, $4, 4, 'ru', 'dark', $5)`,
        [
          DEMO_USER_ID,
          'Demo',
          DEMO_EMAIL,
          'Europe/Moscow',
          JSON.stringify({ budgetMinutes: [30, 15, 15, 15, 15, 15, 30], targetRetention: 0.9 }),
        ],
      );
      await connection.query('commit');
    } catch (error) {
      await connection.query('rollback');
      throw error;
    } finally {
      connection.release();
    }
  });
}

/** A card the seed intends to write. The id is always known here. */
interface PlannedCard extends Omit<CreateCard, 'id'> {
  readonly id: string;
  readonly history: HistoryKind;
}

/**
 * Writes the whole collection as the demo user, through the repositories.
 *
 * Through the repositories rather than through raw statements on purpose: it
 * exercises the path the api will use, including the isolation policies, so a
 * seed that runs is also evidence that the layer works.
 *
 * @param repositories the demo user's repositories
 * @param now the moment the history ends
 * @returns what was written
 */
async function writeCollection(repositories: Repositories, now: Date) {
  const config = createSchedulerConfig({
    ...DEFAULT_SCHEDULER_CONFIG,
    timezone: 'Europe/Moscow',
    dayCutoffHour: 4,
  });
  const rng = createSeededRandom(20_260_811);
  const historyStart = new Date(now.getTime() - HISTORY_DAYS * MS_PER_DAY);

  const german = await repositories.decks.create({
    id: seedId('deck:german'),
    name: 'German',
    settings: { budgetMinutes: [30, 20, 20, 20, 20, 20, 45] },
  });
  const textbook = await repositories.decks.create({
    id: seedId('deck:german/textbook'),
    name: 'Textbook',
    parentId: german.id,
  });
  const lessonOne = await repositories.decks.create({
    id: seedId('deck:german/textbook/lesson-1'),
    name: 'Lesson 1',
    parentId: textbook.id,
  });
  const lessonTwo = await repositories.decks.create({
    id: seedId('deck:german/textbook/lesson-2'),
    name: 'Lesson 2',
    parentId: textbook.id,
  });
  const english = await repositories.decks.create({
    id: seedId('deck:english'),
    name: 'English',
    settings: { maximumNewCardsPerDay: 15 },
  });
  const oxford = await repositories.decks.create({
    id: seedId('deck:english/oxford'),
    name: 'Oxford 5000',
    parentId: english.id,
  });
  const theory = await repositories.decks.create({ id: seedId('deck:theory'), name: 'Theory' });

  const batch = await repositories.importBatches.create({
    id: seedId('import:oxford'),
    deckId: oxford.id,
    source: 'Oxford 5000, frequency list',
    format: 'csv',
    noteCount: ENGLISH_WORDS.length,
  });

  await repositories.presets.create({
    id: seedId('preset:reading'),
    name: 'Reading practice',
    isDefault: true,
    config: { directions: ['recognition'], answer: 'buttons', audio: false },
  });

  const planned: PlannedCard[] = [];

  async function addVocab(
    deckId: string,
    words: readonly GermanWord[],
    keyPrefix: string,
    plan: (index: number) => readonly { direction: CardDirection; history: HistoryKind }[],
    extra: { readonly source?: string; readonly rank?: (index: number) => number; readonly batchId?: string } = {},
  ) {
    const notes = await repositories.notes.createMany(
      words.map((word, index) => ({
        id: seedId(`note:${keyPrefix}:${word.term}`),
        deckId,
        noteType: 'vocab' as const,
        fields: vocabFields(word),
        tags: [word.partOfSpeech],
        ...(extra.source === undefined ? {} : { source: extra.source }),
        ...(extra.rank === undefined ? {} : { rank: extra.rank(index) }),
        ...(extra.batchId === undefined ? {} : { importBatchId: extra.batchId }),
      })),
    );

    notes.forEach((note, index) => {
      for (const { direction, history } of plan(index)) {
        planned.push({
          id: seedId(`card:${keyPrefix}:${index}:${direction}`),
          noteId: note.id,
          direction,
          due: now,
          unlockedAt:
            direction === 'recognition' ? historyStart : new Date(now.getTime() - 20 * MS_PER_DAY),
          history,
        });
      }
    });
  }

  // Lesson 1 is the one that has been studied for a while: every word has a
  // recognition card, and the first half have earned a recall card too. The
  // last two are the ones caught mid learning and mid relearning.
  await addVocab(lessonOne.id, GERMAN_LESSON_ONE, 'de1', (index) => {
    if (index < 15) {
      return [
        { direction: 'recognition', history: 'settled' },
        { direction: 'recall', history: 'settled' },
      ];
    }

    if (index === 28) {
      return [{ direction: 'recognition', history: 'fresh' }];
    }

    if (index === 29) {
      return [{ direction: 'recognition', history: 'lapsed' }];
    }

    return [{ direction: 'recognition', history: 'settled' }];
  });

  // Lesson 2 was started recently, so half of it has never been seen.
  await addVocab(lessonTwo.id, GERMAN_LESSON_TWO, 'de2', (index) => {
    if (index === 13) {
      return [{ direction: 'recognition', history: 'fresh' }];
    }

    if (index === 14) {
      return [{ direction: 'recognition', history: 'lapsed' }];
    }

    return [{ direction: 'recognition', history: index < 15 ? 'settled' : 'none' }];
  });

  await addVocab(
    oxford.id,
    ENGLISH_WORDS.map((word) => ({
      term: word.term,
      translation: word.translation,
      partOfSpeech: word.partOfSpeech,
    })),
    'en',
    (index) => {
      if (index < 20) {
        return [
          { direction: 'recognition' as const, history: 'settled' as const },
          ...(index < 5
            ? [{ direction: 'production' as const, history: 'settled' as const }]
            : []),
        ];
      }

      if (index === 20) {
        return [{ direction: 'recognition', history: 'fresh' }];
      }

      return [{ direction: 'recognition', history: 'none' }];
    },
    {
      source: 'Oxford 5000',
      rank: (index) => ENGLISH_WORDS[index]?.rank ?? 0,
      batchId: batch.id,
    },
  );

  const basics = await repositories.notes.createMany(
    BASIC_NOTES.map((note, index) => ({
      id: seedId(`note:basic:${index}`),
      deckId: theory.id,
      noteType: 'basic' as const,
      fields: { front: note.front, back: note.back },
      tags: ['theory'],
    })),
  );

  basics.forEach((note, index) => {
    planned.push({
      id: seedId(`card:basic:${index}:recognition`),
      noteId: note.id,
      direction: 'recognition',
      due: now,
      unlockedAt: historyStart,
      history: index < 3 ? 'settled' : 'none',
    });
  });

  const clozes = await repositories.notes.createMany(
    CLOZE_NOTES.map((note, index) => ({
      id: seedId(`note:cloze:${index}`),
      deckId: theory.id,
      noteType: 'cloze' as const,
      fields: { text: note.text },
      tags: ['theory'],
    })),
  );

  clozes.forEach((note, index) => {
    planned.push({
      id: seedId(`card:cloze:${index}:cloze`),
      noteId: note.id,
      direction: 'cloze',
      due: now,
      unlockedAt: historyStart,
      history: index < 2 ? 'settled' : 'none',
    });
  });

  // One word the person already knew when they imported the list. It keeps its
  // note so it can come back into rotation, and it has no cards at all.
  await repositories.notes.create({
    id: seedId('note:known'),
    deckId: oxford.id,
    noteType: 'vocab',
    fields: { term: 'result', translation: 'результат', partOfSpeech: 'noun' },
    source: 'Oxford 5000',
    rank: 388,
    status: 'known',
    importBatchId: batch.id,
  });

  // One set aside for now, which is a different thing from deleted.
  await repositories.notes.create({
    id: seedId('note:suspended'),
    deckId: lessonTwo.id,
    noteType: 'vocab',
    fields: { term: 'die Verjährung', translation: 'statute of limitations', partOfSpeech: 'noun' },
    status: 'suspended',
  });

  // Every card is created first, then the studied ones are answered. Doing it
  // in that order means the log is written against a card that already exists,
  // which is the same order the application will use.
  const histories = new Map<string, StudiedCard>();
  const toCreate: CreateCard[] = [];

  for (const card of planned) {
    if (card.history === 'none') {
      toCreate.push({
        id: card.id,
        noteId: card.noteId,
        direction: card.direction,
        due: card.due,
        ...(card.unlockedAt === undefined ? {} : { unlockedAt: card.unlockedAt }),
      });
      continue;
    }

    // A card started twenty minutes ago has not finished its learning steps, so
    // it is still in learning when the seed stops.
    const startedAt =
      card.history === 'fresh'
        ? new Date(now.getTime() - 20 * 60_000)
        : new Date(historyStart.getTime() + Math.floor(rng() * 30) * MS_PER_DAY);

    const history = studyCard(
      startedAt,
      now,
      card.direction,
      config,
      rng,
      card.history === 'lapsed',
    );

    histories.set(card.id, history);
    toCreate.push({
      id: card.id,
      noteId: card.noteId,
      direction: card.direction,
      due: history.state.due,
      scheduling: history.state,
      ...(card.unlockedAt === undefined ? {} : { unlockedAt: card.unlockedAt }),
    });
  }

  const written = await repositories.cards.createMany(toCreate);

  const entries = [...histories].flatMap(([cardId, history]) =>
    history.logs.map((log) => ({ cardId, log })),
  );

  const reviewCount = await repositories.reviews.append(entries);

  return { cards: written.length, reviews: reviewCount, config };
}

/** Where a seed run should write. */
export interface SeedTarget {
  /** The owner, needed for the shared note types and for erasing the user. */
  readonly ownerUrl: string;
  /** The restricted role, which writes the collection itself. */
  readonly appUrl: string;
  /** Silences the summary, for the tests that call this in a loop. */
  readonly quiet?: boolean;
}

/**
 * Writes the demo collection into a database.
 *
 * Taking the connections as arguments rather than reading the environment is
 * what lets the tests run this against the throwaway database. A seed that
 * could only ever write to whatever DATABASE_URL happened to hold would be a
 * seed nobody could safely test.
 *
 * @param target where to write
 * @returns how many cards and reviews were written
 */
export async function runSeed(target: SeedTarget): Promise<{ cards: number; reviews: number }> {
  await ensureNoteTypes(target.ownerUrl);
  await resetDemoUser(target.ownerUrl);

  const repositories = createRepositories(createDb(target.appUrl), DEMO_USER_ID);
  const written = await writeCollection(repositories, new Date());

  return { cards: written.cards, reviews: written.reviews };
}

async function main(): Promise<void> {
  const ownerUrl = requireUrl(
    'DATABASE_URL_OWNER',
    'The seed needs the owner in order to write the shared note types and to erase its own user.',
  );
  const appUrl = requireUrl(
    'DATABASE_URL',
    'The seed writes its collection through the same restricted role the api uses.',
  );

  console.log(`seeding ${describeConnection(appUrl)}`);

  const written = await runSeed({ ownerUrl, appUrl });

  await withPool(ownerUrl, async (pool) => {
    const counts = await pool.query<{ table: string; n: number }>(
      `select 'decks' as table, count(*)::int as n from decks where user_id = $1
       union all select 'notes', count(*)::int from notes where user_id = $1
       union all select 'cards', count(*)::int from cards where user_id = $1
       union all select 'reviews', count(*)::int from reviews where user_id = $1
       union all select 'study_presets', count(*)::int from study_presets where user_id = $1
       union all select 'import_batches', count(*)::int from import_batches where user_id = $1`,
      [DEMO_USER_ID],
    );

    console.log(`user ${DEMO_EMAIL}`);

    for (const row of counts.rows) {
      console.log(`  ${row.table.padEnd(15)} ${row.n}`);
    }

    const states = await pool.query<{ state: string; n: number }>(
      'select state, count(*)::int as n from cards where user_id = $1 group by state order by 1',
      [DEMO_USER_ID],
    );

    console.log(`  card states: ${states.rows.map((row) => `${row.state} ${row.n}`).join(', ')}`);
  });

  console.log(`wrote ${written.cards} cards and ${written.reviews} reviews`);
}

/** The fixed identity the seed owns, exported so the tests can find it. */
export { DEMO_EMAIL, DEMO_USER_ID, seedId };

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/'))) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  });
}

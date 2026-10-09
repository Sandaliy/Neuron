import { Hono } from 'hono';

import {
  availableForDailyStudy,
  dailyStudyAvailableAt,
  studyDayAnswers,
  buildSession,
  createBudget,
  createSchedulerConfig,
  createSeededRandom,
  createWorkloadConfig,
  dayIndexOf,
  forecast,
} from '@neuron/core';
import type { WorkloadCard } from '@neuron/core';
import {
  createImportSchema,
  createPresetSchema,
  dailyStudySessionRequestSchema,
  idParamSchema,
  importChunkSchema,
  openingCards,
  resolveDeckSettings,
  studyDecks,
  updatePresetSchema,
} from '@neuron/shared';
import type { DeckSettings, NoteFields, NoteStatus, NoteTypeName } from '@neuron/shared';

import { repositoriesOf } from '../context.js';
import { toSchedulingState } from '../db/repositories/index.js';
import { ApiError } from '../errors.js';
import { settingsForDeck } from '../note-cards.js';
import {
  serialiseCard,
  serialiseImportBatch,
  serialisePreset,
  serialiseNote,
} from '../serialise.js';
import { readBody, readParams } from '../validation.js';

import { parseFields } from './notes.js';

import type { RequestBindings } from '../context.js';
import type { Repositories } from '../db/repositories/index.js';

/** Builds a Daily Study plan without persisting a session or changing settings. */
export function dailyStudyRoutes(): Hono<RequestBindings> {
  const routes = new Hono<RequestBindings>();

  routes.post('/session', async (context) => {
    const body = await readBody(context, dailyStudySessionRequestSchema);
    const started = performance.now();
    // Share one user-bound transaction instead of repeating BEGIN, identity and
    // COMMIT for every read. The restricted role and all repository filters stay.
    const result = await repositoriesOf(context).transaction(async (repositories) => {
      const [account, collections, allLogs, typeNames] = await Promise.all([
        repositories.account.read(),
        repositories.decks.list(),
        repositories.reviews.workload(),
        repositories.noteTypes.namesById(),
      ]);
      const deckChain: DeckSettings[] = [];

      if (body.deckId !== undefined) {
        if (!(await repositories.decks.byId(body.deckId))) {
          throw new ApiError('not_found');
        }

        deckChain.push(
          ...(await repositories.decks.chain(body.deckId)).map(
            (deck) => (deck.settings ?? {}) as DeckSettings,
          ),
        );
      }

      const settings = resolveDeckSettings([account.settings, ...deckChain]);
      const scheduler = createSchedulerConfig({
        timezone: account.timezone,
        dayCutoffHour: account.dayCutoffHour,
        desiredRetention: settings.targetRetention,
      });
      const budget = createBudget({
        minutesByWeekday: settings.budgetMinutes,
        allowCarryOver: settings.allowCarryOver,
      });
      const config = createWorkloadConfig({
        scheduler,
        budget,
        maximumNewCardsPerDay: settings.maximumNewCardsPerDay,
      });
      const now = new Date();
      const liveDecks = studyDecks(collections);
      let scope = body.deckIds;
      if (body.deckId !== undefined) {
        const subtree = new Set(
          (await repositories.decks.subtree(body.deckId)).map((deck) => deck.id),
        );
        scope = liveDecks.filter((deck) => subtree.has(deck.id)).map((deck) => deck.id);
      }
      if (scope?.some((id) => !liveDecks.some((deck) => deck.id === id)))
        throw new ApiError('not_found');
      const scopeDeckIds = [
        ...new Set(
          scope ??
            liveDecks
              .filter((deck) => deck.settings?.dailyStudyIncluded !== false)
              .map((deck) => deck.id),
        ),
      ].sort();
      const selected = new Set(scopeDeckIds);
      const rows = await repositories.cards.forSession({ deckIds: scopeDeckIds });
      const cards: WorkloadCard[] = rows.map((row) => ({
        id: row.id,
        deckId: row.deckId,
        noteId: row.noteId,
        direction: row.direction as WorkloadCard['direction'],
        scheduling: toSchedulingState(row),
      }));
      const readAt = performance.now();
      const languageByDeck = new Map(
        scopeDeckIds.map((id) => {
          const chain: DeckSettings[] = [];
          let deck = collections.find((item) => item.id === id);
          const seen = new Set<string>();
          while (deck && !seen.has(deck.id)) {
            seen.add(deck.id);
            chain.unshift((deck.settings ?? {}) as DeckSettings);
            deck = collections.find((item) => item.id === deck!.parentId);
          }
          return [
            id,
            resolveDeckSettings([account.settings, ...chain]).targetLanguage ?? null,
          ] as const;
        }),
      );
      const languages = [...new Set(languageByDeck.values())].sort((a, b) =>
        (a ?? '').localeCompare(b ?? ''),
      );
      const targetLanguage =
        body.targetLanguage === undefined ? (languages[0] ?? null) : body.targetLanguage;
      const sessionDeckIds = scopeDeckIds.filter((id) => languageByDeck.get(id) === targetLanguage);
      const supported = cards.filter(
        (card) =>
          sessionDeckIds.includes(card.deckId!) &&
          (body.direction === undefined || card.direction === body.direction),
      );
      const logs = allLogs.filter(
        (log) => scope === undefined || (log.deckId !== undefined && selected.has(log.deckId)),
      );
      const answers = studyDayAnswers(cards, logs, now, scheduler);
      const available = (card: WorkloadCard) =>
        availableForDailyStudy(card, answers, now, scheduler);
      const nextAt = (card: WorkloadCard) => dailyStudyAvailableAt(card, answers, now, scheduler);
      const future = (pool: readonly WorkloadCard[]) =>
        pool
          .filter(
            (card) =>
              !available(card) &&
              (card.scheduling.state !== 'new' || answers.notes.has(card.noteId)),
          )
          .map((card) => nextAt(card).toISOString())
          .sort()[0] ?? null;
      // Language and skill never own a copy of the account's automatic allowance.
      // Explicit temporary Deck scope retains its existing workload universe.
      const load = forecast({ cards, config, now, logs });
      const sharedRequest = {
        budget,
        config,
        now,
        logs,
        answers,
        load,
        ...(body.minutes === undefined ? {} : { oneOffMinutes: body.minutes }),
        newCardMode: body.newCards,
      };
      const seed = sessionSeed(account.id, scopeDeckIds.join(','), dayIndexOf(now, scheduler));
      const aggregate = buildSession({ ...sharedRequest, cards, rng: createSeededRandom(seed) });
      const session = buildSession({
        ...sharedRequest,
        cards: supported,
        backlog: aggregate.backlog,
        automaticNewCardLimit: aggregate.newCount,
        rng: createSeededRandom(seed),
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      const plannedAt = performance.now();
      const notes = await repositories.notes.byIds(session.cards.map((card) => card.noteId));
      context.header(
        'Server-Timing',
        `study_read;dur=${(readAt - started).toFixed(1)}, study_plan;dur=${(plannedAt - readAt).toFixed(1)}, study_notes;dur=${(performance.now() - plannedAt).toFixed(1)}`,
        { append: true },
      );

      return {
        ...session,
        planningContext: { accountId: account.id, revision: account.currentRev },
        scopeDeckIds: sessionDeckIds,
        targetLanguage,
        languages,
        aggregateReady: aggregate.cards.length,
        deckSummaries: sessionDeckIds.map((deckId) => {
          const pool = supported.filter((card) => card.deckId === deckId);
          return {
            deckId,
            due: pool.filter((card) => card.scheduling.state !== 'new' && available(card)).length,
            fresh: pool.filter((card) => card.scheduling.state === 'new' && available(card)).length,
            nextDue: future(pool),
          };
        }),
        availableCount: supported.filter(available).length,
        nextDue: future(supported),
        notes: notes.map((note) => serialiseNote(note, typeNames)),
        cards: session.cards.flatMap((card) => {
          const row = byId.get(card.id);
          return row === undefined ? [] : [serialiseCard(row)];
        }),
      };
    });
    context.header('Server-Timing', `study_total;dur=${(performance.now() - started).toFixed(1)}`, {
      append: true,
    });
    return context.json(result);
  });

  return routes;
}

/** Stable per-user, per-scope, per-calendar-day seed for review tie breaking. */
function sessionSeed(userId: string, deckId: string | undefined, day: number): number {
  let seed = 0;

  for (const character of `${userId}:${deckId ?? 'all'}:${day}`) {
    seed = (Math.imul(seed, 31) + character.charCodeAt(0)) | 0;
  }

  return seed >>> 0;
}

/** Saved ways of studying. */
export function presetRoutes(): Hono<RequestBindings> {
  const routes = new Hono<RequestBindings>();

  routes.get('/', async (context) => {
    const presets = await repositoriesOf(context).presets.list();

    return context.json({ presets: presets.map(serialisePreset) });
  });

  routes.post('/', async (context) => {
    const body = await readBody(context, createPresetSchema);
    const preset = await repositoriesOf(context).presets.create({
      ...(body.id === undefined ? {} : { id: body.id }),
      name: body.name,
      deckId: body.deckId ?? null,
      config: body.config,
      ...(body.isDefault === undefined ? {} : { isDefault: body.isDefault }),
    });

    return context.json({ preset: serialisePreset(preset) }, 201);
  });

  routes.patch('/:id', async (context) => {
    const { id } = readParams(context, idParamSchema);
    const body = await readBody(context, updatePresetSchema);
    const preset = await repositoriesOf(context).presets.update(id, body);

    if (!preset) {
      throw new ApiError('not_found');
    }

    return context.json({ preset: serialisePreset(preset) });
  });

  routes.delete('/:id', async (context) => {
    const { id } = readParams(context, idParamSchema);

    if (!(await repositoriesOf(context).presets.softDelete(id))) {
      throw new ApiError('not_found');
    }

    return context.json({ deleted: true });
  });

  return routes;
}

/**
 * Imports, which exist so that a bad one can be taken back in one action.
 *
 * Five hundred badly generated cards is a normal thing to do once. Picking them
 * out of a deck by hand afterwards is not, so every imported note points back
 * at the batch it arrived in and the undo follows that pointer.
 *
 * A large list arrives in chunks. The batch is created first and the notes are
 * sent against it a few hundred at a time, because five thousand rows do not
 * fit in one serverless invocation and a phone on a train does not hold one
 * connection open long enough to try. Every note in a chunk carries an id the
 * client generated, which is what makes sending the same chunk twice write
 * nothing the second time.
 */
export function importRoutes(): Hono<RequestBindings> {
  const routes = new Hono<RequestBindings>();

  routes.get('/', async (context) => {
    const batches = await repositoriesOf(context).importBatches.list();

    return context.json({ imports: batches.map(serialiseImportBatch) });
  });

  routes.post('/', async (context) => {
    const body = await readBody(context, createImportSchema);
    const repositories = repositoriesOf(context);

    // Every field checked before anything is written, so a bad row two thirds
    // of the way down does not leave two thirds of an import behind.
    const parsed = (body.notes ?? []).map((note) => ({
      ...note,
      fields: parseFields(note.noteType, note.fields),
    }));

    const written = await repositories.transaction(async (inner) => {
      const batch = await inner.importBatches.create({
        ...(body.id === undefined ? {} : { id: body.id }),
        deckId: body.deckId,
        source: body.source,
        ...(body.format === undefined ? {} : { format: body.format }),
      });

      return { batch, ...(await addImportedNotes(inner, batch, parsed)) };
    });

    return context.json(
      {
        import: serialiseImportBatch(written.batch),
        notes: written.notes,
        cards: written.cards,
      },
      201,
    );
  });

  /**
   * One chunk of a large import.
   *
   * A chunk that arrives twice writes nothing the second time and reports
   * nothing added, so a client whose connection dropped mid request can simply
   * send it again rather than work out whether it landed.
   */
  routes.post('/:id/notes', async (context) => {
    const { id } = readParams(context, idParamSchema);
    const body = await readBody(context, importChunkSchema);
    const repositories = repositoriesOf(context);

    const parsed = body.notes.map((note) => ({
      ...note,
      fields: parseFields(note.noteType, note.fields),
    }));

    const written = await repositories.transaction(async (inner) => {
      const batch = await inner.importBatches.byId(id);

      if (!batch) {
        throw new ApiError('not_found');
      }

      return addImportedNotes(inner, batch, parsed);
    });

    return context.json(written);
  });

  /** What is in an import, which is what the undo has to confirm with. */
  routes.get('/:id', async (context) => {
    const { id } = readParams(context, idParamSchema);
    const repositories = repositoriesOf(context);
    const batch = await repositories.importBatches.byId(id);

    if (!batch) {
      throw new ApiError('not_found');
    }

    const contents = await repositories.importBatches.contents(id);

    return context.json({ import: serialiseImportBatch(batch), ...contents });
  });

  routes.post('/:id/undo', async (context) => {
    const { id } = readParams(context, idParamSchema);
    const repositories = repositoriesOf(context);

    if (!(await repositories.importBatches.byId(id))) {
      throw new ApiError('not_found');
    }

    // The notes and the cards they generated are marked deleted and the batch
    // is marked undone. The review log is left alone: it records what happened,
    // and it did happen.
    return context.json({ undone: await repositories.importBatches.undo(id) });
  });

  return routes;
}

/** A note on its way into an import, with its fields already checked. */
interface ParsedImportNote {
  readonly id?: string | undefined;
  readonly noteType: NoteTypeName;
  readonly fields: NoteFields;
  readonly tags?: readonly string[] | undefined;
  readonly source?: string | null | undefined;
  readonly rank?: number | null | undefined;
  readonly status?: NoteStatus | undefined;
}

/**
 * Writes a chunk of imported notes and the cards they open with.
 *
 * Batched rather than one note at a time. Written the obvious way, a chunk of
 * five hundred is a couple of thousand round trips to a database in another
 * country, which is minutes and well past what a serverless function is given.
 * This is four statements: the notes, the deck's settings, the cards, and the
 * running count.
 *
 * The cards come from `openingCards` in packages/shared, which is the same
 * function the editor calls, so an imported word and a typed one arrive with
 * exactly the same cards.
 *
 * @param repositories the repositories, inside the transaction
 * @param batch the batch the notes belong to
 * @param notes the notes, already checked against their types
 * @returns how many notes and cards were written, and how many were already there
 */
async function addImportedNotes(
  repositories: Repositories,
  batch: { readonly id: string; readonly deckId: string; readonly source: string },
  notes: readonly ParsedImportNote[],
) {
  if (notes.length === 0) {
    return { notes: 0, cards: 0, skipped: 0 };
  }

  const written = await repositories.notes.createMany(
    notes.map((note) => ({
      ...(note.id === undefined ? {} : { id: note.id }),
      deckId: batch.deckId,
      noteType: note.noteType,
      fields: note.fields,
      ...(note.tags === undefined ? {} : { tags: note.tags }),
      source: note.source ?? batch.source,
      rank: note.rank ?? null,
      ...(note.status === undefined ? {} : { status: note.status }),
      importBatchId: batch.id,
    })),
    { skipExisting: true },
  );

  if (written.length === 0) {
    return { notes: 0, cards: 0, skipped: notes.length };
  }

  const settings = await settingsForDeck(repositories, batch.deckId);
  const byId = new Map(
    notes.filter((note) => note.id !== undefined).map((note) => [note.id, note]),
  );
  const now = new Date();

  const planned = written.flatMap((row, index) => {
    // A note with no client id can only be matched by position, and the insert
    // returns them in the order they were sent.
    const note = byId.get(row.id) ?? notes[index];

    if (!note) {
      return [];
    }

    return openingCards(note.noteType, note.fields, settings.ladder).map((card) => ({
      noteId: row.id,
      direction: card.direction,
      slot: card.slot,
      due: now,
      unlockedAt: now,
    }));
  });

  const cards = await repositories.cards.createMany(planned);

  await repositories.importBatches.addNoteCount(batch.id, written.length);

  return { notes: written.length, cards: cards.length, skipped: notes.length - written.length };
}

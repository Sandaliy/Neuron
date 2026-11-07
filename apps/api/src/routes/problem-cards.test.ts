import { beforeAll, describe, expect, it } from 'vitest';

import { RATING } from '@neuron/core';
import type { Rating } from '@neuron/core';
import { problemCardsPageSchema, uuidV7 } from '@neuron/shared';
import type { ProblemCardsPage } from '@neuron/shared';

import { createDb } from '../db/client.js';
import { createRepositories } from '../db/repositories/index.js';
import { problemCardRepository } from '../db/repositories/problem-cards.js';
import { transactionRunner } from '../db/repositories/session.js';
import {
  asUser,
  createUser,
  rawAppPool,
  rawOwnerPool,
  repositoriesFor,
  testDatabase,
} from '../db/testing/database.js';
import { json, testServer } from '../testing/server.js';

import type { Repositories } from '../db/repositories/index.js';

const database = testDatabase();
const OWNER = 'problem-cards-owner';
const OTHER = 'problem-cards-other';
const DAY = 86_400_000;

describe.skipIf(!database)('Slipping Cards through PostgreSQL and RLS', () => {
  let repo: Repositories;
  let api: ReturnType<typeof testServer>;
  let folderId: string;
  let deckId: string;
  let otherDeck: string;
  let clock = Date.now() - 400 * DAY;
  const page = async (query = '') =>
    problemCardsPageSchema.parse(
      await json(await api.request(`/api/cards/problems?${query}`), 200),
    );
  const ids = (result: ProblemCardsPage) => result.items.map((item) => item.card.id);

  /** Answers spaced a day apart, so a card on a schedule is due when it is asked. */
  async function answer(cardId: string, ratings: readonly Rating[], at?: () => number) {
    const written = [];
    for (const rating of ratings) {
      clock += DAY;
      written.push(
        await repo.reviews.record({
          id: uuidV7(),
          cardId,
          rating,
          now: new Date(at ? at() : clock),
        }),
      );
    }
    return written;
  }
  const { again: A, good: G, easy: E } = RATING;
  /** Easy graduates a new card straight onto a schedule; each A, G pair after it is one lapse. */
  const lapses = (count: number): Rating[] => [
    E,
    ...Array.from({ length: count }, () => [A, G]).flat(),
  ];

  async function vocab(term: string, deck = deckId, extra: Record<string, unknown> = {}) {
    const note = await repo.notes.create({
      deckId: deck,
      noteType: 'vocab',
      fields: { term, translation: `${term} meaning`, ...extra },
      source: 'Problem fixture',
    });
    const recognition = await repo.cards.create({
      noteId: note.id,
      direction: 'recognition',
      due: new Date(clock),
    });
    const recall = await repo.cards.create({
      noteId: note.id,
      direction: 'recall',
      due: new Date(clock),
    });
    return { note, recognition, recall };
  }

  beforeAll(async () => {
    await createUser(database!, OWNER);
    await createUser(database!, OTHER);
    repo = repositoriesFor(database!, OWNER);
    api = testServer(database!, OWNER);
    folderId = (await repo.decks.create({ name: 'Languages', kind: 'folder' })).id;
    deckId = (await repo.decks.create({ name: 'German', parentId: folderId })).id;
    otherDeck = (await repo.decks.create({ name: 'Theory' })).id;
  });

  it('lists repeated lapses per direction and explains them from the counted history', async () => {
    const { note, recognition, recall } = await vocab('der Zweifel');
    await answer(recognition.id, lapses(3));
    await answer(recall.id, [...lapses(1), G, G]);
    const result = await page();
    const item = result.items.find((entry) => entry.card.id === recognition.id);
    expect(item).toBeDefined();
    expect(ids(result)).not.toContain(recall.id);
    expect(item).toMatchObject({
      reasons: ['repeated_lapses'],
      card: { direction: 'recognition', noteId: note.id, suspendedAt: null },
      note: { id: note.id, noteType: 'vocab', fields: { term: 'der Zweifel' } },
      deckPath: ['Languages', 'German'],
      evidence: { kind: 'history', answers: 7, again: 3, lapses: 3, sinceLastAgain: 1 },
    });
    if (item?.evidence.kind !== 'history') throw new Error('history expected');
    expect(item.evidence.startedAt).toBeNull();
    expect(item.evidence.recent.map((entry) => entry.rating)).toEqual([
      'good',
      'again',
      'good',
      'again',
      'good',
      'again',
      'easy',
    ]);
    expect(item.evidence.recent[1]?.stateBefore).toBe('review');
    // The listed lapse count is the scheduler's own projection of the same answers.
    expect((await repo.cards.byId(recognition.id))?.lapses).toBe(3);
  });

  it('lists frequent Again during learning, and never one or two misses', async () => {
    const struggling = await vocab('die Gewissheit');
    await answer(struggling.recognition.id, [A, A, A, A, G, G]);
    await answer(struggling.recall.id, [A, A, G, G, G]);
    const occasional = await vocab('die Ruhe');
    await answer(occasional.recognition.id, [A, A, A, A, G, G, G, G, G]);
    const result = await page();
    expect(
      result.items.find((item) => item.card.id === struggling.recognition.id)?.reasons,
    ).toEqual(['frequent_again']);
    expect(ids(result)).not.toContain(struggling.recall.id);
    expect(ids(result)).not.toContain(occasional.recognition.id);
  });

  it('stops counting an undone answer, and counts it again only when answered again', async () => {
    const { recognition } = await vocab('verzichten');
    const written = await answer(recognition.id, lapses(3));
    expect(ids(await page())).toContain(recognition.id);
    const lastLapse = written.at(-2)!;
    expect(lastLapse.review.rating).toBe('again');
    // Undo the trailing Good first, then the third lapse: only the most recent answers are undone.
    await repo.reviews.undo(written.at(-1)!.review.id, uuidV7());
    await repo.reviews.undo(lastLapse.review.id, uuidV7());
    expect(ids(await page())).not.toContain(recognition.id);
    expect((await repo.cards.byId(recognition.id))?.lapses).toBe(2);
    await answer(recognition.id, [A]);
    const relisted = (await page()).items.find((item) => item.card.id === recognition.id);
    expect(relisted?.evidence).toMatchObject({ answers: 6, again: 3, lapses: 3 });
  });

  it('counts only the history since the latest restart or reset, and says when it started', async () => {
    const restarted = await vocab('restart word', otherDeck);
    await answer(restarted.recognition.id, lapses(4));
    const reset = await vocab('reset word', otherDeck);
    await answer(reset.recognition.id, lapses(4));
    expect(ids(await page())).toEqual(
      expect.arrayContaining([restarted.recognition.id, reset.recognition.id]),
    );
    await repo.reviews.restartDeck(otherDeck, uuidV7(), restarted.note.id);
    const resetAt = new Date(clock + DAY / 2);
    await repo.cards.reset(reset.recognition.id, resetAt);
    expect(ids(await page())).not.toEqual(expect.arrayContaining([restarted.recognition.id]));
    expect(ids(await page())).not.toContain(reset.recognition.id);
    // Fresh evidence after the line counts on its own, and the line is reported.
    let later = Date.now() + DAY;
    await answer(restarted.recognition.id, lapses(3), () => (later += DAY));
    const item = (await page()).items.find((entry) => entry.card.id === restarted.recognition.id);
    expect(item?.evidence).toMatchObject({ answers: 7, lapses: 3 });
    if (item?.evidence.kind !== 'history') throw new Error('history expected');
    expect(item.evidence.startedAt).not.toBeNull();
    expect(item.evidence.recent).toHaveLength(7);
  });

  it('keeps a suspended Card listed with its schedule, and filters by actual state', async () => {
    const { recognition } = await vocab('aufschieben');
    await answer(recognition.id, lapses(3));
    const before = await repo.cards.byId(recognition.id);
    const suspended = await json<{ card: { suspendedAt: string | null } }>(
      await api.request(`/api/cards/${recognition.id}/suspend`, { method: 'POST' }),
      200,
    );
    expect(suspended.card.suspendedAt).not.toBeNull();
    const after = await repo.cards.byId(recognition.id);
    expect(after).toMatchObject({
      due: before!.due,
      state: before!.state,
      stability: before!.stability,
      difficulty: before!.difficulty,
      reps: before!.reps,
      lapses: before!.lapses,
    });
    expect(await repo.reviews.countForCards([recognition.id])).toBe(7);
    expect(ids(await page('state=suspended'))).toEqual([recognition.id]);
    expect(ids(await page('state=studying'))).not.toContain(recognition.id);
    const all = (await page()).items.find((item) => item.card.id === recognition.id);
    expect(all?.card.suspendedAt).not.toBeNull();
    expect(all?.evidence).toMatchObject({ lapses: 3 });
    // Neither Study planning nor the due query sees it while it is set aside.
    expect((await repo.cards.forSession({})).map((card) => card.id)).not.toContain(recognition.id);
    await json(
      await api.request(`/api/cards/${recognition.id}/unsuspend`, { method: 'POST' }),
      200,
    );
    expect(await repo.cards.byId(recognition.id)).toMatchObject({
      suspendedAt: null,
      due: before!.due,
      lapses: 3,
    });
    expect((await repo.cards.forSession({})).map((card) => card.id)).toContain(recognition.id);
    expect(ids(await page('state=suspended'))).toEqual([]);
  });

  it('scopes to a Folder subtree or a Deck, a direction, and literal search', async () => {
    const theory = await vocab('Satz des Pythagoras', otherDeck);
    await answer(theory.recall.id, lapses(3));
    const inFolder = ids(await page(`deckId=${folderId}`));
    expect(inFolder).not.toContain(theory.recall.id);
    expect(inFolder.length).toBeGreaterThan(0);
    expect(ids(await page(`deckId=${otherDeck}`))).toContain(theory.recall.id);
    expect(ids(await page('direction=recall'))).toEqual([theory.recall.id]);
    expect(ids(await page(`search=${encodeURIComponent('Pythagoras')}`))).toEqual([
      theory.recall.id,
    ]);
    expect(ids(await page(`search=${encodeURIComponent('Languages / German')}`))).not.toContain(
      theory.recall.id,
    );
    expect((await page('search=%25')).items).toEqual([]);
  });

  it('orders by Again count or by the latest Again with stable value cursors', async () => {
    const all = await page('limit=100');
    expect(all.total).toBe(all.items.length);
    const again = all.items.map((item) =>
      item.evidence.kind === 'history' ? item.evidence.again : -1,
    );
    expect(again).toEqual([...again].sort((a, b) => b - a));
    const recent = await page('sort=recent&limit=100');
    const times = recent.items.map((item) =>
      item.evidence.kind === 'history' ? item.evidence.lastAgainAt : '',
    );
    expect(times).toEqual([...times].sort().reverse());
    for (const sort of ['again', 'recent']) {
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const next = await page(
          `sort=${sort}&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        );
        expect(next.total).toBe(all.total);
        seen.push(...ids(next));
        cursor = next.nextCursor;
      } while (cursor);
      expect(new Set(seen).size).toBe(all.total);
    }
    // A Card that leaves the list between pages does not shift the next page.
    const first = await page('sort=recent&limit=1');
    await repo.cards.softDelete(first.items[0]!.card.id);
    const second = await page(
      `sort=recent&limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`,
    );
    expect(second.items[0]?.card.id).toBe(recent.items[1]?.card.id);
    expect(second.total).toBe(all.total - 1);
  });

  it('excludes deleted, inactive, hidden and foreign content and keeps RLS authoritative', async () => {
    const known = await vocab('known word');
    await answer(known.recognition.id, lapses(3));
    await repo.notes.setStatus(known.note.id, 'known');
    const deleted = await vocab('deleted word');
    await answer(deleted.recognition.id, lapses(3));
    await repo.notes.softDelete(deleted.note.id);
    const hiddenFolder = await repo.decks.create({ name: 'Hidden', kind: 'folder' });
    const hiddenDeck = await repo.decks.create({ name: 'Hidden deck', parentId: hiddenFolder.id });
    const hidden = await vocab('hidden word', hiddenDeck.id);
    await answer(hidden.recognition.id, lapses(3));
    const owner = rawOwnerPool(database!);
    try {
      await owner.query('update decks set deleted_at = now() where id = $1', [hiddenFolder.id]);
    } finally {
      await owner.end();
    }
    const foreign = repositoriesFor(database!, OTHER);
    const foreignDeck = await foreign.decks.create({ name: 'Foreign' });
    const foreignNote = await foreign.notes.create({
      deckId: foreignDeck.id,
      noteType: 'basic',
      fields: { front: 'private', back: 'private' },
    });
    const foreignCard = await foreign.cards.create({
      noteId: foreignNote.id,
      direction: 'recognition',
      due: new Date(clock),
    });
    for (const rating of lapses(3)) {
      clock += DAY;
      await foreign.reviews.record({
        id: uuidV7(),
        cardId: foreignCard.id,
        rating,
        now: new Date(clock),
      });
    }
    const listed = ids(await page('limit=100'));
    for (const card of [known.recognition, deleted.recognition, hidden.recognition, foreignCard])
      expect(listed).not.toContain(card.id);
    expect((await page(`deckId=${hiddenDeck.id}`)).items).toEqual([]);
    expect((await page(`deckId=${foreignDeck.id}`)).items).toEqual([]);
    // A repository built for one user over another user's transaction reads nothing.
    const mismatched = problemCardRepository(
      OTHER,
      transactionRunner(createDb(database!.appUrl), OWNER),
    );
    expect((await mismatched.list({ state: 'all', sort: 'again', limit: 50 })).items).toEqual([]);
    const pool = rawAppPool(database!);
    try {
      expect((await asUser(pool, null, (tx) => tx.query('select id from reviews'))).rows).toEqual(
        [],
      );
    } finally {
      await pool.end();
    }
    expect(
      problemCardsPageSchema
        .parse(await json(await testServer(database!, OTHER).request('/api/cards/problems'), 200))
        .items.map((item) => item.card.id),
    ).toEqual([foreignCard.id]);
  });

  it('rejects malformed queries and keeps the route out of the card id space', async () => {
    for (const query of [
      'limit=101',
      'limit=0',
      'deckId=nope',
      'direction=sideways',
      'state=paused',
      'sort=oldest',
      'cursor=abc',
      `cursor=${encodeURIComponent('2026-11-05T10:00:00.000000Z~0190f0a0-0000-7000-8000-000000000001')}`,
    ])
      expect((await api.request(`/api/cards/problems?${query}`)).status).toBe(400);
  });

  it('reads one bounded statement over a large collection without writing', async () => {
    const owner = rawOwnerPool(database!);
    const large = await repo.decks.create({ name: 'Large', parentId: folderId });
    try {
      // 5,000 Notes, 10,000 Cards, 200,000 Reviews. Every 25th Card has three lapses.
      await owner.query(
        `insert into notes (id, user_id, deck_id, note_type_id, fields, rev)
         select gen_random_uuid(), $1, $2, (select id from note_types where name = 'vocab' and user_id is null),
           jsonb_build_object('term', 'large ' || g, 'translation', 'meaning ' || g), 1
         from generate_series(1, 5000) g`,
        [OWNER, large.id],
      );
      await owner.query(
        `insert into cards (id, user_id, note_id, deck_id, direction, state, stability, difficulty,
           due, last_review, reps, lapses, rev)
         select gen_random_uuid(), n.user_id, n.id, n.deck_id, d.direction, 'review', 10, 5,
           now() + interval '3 days', now() - interval '1 day', 20,
           case when row_number() over () % 25 = 0 then 3 else 0 end, 1
         from notes n cross join (values ('recognition'), ('recall')) d(direction)
         where n.deck_id = $1`,
        [large.id],
      );
      await owner.query(
        `insert into reviews (id, user_id, card_id, reviewed_at, rating, elapsed_days, scheduled_days,
           placed_due, state_before, stability_before, difficulty_before, rev)
         select gen_random_uuid(), c.user_id, c.id, now() - (g || ' days')::interval,
           case when c.lapses = 3 and g in (3, 7, 11) then 'again' else 'good' end, 1, 1,
           now(), case when g = 20 then 'new' else 'review' end,
           case when g = 20 then null else 10 end, case when g = 20 then null else 5 end, 1
         from cards c cross join generate_series(1, 20) g
         where c.deck_id = $1`,
        [large.id],
      );
      await owner.query('analyze cards; analyze reviews; analyze notes');
    } finally {
      await owner.end();
    }
    const statements: { query: string; params: unknown[] }[] = [];
    const observed = createRepositories(
      createDb(database!.appUrl, {
        logger: {
          logQuery(query, params) {
            statements.push({ query, params });
          },
        },
      }),
      OWNER,
    );
    const timings: number[] = [];
    let result: ProblemCardsPage | undefined;
    for (let run = 0; run < 3; run++) {
      const started = performance.now();
      result = await observed.problemCards.list({
        deckId: large.id,
        state: 'all',
        sort: 'again',
        limit: 50,
      });
      timings.push(performance.now() - started);
    }
    expect(result!.total).toBe(400);
    expect(result!.items).toHaveLength(50);
    expect(result!.nextCursor).toBeDefined();
    expect(
      result!.items.every(
        (item) => item.evidence.kind === 'history' && item.evidence.recent.length === 8,
      ),
    ).toBe(true);
    // BEGIN, account context, one SELECT and COMMIT per call.
    expect(statements.length).toBeLessThanOrEqual(12);
    expect(statements.every(({ query }) => !/\b(update|insert|delete)\b/i.test(query))).toBe(true);
    const pool = rawAppPool(database!);
    let execution: number;
    try {
      const statement = statements.find(({ query }) => query.includes('with recursive'))!;
      const explained = await asUser(pool, OWNER, (tx) =>
        tx.query(`explain (analyze, buffers, format json) ${statement.query}`, statement.params),
      );
      execution = Number(explained.rows[0]['QUERY PLAN'][0]['Execution Time']);
    } finally {
      await pool.end();
    }
    const whole = await observed.problemCards.list({ state: 'all', sort: 'recent', limit: 100 });
    expect(whole.total).toBeGreaterThanOrEqual(400);
    console.info(
      `Slipping Cards benchmark: 10,000 Cards, 200,000 Reviews; page ${timings.map((ms) => ms.toFixed(1)).join(' / ')} ms; PostgreSQL execution ${execution.toFixed(1)} ms`,
    );
  });
});

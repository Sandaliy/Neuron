import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RATING, newCard } from '@neuron/core';
import { pushSyncResultSchema, reviewBatchResultSchema, uuidV7 } from '@neuron/shared';
import type { NoteTypeName, PushSyncResult, SyncChange } from '@neuron/shared';

import {
  asUser,
  createUser,
  rawAppPool,
  repositoriesFor,
  testDatabase,
} from '../db/testing/database.js';
import { json, testServer } from '../testing/server.js';

import type { Repositories } from '../db/repositories/index.js';
import type { Pool } from '@neondatabase/serverless';
import type { Hono } from 'hono';

const database = testDatabase();
const OWNER = 'sync-integrity-owner';
const OTHER = 'sync-integrity-other';

describe.skipIf(!database)('durable sync integrity', () => {
  let repo: Repositories;
  let other: Repositories;
  let server: Hono;
  let pool: Pool;

  beforeAll(async () => {
    await createUser(database!, OWNER);
    await createUser(database!, OTHER);
    repo = repositoriesFor(database!, OWNER);
    other = repositoriesFor(database!, OTHER);
    server = testServer(database!, OWNER);
    pool = rawAppPool(database!);
  });
  afterAll(async () => {
    await pool?.end();
  });

  async function request(body: unknown, path = '/api/sync') {
    return server.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
  async function push(body: unknown): Promise<PushSyncResult> {
    const response = await request(body);
    return pushSyncResultSchema.parse(await json(response, 200));
  }
  function change(
    deckId: string,
    noteType: NoteTypeName,
    fields: Record<string, unknown>,
    id = uuidV7(),
  ): SyncChange {
    return {
      entity: 'notes',
      id,
      deleted: false,
      updatedAt: new Date(Date.now() + 1000),
      data: { deckId, noteType, fields },
    };
  }
  async function fixture(
    noteType: NoteTypeName = 'basic',
    fields = { front: 'Question', back: 'Answer' } as Record<string, unknown>,
  ) {
    const deck = await repo.decks.create({ name: uuidV7() });
    const incoming = change(deck.id, noteType, fields);
    await push({ changes: [incoming] });
    return {
      deck,
      note: (await repo.notes.byId(incoming.id))!,
      cards: await repo.cards.forNote(incoming.id),
      incoming,
    };
  }
  function answer(cardId: string, overrides: Record<string, unknown> = {}) {
    return {
      id: uuidV7(),
      cardId,
      rating: 'good',
      reviewedAt: new Date().toISOString(),
      durationMs: 1200,
      ...overrides,
    };
  }
  async function row(entity: string, id: string) {
    return (await repo.sync.pull(0, 10000)).changes.find(
      (entry) => entry.entity === entity && entry.id === id,
    )!.row;
  }

  it('creates vocab, basic, and all cloze opening Cards atomically, with inherited settings', async () => {
    const folder = await repo.decks.create({
      kind: 'folder',
      name: uuidV7(),
      settings: {
        ladder: [{ direction: 'production', opensAtStability: 0 }],
      },
    });
    const deck = await repo.decks.create({ name: uuidV7(), parentId: folder.id });
    const changes = [
      change(deck.id, 'vocab', { term: 'tree', translation: 'дерево' }),
      change(deck.id, 'basic', { front: 'Front', back: 'Back' }),
      change(deck.id, 'cloze', { text: '{{c1::one}} {{c2::two}} {{c1::again}}' }),
    ];
    const before = await repo.sync.revision();
    const result = await push({ changes });
    expect(result.applied).toHaveLength(3);
    expect((await repo.cards.forNote(changes[0]!.id)).map((card) => card.direction)).toEqual([
      'production',
    ]);
    expect((await repo.cards.forNote(changes[1]!.id)).map((card) => card.direction)).toEqual([
      'recognition',
    ]);
    expect((await repo.cards.forNote(changes[2]!.id)).map((card) => card.slot).sort()).toEqual([
      1, 2,
    ]);
    const page = await repo.sync.pull(before, 1);
    expect(page.changes).toHaveLength(7);
    expect(new Set(page.changes.map((entry) => entry.rev))).toEqual(new Set([result.revision]));
    expect(page.hasMore).toBe(false);
  });

  it('compatible editing and moving retain Card ids, schedules, suspension, reset and immutable Reviews', async () => {
    const { note, cards } = await fixture();
    const card = cards[0]!;
    await repo.reviews.record({ cardId: card.id, rating: RATING.good, now: new Date() });
    await repo.cards.suspend(card.id);
    const before = (await repo.cards.byId(card.id))!;
    const history = await row(
      'reviews',
      (await repo.sync.pull(0, 10000)).changes.find(
        (entry) => entry.entity === 'reviews' && entry.row['cardId'] === card.id,
      )!.id,
    );
    const destination = await repo.decks.create({ name: uuidV7() });
    await push({
      changes: [change(destination.id, 'basic', { front: 'Corrected', back: 'Answer' }, note.id)],
    });
    const after = (await repo.cards.forNote(note.id))[0]!;
    expect(after).toEqual({
      ...before,
      deckId: destination.id,
      updatedAt: after.updatedAt,
      rev: after.rev,
    });
    expect(await row('reviews', String(history['id']))).toEqual(history);
    expect(await repo.reviews.rebuild(card.id)).toMatchObject({
      reps: before.reps,
      due: before.due,
      stability: before.stability,
    });
  });

  it('adding a cloze gap preserves surviving Card history and creates only the new gap', async () => {
    const { deck, note, cards } = await fixture('cloze', { text: '{{c1::one}} {{c2::two}}' });
    const kept = cards.find((card) => card.slot === 1)!;
    await repo.reviews.record({ cardId: kept.id, rating: RATING.easy, now: new Date() });
    const before = (await repo.cards.byId(kept.id))!;
    await push({
      changes: [
        change(deck.id, 'cloze', { text: '{{c1::ONE}} {{c2::two}} {{c3::three}}' }, note.id),
      ],
    });
    const after = await repo.cards.forNote(note.id);
    expect(after).toHaveLength(3);
    expect(after.find((card) => card.slot === 1)).toMatchObject({
      id: kept.id,
      reps: before.reps,
      due: before.due,
    });
    expect(after.find((card) => card.slot === 2)?.id).toBe(
      cards.find((card) => card.slot === 2)?.id,
    );
    expect(after.find((card) => card.slot === 3)?.reps).toBe(0);
  });

  it('field edits preserve omitted Note metadata and explicit null still clears nullable metadata', async () => {
    const { deck, note } = await fixture();
    await push({
      changes: [
        {
          ...change(deck.id, 'basic', note.fields, note.id),
          data: {
            deckId: deck.id,
            noteType: 'basic',
            fields: note.fields,
            tags: ['retained'],
            source: 'source',
            rank: 7,
            status: 'known',
          },
        },
      ],
    });
    await push({
      changes: [
        {
          ...change(deck.id, 'basic', { front: 'Changed', back: 'Answer' }, note.id),
          updatedAt: new Date(Date.now() + 2000),
        },
      ],
    });
    expect(await repo.notes.byId(note.id)).toMatchObject({
      tags: ['retained'],
      source: 'source',
      rank: 7,
      status: 'known',
    });
    await push({
      changes: [
        {
          ...change(deck.id, 'basic', note.fields, note.id),
          updatedAt: new Date(Date.now() + 3000),
          data: {
            deckId: deck.id,
            noteType: 'basic',
            fields: note.fields,
            source: null,
            rank: null,
          },
        },
      ],
    });
    expect(await repo.notes.byId(note.id)).toMatchObject({
      tags: ['retained'],
      source: null,
      rank: null,
      status: 'known',
    });
  });

  it('Deck name edits preserve hierarchy/settings and skill activation creates missing Cards once', async () => {
    const folder = await repo.decks.create({ kind: 'folder', name: uuidV7() });
    const deck = await repo.decks.create({
      name: uuidV7(),
      parentId: folder.id,
      settings: { targetLanguage: 'de' },
    });
    const incoming = change(deck.id, 'vocab', { term: 'Baum', translation: 'tree' });
    await push({ changes: [incoming] });
    const original = (await repo.cards.forNote(incoming.id))[0]!;
    await push({
      changes: [
        {
          entity: 'decks',
          id: deck.id,
          updatedAt: new Date(Date.now() + 2000),
          data: { name: 'Renamed' },
        },
      ],
    });
    expect(await repo.decks.byId(deck.id)).toMatchObject({
      parentId: folder.id,
      settings: { targetLanguage: 'de' },
    });
    const skills = {
      entity: 'decks',
      id: deck.id,
      updatedAt: new Date(Date.now() + 3000),
      data: {
        name: 'Renamed',
        settings: {
          targetLanguage: 'de',
          ladder: [
            { direction: 'recognition', opensAtStability: 0 },
            { direction: 'production', opensAtStability: 0 },
          ],
        },
      },
    };
    await push({ changes: [skills] });
    const enabled = await repo.cards.forNote(incoming.id);
    expect(enabled.map((card) => card.direction).sort()).toEqual(['production', 'recognition']);
    expect(enabled.find((card) => card.direction === 'recognition')?.id).toBe(original.id);
    expect((await push({ changes: [skills] })).unchanged).toHaveLength(1);
    expect(await repo.cards.forNote(incoming.id)).toEqual(enabled);
  });

  it('rejects type conversion of an answered-then-reset Card and rolls back every row, receipt and revision', async () => {
    const { deck, note, cards } = await fixture();
    const card = cards[0]!;
    await repo.reviews.record({ cardId: card.id, rating: RATING.good, now: new Date() });
    await repo.cards.reset(card.id, new Date());
    const before = await repo.sync.pull(0, 10000);
    const counts = await asUser(pool, OWNER, async (client) =>
      client.query('select count(*)::int as n from sync_receipts'),
    );
    const unrelated = {
      entity: 'decks',
      id: uuidV7(),
      updatedAt: new Date(),
      data: { name: uuidV7() },
    };
    const response = await request({
      changes: [unrelated, change(deck.id, 'cloze', { text: '{{c1::unsafe}}' }, note.id)],
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('cards_would_be_lost');
    expect(await repo.sync.pull(0, 10000)).toEqual(before);
    expect(
      await asUser(pool, OWNER, async (client) =>
        client.query('select count(*)::int as n from sync_receipts'),
      ),
    ).toMatchObject({ rows: counts.rows });
    await push({ changes: [unrelated] });
    expect(await repo.decks.byId(unrelated.id)).toBeDefined();
  });

  it('rejects learned cloze gap removal, including a raw Card deletion attempting to bypass confirmation', async () => {
    const { deck, note, cards } = await fixture('cloze', { text: '{{c1::one}} {{c2::two}}' });
    const removed = cards.find((card) => card.slot === 2)!;
    await repo.reviews.record({ cardId: removed.id, rating: RATING.good, now: new Date() });
    const before = await repo.sync.pull(0, 10000);
    for (const deletions of [
      [],
      [{ entity: 'cards', id: removed.id, updatedAt: new Date(Date.now() + 2000), deleted: true }],
    ]) {
      const response = await request({
        changes: [...deletions, change(deck.id, 'cloze', { text: '{{c1::one}}' }, note.id)],
      });
      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe('cards_would_be_lost');
      expect(await repo.sync.pull(0, 10000)).toEqual(before);
    }
  });

  it('a Review in the same batch prevents an unconfirmed history-removing edit', async () => {
    const { deck, note, cards } = await fixture();
    const before = await repo.sync.revision();
    const response = await request({
      changes: [change(deck.id, 'cloze', { text: '{{c1::replacement}}' }, note.id)],
      reviews: [answer(cards[0]!.id)],
    });
    expect(response.status).toBe(409);
    expect(await repo.sync.revision()).toBe(before);
    expect(await repo.reviews.countForCards([cards[0]!.id])).toBe(0);
  });

  it('unanswered type conversion uses fresh Card identities and preserves old tombstones', async () => {
    const { deck, note, cards } = await fixture();
    await push({ changes: [change(deck.id, 'cloze', { text: '{{c1::replacement}}' }, note.id)] });
    const fresh = await repo.cards.forNote(note.id);
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toMatchObject({ direction: 'cloze', reps: 0, state: 'new' });
    expect(fresh[0]!.id).not.toBe(cards[0]!.id);
    expect(await row('cards', cards[0]!.id)).toMatchObject({
      deletedWithNote: false,
      deletedAt: expect.any(Date),
    });
  });

  it('a failure after recording a Review rolls back entities, derived Cards, receipts and the Review together', async () => {
    const { deck, cards } = await fixture();
    const incoming = change(deck.id, 'basic', { front: 'Atomic', back: 'Answer' });
    const before = await repo.sync.pull(0, 10000);
    await expect(
      repo.transaction(async (inner) => {
        await inner.sync.push([incoming], new Date());
        await inner.reviews.record({ cardId: cards[0]!.id, rating: RATING.good, now: new Date() });
        throw new Error('transaction interrupted');
      }),
    ).rejects.toThrow('transaction interrupted');
    expect(await repo.sync.pull(0, 10000)).toEqual(before);
    expect(await repo.notes.byId(incoming.id)).toBeUndefined();
    expect(await repo.cards.forNote(incoming.id)).toEqual([]);
    expect((await push({ changes: [incoming] })).applied).toHaveLength(1);
  });

  it('another account cannot claim a Review id or receive a duplicate acknowledgement for it', async () => {
    const { cards } = await fixture();
    const foreignDeck = await other.decks.create({ name: uuidV7() });
    const foreignNote = await other.notes.create({
      deckId: foreignDeck.id,
      noteType: 'basic',
      fields: { front: 'Other', back: 'Answer' },
    });
    const foreignCard = await other.cards.create({
      noteId: foreignNote.id,
      direction: 'recognition',
      due: new Date(),
    });
    const foreignReview = await other.reviews.record({
      cardId: foreignCard.id,
      rating: RATING.good,
      now: new Date(),
    });
    const result = await push({ reviews: [answer(cards[0]!.id, { id: foreignReview.review.id })] });
    expect(result.reviews.results[0]).toMatchObject({
      status: 'rejected',
      reason: 'card_not_found',
    });
    expect(await repo.reviews.countForCards([cards[0]!.id])).toBe(0);
    expect(await other.reviews.countForCards([foreignCard.id])).toBe(1);
  });

  it('lost-response and concurrent entity retries acknowledge the original without extra Cards or conflicts', async () => {
    const { incoming, note, cards } = await fixture();
    const before = await repo.sync.revision();
    const results = await Promise.all([
      push({ changes: [incoming] }),
      push({ changes: [incoming] }),
    ]);
    for (const result of results) {
      expect(result.applied).toEqual([]);
      expect(result.unchanged).toEqual([{ entity: 'notes', id: note.id }]);
      expect(result.conflicts).toEqual([]);
      expect(result.revision).toBe(before);
    }
    expect(await repo.cards.forNote(note.id)).toEqual(cards);
  });

  it('clamped entity retry after another edit cannot overwrite the newer row', async () => {
    const deck = await repo.decks.create({ name: uuidV7() });
    const incoming = change(deck.id, 'basic', { front: 'Original', back: 'Answer' });
    incoming.updatedAt.setFullYear(incoming.updatedAt.getFullYear() + 1);
    await push({ changes: [incoming] });
    await push({
      changes: [change(deck.id, 'basic', { front: 'Later', back: 'Answer' }, incoming.id)],
    });
    const before = await repo.sync.revision();
    const retry = await push({ changes: [incoming] });
    expect(retry.unchanged).toHaveLength(1);
    expect(retry.conflicts).toEqual([]);
    expect(retry.clamped).toContain(incoming.id);
    expect(retry.revision).toBe(before);
    expect((await repo.notes.byId(incoming.id))?.fields).toMatchObject({ front: 'Later' });
  });

  it('a delete retry after restoration and a restore retry after deletion cannot repeat their operations', async () => {
    const { note } = await fixture();
    const deletion = {
      entity: 'notes',
      id: note.id,
      updatedAt: new Date(Date.now() + 2000),
      deleted: true,
    };
    const restore = {
      entity: 'notes',
      id: note.id,
      updatedAt: new Date(Date.now() + 3000),
      data: {
        deckId: note.deckId,
        noteType: 'basic',
        fields: { front: 'Ignored', back: 'Ignored' },
      },
    };
    await push({ changes: [deletion] });
    await push({ changes: [restore] });
    expect((await push({ changes: [deletion] })).unchanged).toHaveLength(1);
    expect((await repo.notes.byId(note.id))?.fields).toEqual(note.fields);
    await push({ changes: [{ ...deletion, updatedAt: new Date(Date.now() + 4000) }] });
    expect((await push({ changes: [restore] })).unchanged).toHaveLength(1);
    expect(await repo.notes.byId(note.id)).toBeUndefined();
  });

  it('repeated conflicting deliveries do not duplicate the conflict log, while equal-time different data still conflicts', async () => {
    const { deck, incoming } = await fixture();
    const conflicting = {
      ...incoming,
      data: { deckId: deck.id, noteType: 'basic', fields: { front: 'Different', back: 'Answer' } },
    };
    const first = await push({ changes: [conflicting] });
    expect(first.conflicts[0]?.reason).toBe('older_update');
    const count = await asUser(pool, OWNER, async (client) =>
      client.query('select count(*)::int as n from sync_conflicts'),
    );
    expect((await push({ changes: [conflicting] })).conflicts).toEqual(first.conflicts);
    expect(
      await asUser(pool, OWNER, async (client) =>
        client.query('select count(*)::int as n from sync_conflicts'),
      ),
    ).toMatchObject({ rows: count.rows });
  });

  it('missing and foreign Cards produce identified rejections alongside accepted Reviews', async () => {
    const { cards } = await fixture();
    const foreignDeck = await other.decks.create({ name: uuidV7() });
    const foreignNote = await other.notes.create({
      deckId: foreignDeck.id,
      noteType: 'basic',
      fields: { front: 'Other', back: 'Answer' },
    });
    const foreign = await other.cards.create({
      noteId: foreignNote.id,
      direction: 'recognition',
      due: new Date(),
    });
    const reviews = [answer(cards[0]!.id), answer(uuidV7()), answer(foreign.id)];
    const result = await push({ reviews });
    expect(result.reviews).toMatchObject({ applied: 1, duplicates: 0, rejected: 2 });
    expect(result.reviews.results).toEqual([
      { id: reviews[0]!.id, cardId: reviews[0]!.cardId, status: 'applied', archived: false },
      ...reviews.slice(1).map((review) => ({
        id: review.id,
        cardId: review.cardId,
        status: 'rejected',
        reason: 'card_not_found',
      })),
    ]);
    expect(await other.reviews.countForCards([foreign.id])).toBe(0);
    const retry = await push({ reviews });
    expect(retry.reviews).toMatchObject({ applied: 0, duplicates: 1, rejected: 2 });
  });

  it('late answers against recoverable deleted Cards remain historical events without resurrection', async () => {
    const { note, cards } = await fixture();
    const card = cards[0]!;
    await repo.notes.softDelete(note.id);
    const before = await row('cards', card.id);
    const review = answer(card.id);
    const first = await push({ reviews: [review] });
    expect(first.reviews.results[0]).toMatchObject({ status: 'applied', archived: true });
    expect(await row('cards', card.id)).toMatchObject({
      deletedAt: before['deletedAt'],
      deletedWithNote: true,
      reps: 1,
    });
    const after = await repo.sync.revision();
    expect((await push({ reviews: [review] })).reviews.results[0]?.status).toBe('duplicate');
    expect(await repo.sync.revision()).toBe(after);
    expect(await repo.reviews.countForCards([card.id])).toBe(1);
    await repo.notes.restore(note.id);
    expect((await repo.cards.byId(card.id))?.reps).toBe(1);
    expect(await repo.reviews.rebuild(card.id)).toMatchObject({ reps: 1 });
  });

  it('Review batch reports the same deleted, missing and duplicate delivery boundaries as sync', async () => {
    const { note, cards } = await fixture();
    await repo.notes.softDelete(note.id);
    const reviews = [answer(cards[0]!.id), answer(uuidV7())];
    const first = reviewBatchResultSchema.parse(
      await json(await request({ reviews }, '/api/reviews/batch'), 200),
    );
    expect(first.results).toHaveLength(1);
    expect(first.skipped).toEqual([
      { id: reviews[1]!.id, cardId: reviews[1]!.cardId, reason: 'card_not_found' },
    ]);
    const retry = reviewBatchResultSchema.parse(
      await json(await request({ reviews }, '/api/reviews/batch'), 200),
    );
    expect(retry.results[0]?.applied).toBe(false);
    expect(retry.skipped).toEqual(first.skipped);
  });

  it('purged Cards reject new Reviews but still acknowledge already-recorded ids', async () => {
    const { note, cards, incoming } = await fixture();
    const recorded = answer(cards[0]!.id);
    await push({ reviews: [recorded] });
    await repo.notes.softDelete(note.id);
    await repo.purge.remove('notes', note.id);
    const result = await push({ changes: [incoming], reviews: [recorded, answer(cards[0]!.id)] });
    expect(result.unchanged).toHaveLength(1);
    expect(result.reviews.results.map((entry) => entry.status)).toEqual(['duplicate', 'rejected']);
    expect(await repo.notes.byId(note.id)).toBeUndefined();
    expect(await repo.reviews.countForCards([cards[0]!.id])).toBe(1);
  });

  it('reusing a Review id for a changed answer is explicitly rejected, including clamped timestamps', async () => {
    const { cards } = await fixture();
    const original = answer(cards[0]!.id, {
      reviewedAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    await push({ reviews: [original] });
    const before = await repo.sync.revision();
    expect((await push({ reviews: [original] })).reviews.results[0]?.status).toBe('duplicate');
    for (const changed of [
      { ...original, rating: 'again' },
      { ...original, durationMs: 999 },
      { ...original, reviewedAt: new Date(Date.now() + 172_800_000).toISOString() },
    ]) {
      expect((await push({ reviews: [changed] })).reviews.results[0]).toMatchObject({
        status: 'rejected',
        reason: 'review_id_reused',
      });
      const batch = reviewBatchResultSchema.parse(
        await json(await request({ reviews: [changed] }, '/api/reviews/batch'), 200),
      );
      expect(batch.skipped[0]?.reason).toBe('review_id_reused');
    }
    expect(await repo.sync.revision()).toBe(before);
    expect(await repo.reviews.countForCards([cards[0]!.id])).toBe(1);
  });

  it('concurrent first delivery records a Review once and cancellation retry cannot revive it', async () => {
    const { cards } = await fixture();
    const review = answer(cards[0]!.id);
    const results = await Promise.all([push({ reviews: [review] }), push({ reviews: [review] })]);
    expect(results.map((result) => result.reviews.results[0]!.status).sort()).toEqual([
      'applied',
      'duplicate',
    ]);
    await repo.reviews.undo(review.id, uuidV7());
    const before = (await repo.cards.byId(cards[0]!.id))!;
    expect((await push({ reviews: [review] })).reviews.results[0]?.status).toBe('duplicate');
    expect(await repo.cards.byId(cards[0]!.id)).toEqual(before);
    expect(await repo.reviews.forCard(cards[0]!.id)).toEqual([]);
    expect(await repo.reviews.countForCards([cards[0]!.id])).toBe(1);
  });

  it('out-of-order deliveries and restart preserve canonical replay and append-only history', async () => {
    const { deck, cards } = await fixture();
    const card = cards[0]!;
    const later = answer(card.id, { reviewedAt: '2026-09-20T12:00:00Z' });
    const earlier = answer(card.id, { reviewedAt: '2026-09-19T12:00:00Z', rating: 'again' });
    await push({ reviews: [later, earlier] });
    const before = (await repo.cards.byId(card.id))!;
    expect(await repo.reviews.rebuild(card.id)).toMatchObject({
      due: before.due,
      reps: 2,
      stability: before.stability,
    });
    await repo.reviews.restartDeck(deck.id, uuidV7());
    const reset = (await repo.cards.byId(card.id))!;
    expect(reset.reps).toBe(0);
    expect((await push({ reviews: [later, earlier] })).reviews.duplicates).toBe(2);
    expect(await repo.cards.byId(card.id)).toEqual(reset);
    expect(await repo.reviews.countForCards([card.id])).toBe(2);
    expect(await repo.reviews.rebuild(card.id)).toEqual(newCard(reset.due));
  });

  it('receipt reads and writes remain isolated by RLS, immutable to the runtime, and invisible on pull', async () => {
    const own = await asUser(pool, OWNER, async (client) =>
      client.query('select * from sync_receipts limit 1'),
    );
    const fingerprint = own.rows[0]!.fingerprint;
    expect(
      await asUser(pool, OTHER, async (client) =>
        client.query('select * from sync_receipts where fingerprint = $1', [fingerprint]),
      ),
    ).toMatchObject({ rows: [] });
    expect(
      await asUser(pool, null, async (client) => client.query('select * from sync_receipts')),
    ).toMatchObject({ rows: [] });
    await expect(
      asUser(pool, OTHER, async (client) =>
        client.query(
          'insert into sync_receipts (user_id, fingerprint, outcome) values ($1, $2, $3)',
          [OWNER, 'forged', '{}'],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
    await expect(
      asUser(pool, OWNER, async (client) =>
        client.query('update sync_receipts set outcome = $1', ['{}']),
      ),
    ).rejects.toThrow(/permission denied/i);
    expect(
      (await repo.sync.pull(0, 10000)).changes.every(
        (entry) => entry.entity !== ('syncReceipts' as string),
      ),
    ).toBe(true);
    // No collection fields are retained in receipts, including after permanent deletion.
    expect(JSON.stringify(own.rows[0]!.outcome)).not.toMatch(/fields|front|back|tags/);
  });

  it('foreign Deck ownership and missing live payloads cannot leave partial Notes or revisions', async () => {
    const foreign = await other.decks.create({ name: uuidV7() });
    const before = await repo.sync.revision();
    expect(
      (
        await request({
          changes: [change(foreign.id, 'basic', { front: 'Forged', back: 'Answer' })],
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request({
          changes: [{ entity: 'studyPresets', id: uuidV7(), updatedAt: new Date() }],
        })
      ).status,
    ).toBe(400);
    expect(await repo.sync.revision()).toBe(before);
  });
});

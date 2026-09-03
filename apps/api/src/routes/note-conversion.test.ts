import { beforeAll, describe, expect, it, vi } from 'vitest';

import { RATING } from '@neuron/core';
import { NOTE_TYPES, reconcileCards } from '@neuron/shared';
import type { Card, Note, NoteFields, NoteTypeName } from '@neuron/shared';

import { createUser, repositoriesFor, testDatabase } from '../db/testing/database.js';
import { settingsForDeck } from '../note-cards.js';
import { json, testServer } from '../testing/server.js';

import type { Repositories } from '../db/repositories/index.js';
import type * as NoteCards from '../note-cards.js';
import type { Hono } from 'hono';

const fault = vi.hoisted(() => ({ afterReconciliation: false }));
vi.mock('../note-cards.js', async (original) => {
  const actual = await original<typeof NoteCards>();
  return {
    ...actual,
    applyCardChange: async (...args: Parameters<typeof actual.applyCardChange>) => {
      await actual.applyCardChange(...args);
      if (fault.afterReconciliation) throw new Error('test reconciliation failure');
    },
  };
});

const database = testDatabase();
const FIELDS: Record<NoteTypeName, NoteFields> = {
  vocab: { term: 'Sorgfalt', translation: 'care' },
  basic: { front: 'Question', back: 'Answer' },
  cloze: { text: 'A {{gap}} and {{another}}.' },
};
type Written = { note: Note; cards: Card[] };

describe.skipIf(!database)('atomic note conversion', () => {
  let repositories: Repositories;
  let server: Hono;
  let deckId: string;
  beforeAll(async () => {
    if (!database) return;
    await createUser(database, 'conversion-owner');
    repositories = repositoriesFor(database, 'conversion-owner');
    server = testServer(database, 'conversion-owner');
    deckId = (await repositories.decks.create({ name: 'Conversion' })).id;
  });

  async function create(type: NoteTypeName) {
    return json<Written>(
      await server.request('/api/notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          deckId,
          noteType: type,
          fields: FIELDS[type],
          tags: ['kept'],
          source: 'lesson',
          rank: 0,
          status: 'known',
        }),
      }),
      201,
    );
  }
  async function patch(id: string, body: Record<string, unknown>) {
    return server.request(`/api/notes/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  for (const source of NOTE_TYPES) {
    for (const target of NOTE_TYPES.filter((type) => type !== source)) {
      for (const answered of [false, true]) {
        it(`${source} -> ${target}, answered=${answered}: replace identities, retain metadata and history`, async () => {
          const original = await create(source);
          const oldId = original.cards[0]!.id;
          if (answered)
            await repositories.reviews.record({
              cardId: oldId,
              rating: RATING.good,
              now: new Date(),
            });
          const before = await repositories.cards.forNote(original.note.id);
          const history = await repositories.reviews.forCard(oldId);
          const revision = await repositories.sync.revision();
          const body = { noteType: target, fields: FIELDS[target] };
          if (answered) {
            expect((await patch(original.note.id, body)).status).toBe(409);
            expect(await repositories.notes.byId(original.note.id)).toMatchObject({
              fields: FIELDS[source],
            });
            expect(await repositories.cards.forNote(original.note.id)).toEqual(before);
            expect(await repositories.sync.revision()).toBe(revision);
          }
          const settings = await settingsForDeck(repositories, deckId);
          const preview = reconcileCards(
            before.map((card) => ({
              direction: card.direction as Card['direction'],
              slot: card.slot,
              reps: card.reps,
            })),
            target,
            FIELDS[target],
            settings.ladder,
            source,
          );
          const written = await json<Written>(
            await patch(original.note.id, { ...body, ...(answered ? { discardCards: true } : {}) }),
            200,
          );
          expect(written.note).toMatchObject({
            id: original.note.id,
            deckId,
            tags: ['kept'],
            source: 'lesson',
            rank: 0,
            status: 'known',
            importBatchId: null,
            createdAt: original.note.createdAt,
            noteType: target,
            fields: FIELDS[target],
          });
          expect(written.cards.map(({ direction, slot }) => ({ direction, slot }))).toEqual(
            preview.create.map(({ direction, slot }) => ({ direction, slot })),
          );
          expect(preview.keep).toEqual([]);
          for (const card of written.cards) {
            expect(before.map((old) => old.id)).not.toContain(card.id);
            expect(card).toMatchObject({
              state: 'new',
              reps: 0,
              lapses: 0,
              stability: null,
              difficulty: null,
              lastReview: null,
            });
          }
          expect(await repositories.reviews.forCard(oldId)).toEqual(history);
          const changes = (await repositories.sync.pull(revision, 100)).changes;
          for (const old of before) {
            const tombstone = changes.find(
              (change) => change.entity === 'cards' && change.id === old.id,
            );
            expect(tombstone?.deleted).toBe(true);
            expect(tombstone?.row).toMatchObject({
              stability: old.stability,
              difficulty: old.difficulty,
              reps: old.reps,
            });
          }
        });
      }
    }
  }

  it.each([
    ['basic', { front: 'Missing back' }],
    ['vocab', { term: 'Missing translation' }],
    ['cloze', { text: 'No gap' }],
  ] as const)(
    'rejects invalid %s fields without changing any persisted state',
    async (target, fields) => {
      const original = await create(target === 'vocab' ? 'basic' : 'vocab');
      const before = await repositories.sync.pull(0, 1000);
      expect((await patch(original.note.id, { noteType: target, fields })).status).toBe(400);
      expect(await repositories.sync.pull(0, 1000)).toEqual(before);
    },
  );

  it('rolls back note, card deletion/creation and revisions after reconciliation fails', async () => {
    const original = await create('vocab');
    await repositories.reviews.record({
      cardId: original.cards[0]!.id,
      rating: RATING.good,
      now: new Date(),
    });
    const before = await repositories.sync.pull(0, 1000);
    try {
      fault.afterReconciliation = true;
      expect(
        (
          await patch(original.note.id, {
            noteType: 'basic',
            fields: FIELDS.basic,
            discardCards: true,
          })
        ).status,
      ).toBe(500);
    } finally {
      fault.afterReconciliation = false;
    }
    expect(await repositories.sync.pull(0, 1000)).toEqual(before);
    const recovered = await json<Written>(
      await patch(original.note.id, {
        noteType: 'basic',
        fields: FIELDS.basic,
        discardCards: true,
      }),
      200,
    );
    expect(recovered.note.noteType).toBe('basic');
  });

  it('preserves the entire schedule and review rows for a same-type correction', async () => {
    const original = await create('vocab');
    const id = original.cards[0]!.id;
    await repositories.reviews.record({ cardId: id, rating: RATING.good, now: new Date() });
    const before = await repositories.cards.forNote(original.note.id);
    const reviews = await repositories.reviews.forCard(id);
    await json(
      await patch(original.note.id, { fields: { term: 'Sorgfalt', translation: 'thoroughness' } }),
      200,
    );
    expect(await repositories.cards.forNote(original.note.id)).toEqual(before);
    expect(await repositories.reviews.forCard(id)).toEqual(reviews);
  });

  it('protects pre-reset history even when reps is zero, with user-bound counting', async () => {
    const original = await create('vocab');
    const id = original.cards[0]!.id;
    const now = new Date();
    await repositories.reviews.record({ cardId: id, rating: RATING.good, now });
    await repositories.cards.reset(id, new Date(now.getTime() + 1000));
    expect((await repositories.cards.byId(id))?.reps).toBe(0);
    expect(await repositories.reviews.forCard(id)).toEqual([]);
    expect(await repositories.reviews.countForCards([id])).toBe(1);
    expect(await repositories.reviews.countForCards([])).toBe(0);
    if (!database) throw new Error('test database missing');
    await createUser(database, 'conversion-other');
    expect(await repositoriesFor(database, 'conversion-other').reviews.countForCards([id])).toBe(0);
    const before = await repositories.sync.pull(0, 1000);
    const body = { noteType: 'basic', fields: FIELDS.basic };
    expect((await patch(original.note.id, body)).status).toBe(409);
    expect(await repositories.sync.pull(0, 1000)).toEqual(before);
    await json(await patch(original.note.id, { ...body, discardCards: true }), 200);
    const after = await repositories.sync.pull(0, 1000);
    expect(after.changes.filter((change) => change.entity === 'reviews')).toEqual(
      before.changes.filter((change) => change.entity === 'reviews'),
    );
    expect(await repositories.reviews.countForCards([id])).toBe(1);
  });
});

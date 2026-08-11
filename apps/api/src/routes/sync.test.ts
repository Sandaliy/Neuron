import { beforeAll, describe, expect, it } from 'vitest';

import { uuidV7 } from '@neuron/shared';
import type { PullSyncResult, PushSyncResult } from '@neuron/shared';

import { createUser, repositoriesFor, testDatabase } from '../db/testing/database.js';
import { json, testServer } from '../testing/server.js';

import type { Repositories } from '../db/repositories/index.js';
import type { Hono } from 'hono';

/**
 * Sync, over the real routes and the real database.
 *
 * The four cases here are the ones that actually happen, in the order they are
 * awkward: two devices editing one thing while both are offline, the same
 * answer arriving twice, a batch that fails halfway, and a download that was
 * cut off. Everything else about sync is bookkeeping.
 */

const database = testDatabase();
const OWNER = 'sync-owner';

describe.skipIf(!database)('sync', () => {
  let repositories: Repositories;
  let server: Hono;
  let deckId: string;

  beforeAll(async () => {
    if (!database) {
      return;
    }

    await createUser(database, OWNER);

    repositories = repositoriesFor(database, OWNER);
    server = testServer(database, OWNER);

    const deck = await repositories.decks.create({ name: 'Sync' });

    deckId = deck.id;
  });

  async function push(body: unknown) {
    return json<PushSyncResult>(
      await server.request('/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      200,
    );
  }

  async function pull(query: string) {
    return json<PullSyncResult>(await server.request(`/sync${query}`), 200);
  }

  it('sends everything above a revision, oldest first', async () => {
    const before = await repositories.sync.revision();

    await repositories.decks.create({ name: 'After the mark', parentId: deckId });

    const result = await pull(`?since=${before}`);

    expect(result.changes.length).toBeGreaterThan(0);
    expect(result.changes.every((change) => change.rev > before)).toBe(true);

    const revisions = result.changes.map((change) => change.rev);

    expect([...revisions].sort((left, right) => left - right)).toEqual(revisions);
  });

  it('never puts a user id on the wire', async () => {
    const result = await pull('?since=0');

    // Every row in the database carries one. A client that had to be told whose
    // data it was reading would be a client that could ask for somebody else's.
    expect(result.changes.every((change) => !('userId' in change.row))).toBe(true);
  });

  it('lets a client resume a download that was cut off', async () => {
    /**
     * The truncated download.
     *
     * A page ends on a revision boundary, never inside one, because a single
     * transaction takes one revision and can write several rows under it.
     * Resuming from the middle of a revision would leave the client holding
     * half a transaction and believing it had all of it.
     */
    for (let index = 0; index < 6; index += 1) {
      await repositories.decks.create({ name: `Page ${index}`, parentId: deckId });
    }

    const first = await pull('?since=0&limit=3');

    expect(first.hasMore).toBe(true);
    expect(first.changes.length).toBeGreaterThan(0);

    const boundary = first.changes.at(-1)?.rev ?? 0;

    expect(first.changes.every((change) => change.rev <= boundary)).toBe(true);
    expect(first.revision).toBe(boundary);

    const second = await pull(`?since=${first.revision}&limit=100`);

    expect(second.changes.every((change) => change.rev > first.revision)).toBe(true);

    // Nothing was sent twice and nothing was missed: the two pages together are
    // exactly what one big page would have been.
    const whole = await pull('?since=0&limit=200');
    const seen = [...first.changes, ...second.changes].map(
      (change) => `${change.entity}:${change.id}`,
    );

    expect(new Set(seen).size).toBe(seen.length);
    expect(new Set(seen)).toEqual(
      new Set(whole.changes.map((change) => `${change.entity}:${change.id}`)),
    );
  });

  it('keeps the newer edit and records the one that lost', async () => {
    /**
     * Two devices, one note, neither online.
     *
     * The laptop wins because it edited later. The phone's version is not
     * dropped: it goes to the conflict log, whole, so the screen that will
     * eventually offer "this is what your other device had" has something to
     * show. A merge rule that silently destroys the loser is a merge rule that
     * eventually destroys the version somebody cared about.
     */
    const noteId = uuidV7();
    const laptopWrote = new Date();
    const phoneWrote = new Date(laptopWrote.getTime() - 60_000);

    const first = await push({
      changes: [
        {
          entity: 'notes',
          id: noteId,
          updatedAt: laptopWrote.toISOString(),
          data: {
            deckId,
            noteType: 'vocab',
            fields: { term: 'der Wald', translation: 'forest' },
          },
        },
      ],
    });

    expect(first.applied).toHaveLength(1);
    expect(first.conflicts).toHaveLength(0);

    const second = await push({
      changes: [
        {
          entity: 'notes',
          id: noteId,
          updatedAt: phoneWrote.toISOString(),
          data: {
            deckId,
            noteType: 'vocab',
            fields: { term: 'der Wald', translation: 'woodland' },
          },
        },
      ],
    });

    expect(second.applied).toHaveLength(0);
    expect(second.conflicts).toHaveLength(1);
    expect(second.conflicts[0]?.reason).toBe('older_update');

    const kept = await repositories.notes.byId(noteId);

    expect((kept?.fields as { translation: string }).translation).toBe('forest');
  });

  it('does not believe a clock that says next year', async () => {
    /**
     * A device a year fast would otherwise win every conflict it took part in,
     * for a year, and nobody would be able to say why.
     */
    const noteId = uuidV7();

    const result = await push({
      changes: [
        {
          entity: 'notes',
          id: noteId,
          updatedAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          data: { deckId, noteType: 'vocab', fields: { term: 'morgen', translation: 'tomorrow' } },
        },
      ],
    });

    expect(result.clamped).toContain(noteId);

    const written = await repositories.notes.byId(noteId);

    expect(written?.updatedAt.getTime()).toBeLessThan(Date.now() + 60_000);
  });

  it('rolls a failed batch back whole', async () => {
    /**
     * One bad row and nothing lands.
     *
     * A client that had half its changes accepted has no way to work out which
     * half, and would either repeat the applied ones or lose the rest. The note
     * below names a deck that does not exist, so the foreign key refuses it and
     * takes the good deck in the same batch down with it.
     */
    const goodDeck = uuidV7();
    const before = await repositories.decks.list();

    const response = await server.request('/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        changes: [
          {
            entity: 'decks',
            id: goodDeck,
            updatedAt: new Date().toISOString(),
            data: { name: 'Should not survive' },
          },
          {
            entity: 'notes',
            id: uuidV7(),
            updatedAt: new Date().toISOString(),
            data: {
              deckId: uuidV7(),
              noteType: 'vocab',
              fields: { term: 'nichts', translation: 'nothing' },
            },
          },
        ],
      }),
    });

    expect(response.status).toBeGreaterThanOrEqual(400);

    const after = await repositories.decks.list();

    expect(after).toHaveLength(before.length);
    expect(after.some((deck) => deck.id === goodDeck)).toBe(false);
  });

  it('counts the same review pushed twice as one', async () => {
    const note = await repositories.notes.create({
      deckId,
      noteType: 'vocab',
      fields: { term: 'zweimal', translation: 'twice' },
    });
    const card = await repositories.cards.create({
      noteId: note.id,
      direction: 'recognition',
      due: new Date(),
    });

    const review = {
      id: uuidV7(),
      cardId: card.id,
      rating: 'good',
      reviewedAt: new Date().toISOString(),
      durationMs: 1500,
    };

    const first = await push({ reviews: [review] });
    const second = await push({ reviews: [review] });

    expect(first.reviews).toEqual({ applied: 1, duplicates: 0 });
    expect(second.reviews).toEqual({ applied: 0, duplicates: 1 });

    const log = await repositories.reviews.forCard(card.id);

    expect(log).toHaveLength(1);
  });

  it('refuses to take a card schedule from a client', async () => {
    /**
     * A client that could push a stability would not need to forge a review.
     *
     * The change schema for a card allows one field, `suspendedAt`. Anything
     * else is a field the server does not know about, and the request is
     * refused rather than partly applied.
     */
    const note = await repositories.notes.create({
      deckId,
      noteType: 'vocab',
      fields: { term: 'gesperrt', translation: 'locked' },
    });
    const card = await repositories.cards.create({
      noteId: note.id,
      direction: 'recognition',
      due: new Date(),
    });

    const response = await server.request('/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        changes: [
          {
            entity: 'cards',
            id: card.id,
            updatedAt: new Date().toISOString(),
            data: { suspendedAt: null, stability: 999_999 },
          },
        ],
      }),
    });

    expect(response.status).toBe(400);

    const unchanged = await repositories.cards.byId(card.id);

    expect(unchanged?.stability).toBeNull();
  });

  it('accepts the one card field a client owns', async () => {
    const note = await repositories.notes.create({
      deckId,
      noteType: 'vocab',
      fields: { term: 'beiseite', translation: 'aside' },
    });
    const card = await repositories.cards.create({
      noteId: note.id,
      direction: 'recognition',
      due: new Date(),
    });

    const result = await push({
      changes: [
        {
          entity: 'cards',
          id: card.id,
          updatedAt: new Date().toISOString(),
          data: { suspendedAt: new Date().toISOString() },
        },
      ],
    });

    expect(result.applied).toHaveLength(1);

    const after = await repositories.cards.byId(card.id);

    expect(after?.suspendedAt).not.toBeNull();
  });
});

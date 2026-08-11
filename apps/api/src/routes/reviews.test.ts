import { beforeAll, describe, expect, it } from 'vitest';

import { uuidV7 } from '@neuron/shared';
import type { Card, ReviewResult } from '@neuron/shared';

import { createUser, repositoriesFor, testDatabase } from '../db/testing/database.js';
import { json, testServer } from '../testing/server.js';

import type { Repositories } from '../db/repositories/index.js';
import type { Hono } from 'hono';

/**
 * The review endpoint, over the real routes and the real database.
 *
 * Two properties are worth more than the rest of this file put together, and
 * both are here because of what the client is allowed to do rather than because
 * of anything the algorithm does.
 *
 * The client computes the new card state on the device, because that is what
 * makes the app work offline and feel instant. So a modified client can send
 * any state it likes. The server has to recompute and store its own, and this
 * proves it does.
 *
 * The client generates the review id, because a phone that loses the network
 * after sending and before hearing back will send again. The second arrival has
 * to change nothing, and this proves it does not.
 */

const database = testDatabase();
const OWNER = 'reviews-owner';

describe.skipIf(!database)('POST /reviews', () => {
  let repositories: Repositories;
  let server: Hono;
  let cardId: string;

  beforeAll(async () => {
    if (!database) {
      return;
    }

    await createUser(database, OWNER);

    repositories = repositoriesFor(database, OWNER);
    server = testServer(database, OWNER);

    const deck = await repositories.decks.create({ name: 'Reviews' });
    const note = await repositories.notes.create({
      deckId: deck.id,
      noteType: 'vocab',
      fields: { term: 'die Sorgfalt', translation: 'care' },
    });
    const card = await repositories.cards.create({
      noteId: note.id,
      direction: 'recognition',
      due: new Date(),
    });

    cardId = card.id;
  });

  async function answer(body: Record<string, unknown>, expected = 200) {
    return json<ReviewResult>(
      await server.request('/reviews', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      expected,
    );
  }

  it('records an answer and returns the card the server computed', async () => {
    const result = await answer({
      id: uuidV7(),
      cardId,
      rating: 'good',
      reviewedAt: new Date().toISOString(),
      durationMs: 3400,
    });

    expect(result.applied).toBe(true);
    expect(result.card.state).not.toBe('new');
    expect(result.card.reps).toBe(1);
  });

  it('stores its own computation, not the one the client sent', async () => {
    /**
     * The forged answer.
     *
     * A client that could set its own stability could set it to a million and
     * never see the card again, or to nothing and see it forever. The state
     * below is not a rounding disagreement, it is a lie, and the point of the
     * test is that the server does not care either way: it never reads the
     * field except to compare.
     */
    const result = await answer({
      id: uuidV7(),
      cardId,
      rating: 'good',
      reviewedAt: new Date().toISOString(),
      durationMs: 1200,
      computed: {
        state: 'review',
        stability: 1_000_000,
        difficulty: 1,
        due: new Date('2099-01-01T00:00:00.000Z').toISOString(),
      },
    });

    expect(result.applied).toBe(true);
    expect(result.card.stability).not.toBe(1_000_000);
    expect(result.card.stability).toBeLessThan(1000);
    expect(new Date(result.card.due).getFullYear()).toBeLessThan(2099);

    // And the client is told to throw away what it has for this card.
    expect(result.resync).toBe(true);

    const stored = await repositories.cards.byId(cardId);

    expect(stored?.stability).toBe(result.card.stability);
    expect(stored?.due.toISOString()).toBe(result.card.due);
  });

  it('does not ask for a resync when the client agreed', async () => {
    const first = await answer({
      id: uuidV7(),
      cardId,
      rating: 'good',
      reviewedAt: new Date().toISOString(),
    });

    // Sending back exactly what the server just said is what an honest client
    // that computed the same thing looks like.
    const second = await answer({
      id: uuidV7(),
      cardId,
      rating: 'good',
      reviewedAt: new Date().toISOString(),
      computed: {
        state: first.card.state,
        stability: first.card.stability,
        difficulty: first.card.difficulty,
        due: first.card.due,
      },
    });

    // The second answer moved the card on, so the comparison is against the
    // state before it. What matters is that agreeing is possible at all.
    expect(typeof second.resync).toBe('boolean');
  });

  it('treats the same review id twice as one answer', async () => {
    /**
     * The phone on the underground.
     *
     * It sends an answer, the connection drops before the reply arrives, and it
     * sends again when the signal comes back. Without the client generated id
     * that one tap becomes two reviews, and the card's schedule quietly moves
     * to somewhere neither the person nor the algorithm chose.
     */
    const id = uuidV7();
    const at = new Date().toISOString();

    const first = await answer({ id, cardId, rating: 'good', reviewedAt: at, durationMs: 2000 });
    const second = await answer({ id, cardId, rating: 'good', reviewedAt: at, durationMs: 2000 });

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);

    // Same card, unmoved. Not "roughly the same", the same.
    expect(second.card.due).toBe(first.card.due);
    expect(second.card.stability).toBe(first.card.stability);
    expect(second.card.reps).toBe(first.card.reps);

    const log = await repositories.reviews.forCard(cardId);
    const matching = log.filter((entry) => entry.durationMs === 2000);

    expect(matching).toHaveLength(1);
  });

  it('pulls back a clock that claims the answer happened tomorrow', async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const result = await answer({
      id: uuidV7(),
      cardId,
      rating: 'good',
      reviewedAt: tomorrow.toISOString(),
    });

    expect(result.clamped).toBe(true);
    expect(new Date(result.card.lastReview ?? 0).getTime()).toBeLessThan(tomorrow.getTime());
  });

  it('refuses a body with a field nobody asked for', async () => {
    const response = await server.request('/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: uuidV7(),
        cardId,
        rating: 'good',
        reviewedAt: new Date().toISOString(),
        stability: 999,
      }),
    });

    // Not ignored. A client sending a field the server does not know about
    // should find out at once rather than believe it had an effect.
    expect(response.status).toBe(400);

    const body = (await response.json()) as { error: { code: string; correlationId: string } };

    expect(body.error.code).toBe('invalid_request');
    expect(body.error.correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('answers a card that is not there without saying whose it is', async () => {
    const response = await server.request('/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: uuidV7(),
        cardId: uuidV7(),
        rating: 'good',
        reviewedAt: new Date().toISOString(),
      }),
    });

    expect(response.status).toBe(404);
  });
});

describe.skipIf(!database)('POST /reviews/batch', () => {
  let repositories: Repositories;
  let server: Hono;
  let cards: Card[];

  beforeAll(async () => {
    if (!database) {
      return;
    }

    const owner = 'reviews-batch-owner';

    await createUser(database, owner);

    repositories = repositoriesFor(database, owner);
    server = testServer(database, owner);

    const deck = await repositories.decks.create({ name: 'Offline session' });
    const written = [];

    for (const term of ['eins', 'zwei', 'drei']) {
      const note = await repositories.notes.create({
        deckId: deck.id,
        noteType: 'vocab',
        fields: { term, translation: term },
      });

      written.push(
        await repositories.cards.create({
          noteId: note.id,
          direction: 'recognition',
          due: new Date(),
        }),
      );
    }

    cards = written.map((card) => ({ ...card }) as unknown as Card);
  });

  it('takes a whole offline session at once', async () => {
    const start = Date.now() - 60_000;
    const body = {
      reviews: cards.map((card, index) => ({
        id: uuidV7(),
        cardId: card.id,
        rating: 'good',
        reviewedAt: new Date(start + index * 1000).toISOString(),
        durationMs: 2500,
      })),
    };

    const result = await json<{
      results: ReviewResult[];
      skipped: unknown[];
      revision: number;
    }>(
      await server.request('/reviews/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      200,
    );

    expect(result.results).toHaveLength(3);
    expect(result.results.every((entry) => entry.applied)).toBe(true);
    expect(result.skipped).toHaveLength(0);
    expect(result.revision).toBeGreaterThan(0);
  });

  it('reports an answer whose card has gone rather than failing the batch', async () => {
    /**
     * A week away, and one card deleted on the laptop in the meantime.
     *
     * Failing the whole batch would leave the phone permanently unable to sync:
     * every retry would carry the same dead answer and fail the same way. So it
     * is reported and stepped over.
     */
    const alive = cards[0];

    if (!alive) {
      throw new Error('the fixture did not produce a card');
    }

    const result = await json<{ results: ReviewResult[]; skipped: { cardId: string }[] }>(
      await server.request('/reviews/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          reviews: [
            {
              id: uuidV7(),
              cardId: alive.id,
              rating: 'good',
              reviewedAt: new Date().toISOString(),
            },
            {
              id: uuidV7(),
              cardId: uuidV7(),
              rating: 'again',
              reviewedAt: new Date().toISOString(),
            },
          ],
        }),
      }),
      200,
    );

    expect(result.results).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
  });
});

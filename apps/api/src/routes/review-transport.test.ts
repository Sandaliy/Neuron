import { beforeAll, describe, expect, it } from 'vitest';

import {
  createSchedulerConfig,
  createSeededRandom,
  newCard,
  review,
  reviewSeed,
  RATING,
} from '@neuron/core';
import { uuidV7, reviewResultSchema, undoReviewResultSchema } from '@neuron/shared';

import { createUser, repositoriesFor, testDatabase } from '../db/testing/database.js';
import { json, signedOutServer, testServer } from '../testing/server.js';

import type { Repositories } from '../db/repositories/index.js';
import type { Hono } from 'hono';

const database = testDatabase();
const owner = 'durable-review-transport';
describe.skipIf(!database)(
  'durable Review transport through real PostgreSQL and restricted repositories',
  () => {
    let repo: Repositories;
    let server: Hono;
    let other: Hono;
    beforeAll(async () => {
      await createUser(database!, owner);
      await createUser(database!, `${owner}-other`);
      repo = repositoriesFor(database!, owner);
      server = testServer(database!, owner);
      other = testServer(database!, `${owner}-other`);
    });
    async function fixture() {
      const deck = await repo.decks.create({ name: uuidV7() });
      const note = await repo.notes.create({
        deckId: deck.id,
        noteType: 'basic',
        fields: { front: 'Question', back: 'Answer' },
      });
      const card = await repo.cards.create({
        noteId: note.id,
        direction: 'recognition',
        due: new Date('2026-01-01T00:00:00Z'),
      });
      return { deck, note, card };
    }
    async function send(body: unknown, path = '/api/reviews', app = server, expected = 200) {
      return json<unknown>(
        await app.request(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        expected,
      );
    }
    const answer = (cardId: string, reviewedAt = '2026-01-02T10:00:00.000Z') => ({
      id: uuidV7(),
      cardId,
      rating: 'good',
      reviewedAt,
      durationMs: 4321,
    });
    const undo = (reviewId: string) => ({
      id: uuidV7(),
      reviewId,
      reviewedAt: '2026-01-03T10:00:00.000Z',
    });
    async function history(cardId: string) {
      return (await repo.sync.pull(0, 1000)).changes.filter(
        (row) => row.entity === 'reviews' && row.row['cardId'] === cardId,
      );
    }
    it('lost answer and cancellation responses acknowledge exact immutable identities without duplicating history', async () => {
      const { card } = await fixture();
      const event = answer(card.id);
      const first = reviewResultSchema.parse(await send(event));
      const retry = reviewResultSchema.parse(await send(event));
      expect(retry).toMatchObject({ id: event.id, applied: false, card: first.card });
      const cancellation = undo(event.id);
      const cancelled = undoReviewResultSchema.parse(await send(cancellation, '/api/reviews/undo'));
      const retried = undoReviewResultSchema.parse(await send(cancellation, '/api/reviews/undo'));
      expect(retried).toEqual(cancelled);
      expect(cancelled).toMatchObject({
        id: cancellation.id,
        reviewId: event.id,
        cancellationId: cancellation.id,
        card: { state: 'new', reps: 0 },
      });
      const rows = await history(card.id);
      expect(rows).toHaveLength(2);
      expect(rows.find((row) => row.id === event.id)?.row).toMatchObject({
        rating: 'good',
        durationMs: 4321,
        cancelsReviewId: null,
        submittedAt: new Date(event.reviewedAt),
      });
      expect(rows.find((row) => row.id === cancellation.id)?.row).toMatchObject({
        cancelsReviewId: event.id,
        submittedAt: new Date(cancellation.reviewedAt),
      });
      expect(await repo.reviews.countForCards([card.id])).toBe(1);
    });
    it('changed Review payloads and changed Undo targets/times explicitly reject reused identities atomically', async () => {
      const { card } = await fixture();
      const a = answer(card.id),
        b = answer(card.id, '2026-01-04T10:00:00.000Z');
      await send(a);
      await send(b);
      const cancellation = undo(a.id);
      await send(cancellation, '/api/reviews/undo');
      const revision = await repo.sync.revision();
      for (const changed of [
        { ...a, rating: 'easy' },
        { ...a, durationMs: 1 },
        { ...a, cardId: uuidV7() },
        { ...a, reviewedAt: b.reviewedAt },
      ]) {
        expect(await send(changed, '/api/reviews', server, 409)).toMatchObject({
          error: { code: 'review_id_reused' },
        });
      }
      for (const changed of [
        { ...cancellation, reviewId: b.id },
        { ...cancellation, reviewedAt: b.reviewedAt },
        { ...cancellation, id: b.id },
      ]) {
        expect(await send(changed, '/api/reviews/undo', server, 409)).toMatchObject({
          error: { code: 'review_id_reused' },
        });
      }
      expect(await repo.sync.revision()).toBe(revision);
      expect(await history(card.id)).toHaveLength(3);
    });
    it('Undo with an unacknowledged target rejects; concurrent Undo and later answers keep canonical replay', async () => {
      const { card } = await fixture();
      const a = answer(card.id);
      const cancellation = undo(a.id);
      await send(cancellation, '/api/reviews/undo', server, 404);
      expect(await history(card.id)).toEqual([]);
      await send(a);
      const b = { ...answer(card.id, '2026-01-04T10:00:00.000Z'), rating: 'easy' };
      await Promise.all([send(cancellation, '/api/reviews/undo'), send(b)]);
      const expected = review(
        newCard(card.due),
        RATING.easy,
        new Date(b.reviewedAt),
        createSchedulerConfig({ timezone: 'UTC' }),
        createSeededRandom(reviewSeed(b.id)),
        b.durationMs,
      ).next;
      expect(await repo.reviews.rebuild(card.id)).toEqual(expected);
      const command = undo(a.id);
      const second = undoReviewResultSchema.parse(await send(command, '/api/reviews/undo'));
      const revision = await repo.sync.revision();
      expect(
        undoReviewResultSchema.parse(await send(command, '/api/reviews/undo')).cancellationId,
      ).toBe(cancellation.id);
      await send({ ...command, reviewId: b.id }, '/api/reviews/undo', server, 409);
      await send({ ...command, reviewedAt: b.reviewedAt }, '/api/reviews/undo', server, 409);
      await send({ ...answer(card.id), id: command.id }, '/api/reviews', server, 409);
      expect(await repo.sync.revision()).toBe(revision);

      expect(second.cancellationId).toBe(cancellation.id);
      await send(command, '/api/reviews/undo', other, 404);
      expect(second.card.reps).toBe(1);
      expect(await history(card.id)).toHaveLength(3);
    });
    it('recoverable deletion retains late answers and cancellations; purge rejects new events but acknowledges exact committed retries', async () => {
      const { note, card } = await fixture();
      await repo.notes.softDelete(note.id);
      const a = answer(card.id);
      await send(a);
      const cancellation = undo(a.id);
      await send(cancellation, '/api/reviews/undo');
      await repo.purge.remove('notes', note.id);
      expect(reviewResultSchema.parse(await send(a)).applied).toBe(false);
      expect(
        undoReviewResultSchema.parse(await send(cancellation, '/api/reviews/undo')).cancellationId,
      ).toBe(cancellation.id);
      await send(answer(card.id), '/api/reviews', server, 404);
      expect(await history(card.id)).toHaveLength(2);
      expect(await repo.notes.byId(note.id)).toBeUndefined();
    });
    it('restart remains an immutable canonical boundary when an older offline answer and its Undo arrive afterwards', async () => {
      const { deck, card } = await fixture();
      const a = answer(card.id);
      await send(a);
      const restartId = uuidV7();
      await repo.reviews.restartDeck(deck.id, restartId);
      const late = answer(card.id, '2026-01-04T10:00:00.000Z');
      await send(late);
      await send(undo(late.id), '/api/reviews/undo');
      await send(undo(a.id), '/api/reviews/undo');
      expect(await repo.reviews.rebuild(card.id)).toMatchObject({
        state: 'new',
        reps: 0,
        learningStep: 0,
      });
      expect((await history(card.id)).filter((row) => row.row['resetsLearning'])).toHaveLength(1);
      expect(await repo.reviews.countForCards([card.id])).toBe(2);
    });
    it('late delivery retains learning steps and FSRS across the original timezone/day-cutoff boundary', async () => {
      const { card } = await fixture();
      const preferences = await repo.account.read();
      await repo.account.updatePreferences({ timezone: 'Europe/Minsk', dayCutoffHour: 4 });
      try {
        const config = createSchedulerConfig({ timezone: 'Europe/Minsk', dayCutoffHour: 4 });
        const a = { ...answer(card.id, '2026-01-02T00:30:00.000Z'), rating: 'again' };
        const b = answer(card.id, '2026-01-02T02:30:00.000Z');
        // Delayed delivery arrives in reverse order, while replay remains canonical.
        await send(b);
        const initial = review(
          newCard(card.due),
          RATING.again,
          new Date(a.reviewedAt),
          config,
          createSeededRandom(reviewSeed(a.id)),
          a.durationMs,
        ).next;
        const expected = review(
          initial,
          RATING.good,
          new Date(b.reviewedAt),
          config,
          createSeededRandom(reviewSeed(b.id)),
          b.durationMs,
        ).next;
        await send(a);
        expect(await repo.reviews.rebuild(card.id)).toEqual(expected);
        expect(
          (await repo.reviews.forCard(card.id)).map((entry) => entry.reviewedAt.toISOString()),
        ).toEqual([a.reviewedAt, b.reviewedAt]);
        await send(undo(b.id), '/api/reviews/undo');
        expect(await repo.reviews.rebuild(card.id)).toEqual(initial);
        expect(initial.state).toBe('learning');
        expect(await history(card.id)).toHaveLength(3);
      } finally {
        await repo.account.updatePreferences({
          timezone: preferences.timezone,
          dayCutoffHour: preferences.dayCutoffHour,
        });
      }
    });
    it('a foreign account and an expired session cannot acknowledge either answers or cancellations', async () => {
      const { card } = await fixture();
      const a = answer(card.id);
      await send(a);
      await send(a, '/api/reviews', other, 404);
      await send(undo(a.id), '/api/reviews/undo', other, 404);
      await send(answer(card.id), '/api/reviews', signedOutServer(database!), 401);
      await send(undo(a.id), '/api/reviews/undo', signedOutServer(database!), 401);
      expect(await history(card.id)).toHaveLength(1);
      const foreignRepo = repositoriesFor(database!, `${owner}-other`);
      expect(
        (await foreignRepo.sync.pull(0, 1000)).changes.some((row) => row.entity === 'reviews'),
      ).toBe(false);
    });
  },
);

import { beforeAll, describe, expect, it } from 'vitest';

import {
  RATING,
  newCard,
  review,
  createSchedulerConfig,
  createSeededRandom,
  reviewSeed,
} from '@neuron/core';
import { uuidV7 } from '@neuron/shared';

import { createUser, repositoriesFor, testDatabase } from '../testing/database.js';

import type { Repositories } from './index.js';

const database = testDatabase();
describe.skipIf(!database)('append-only recent answer compensation', () => {
  let repo: Repositories;
  beforeAll(async () => {
    await createUser(database!, 'review-compensation');
    repo = repositoriesFor(database!, 'review-compensation');
  });
  it('preserves the original event, restores first-card due, and replays a replacement', async () => {
    const deck = await repo.decks.create({ name: uuidV7() });
    const note = await repo.notes.create({
      deckId: deck.id,
      noteType: 'basic',
      fields: { front: 'Question', back: 'Answer' },
    });
    const card = await repo.cards.create({
      noteId: note.id,
      direction: 'recognition',
      due: new Date('2026-01-02'),
    });
    const original = await repo.reviews.record({
      id: uuidV7(),
      cardId: card.id,
      rating: RATING.easy,
      now: new Date('2026-09-15T10:00:00Z'),
    });
    const eventId = uuidV7();
    const restored = await repo.reviews.undo(original.review.id, eventId);
    expect(restored).toMatchObject({
      due: card.due,
      state: 'new',
      reps: 0,
      stability: null,
      lastReview: null,
    });
    expect(await repo.reviews.rebuild(card.id)).toMatchObject({
      state: 'new',
      due: card.due,
      reps: 0,
    });
    expect(await repo.reviews.forCard(card.id)).toEqual([]);
    expect(await repo.reviews.workload()).toEqual([]);
    const count = await repo.reviews.countForCards([card.id]);
    expect(count).toBe(1);
    await repo.reviews.undo(original.review.id, eventId);
    expect(await repo.reviews.countForCards([card.id])).toBe(count);
    const changes = (await repo.sync.pull(0, 1000)).changes.filter(
      (row) => row.entity === 'reviews',
    );
    expect(changes.find((row) => row.id === original.review.id)?.row['cancelsReviewId']).toBeNull();
    expect(changes.find((row) => row.id === eventId)?.row['cancelsReviewId']).toBe(
      original.review.id,
    );
    const replacement = await repo.reviews.record({
      id: uuidV7(),
      cardId: card.id,
      rating: RATING.good,
      now: new Date('2026-09-15T10:01:00Z'),
    });
    expect(await repo.reviews.rebuild(card.id)).toEqual(replacement.state);
    const later = await repo.reviews.record({
      id: uuidV7(),
      cardId: card.id,
      rating: RATING.hard,
      now: new Date('2026-09-16T10:01:00Z'),
    });
    await repo.reviews.undo(later.review.id, uuidV7());
    expect(await repo.reviews.rebuild(card.id)).toEqual(replacement.state);
  });

  it('undoes A after B without erasing B, independent of arrival order', async () => {
    const aId = uuidV7();
    const bId = uuidV7();
    const initial = newCard(new Date('2026-01-01'));
    const config = createSchedulerConfig({ timezone: 'UTC' });
    const expected = review(
      initial,
      RATING.easy,
      new Date('2026-01-04'),
      config,
      createSeededRandom(reviewSeed(bId)),
    ).next;
    // Each ordering gets its own owner so the same immutable event ids are not reused.
    // UUID ids are globally unique, so compare each result against its own seeded B.
    for (const reverse of [false, true]) {
      const deck = await repo.decks.create({ name: uuidV7() });
      const note = await repo.notes.create({
        deckId: deck.id,
        noteType: 'basic',
        fields: { front: 'Merge', back: 'History' },
      });
      const card = await repo.cards.create({
        noteId: note.id,
        direction: 'recognition',
        due: initial.due,
      });
      const A = {
        id: reverse ? uuidV7() : aId,
        cardId: card.id,
        rating: RATING.good,
        now: new Date('2026-01-02'),
      };
      const B = {
        id: reverse ? uuidV7() : bId,
        cardId: card.id,
        rating: RATING.easy,
        now: new Date('2026-01-04'),
      };
      for (const answer of reverse ? [B, A] : [A, B]) await repo.reviews.record(answer);
      const eventId = uuidV7();
      const undone = await repo.reviews.undo(A.id, eventId);
      const target = reverse
        ? review(initial, RATING.easy, B.now, config, createSeededRandom(reviewSeed(B.id))).next
        : expected;
      expect(await repo.reviews.rebuild(card.id)).toEqual(target);
      expect(undone).toMatchObject({ reps: 1, due: target.due, stability: target.stability });
      await repo.reviews.undo(A.id, eventId);
      await repo.reviews.undo(A.id, uuidV7());
      expect(await repo.reviews.countForCards([card.id])).toBe(2);
    }
  });
});

import { beforeAll, describe, expect, it } from 'vitest';

import { RATING } from '@neuron/core';
import type { SchedulingState } from '@neuron/core';
import { uuidV7 } from '@neuron/shared';
import type { Card, DailyStudySession, Note, ReviewBatchResult } from '@neuron/shared';

import { createUser, repositoriesFor, testDatabase } from '../db/testing/database.js';
import { json, testServer } from '../testing/server.js';

import type { Repositories } from '../db/repositories/index.js';
import type { Hono } from 'hono';

/**
 * Progressive directions over the real routes, repositories and PostgreSQL.
 *
 * The rule is proved in packages/shared. What is proved here is that the
 * server applies it exactly once whoever delivers the answer, that Undo takes
 * back only what the undone answer opened, that existing learners catch up,
 * and that nothing about it can produce a second Card for one direction.
 */

const database = testDatabase();
const OWNER = 'progression-owner';
const STRANGER = 'progression-stranger';
const DAY = 86_400_000;

/** A recognition Card answered before, holding `stability` days, due now. */
function reviewed(stability: number, now = new Date()): SchedulingState {
  return {
    state: 'review',
    stability,
    difficulty: 5,
    due: new Date(now.getTime() - DAY),
    lastReview: new Date(now.getTime() - Math.round(stability) * DAY),
    reps: 4,
    lapses: 0,
    learningStep: 0,
  };
}

describe.skipIf(!database)('progressive directions', () => {
  let repositories: Repositories;
  let server: Hono;

  beforeAll(async () => {
    await createUser(database!, OWNER);
    await createUser(database!, STRANGER);
    repositories = repositoriesFor(database!, OWNER);
    server = testServer(database!, OWNER);
  });

  async function post<T>(path: string, body: unknown, expected = 200): Promise<T> {
    return json<T>(
      await server.request(`/api/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      expected,
    );
  }

  /** A live vocabulary Note whose recognition Card holds `stability`. */
  async function word(stability: number | null, options: { deckId?: string } = {}) {
    const deckId = options.deckId ?? (await repositories.decks.create({ name: uuidV7() })).id;
    const note = await repositories.notes.create({
      deckId,
      noteType: 'vocab',
      fields: { term: `Wort ${uuidV7()}`, translation: 'word' },
    });
    const card = await repositories.cards.create({
      noteId: note.id,
      direction: 'recognition',
      due: new Date(Date.now() - DAY),
      unlockReason: 'opening',
      ...(stability === null ? {} : { scheduling: reviewed(stability) }),
    });
    return { deckId, note, card };
  }

  const directions = async (noteId: string) =>
    (await repositories.cards.forNote(noteId)).map((card) => card.direction).sort();

  async function answer(
    cardId: string,
    rating: 'again' | 'good' | 'easy',
    id = uuidV7(),
    reviewedAt = new Date(),
  ) {
    return post<{ card: Card }>('reviews', {
      id,
      cardId,
      rating,
      reviewedAt: reviewedAt.toISOString(),
      durationMs: 3000,
    });
  }

  it('starts a new vocabulary Note on the opening direction only', async () => {
    const deck = await repositories.decks.create({ name: uuidV7() });
    const created = await post<{ note: Note; cards: Card[] }>(
      'notes',
      { deckId: deck.id, noteType: 'vocab', fields: { term: 'die Wahl', translation: 'choice' } },
      201,
    );
    expect(created.cards.map((card) => [card.direction, card.unlockReason])).toEqual([
      ['recognition', 'opening'],
    ]);
  });

  it('opens recall from the answer that reaches 14 days, keeping every identity', async () => {
    const { note, card } = await word(10);
    const reviewId = uuidV7();
    const reviewedAt = new Date();
    const result = await answer(card.id, 'good', reviewId, reviewedAt);

    expect(result.card.stability).toBeGreaterThanOrEqual(14);
    const all = await repositories.cards.forNote(note.id);
    const recall = all.find((row) => row.direction === 'recall');
    expect(recall).toMatchObject({
      state: 'new',
      reps: 0,
      stability: null,
      unlockReason: 'ladder',
      unlockedByReviewId: reviewId,
    });
    // The recognition Card keeps its identity, schedule and history.
    expect(all.find((row) => row.direction === 'recognition')?.id).toBe(card.id);
    expect(await repositories.reviews.countForCards([card.id])).toBe(1);
    expect(await repositories.reviews.countForCards([recall!.id])).toBe(0);
    expect(await repositories.reviews.rebuild(card.id)).toMatchObject({ reps: 5 });

    // Delivering the same answer again opens nothing more.
    await answer(card.id, 'good', reviewId, reviewedAt);
    expect(await directions(note.id)).toEqual(['recall', 'recognition']);
  });

  it('opens nothing below the threshold', async () => {
    const { note, card } = await word(3);
    const result = await answer(card.id, 'again');
    expect(result.card.stability).toBeLessThan(14);
    expect(await directions(note.id)).toEqual(['recognition']);
  });

  it('opens typing only from recall, and never a direction twice', async () => {
    const { note, card } = await word(10);
    await answer(card.id, 'good');
    const recall = (await repositories.cards.forNote(note.id)).find(
      (row) => row.direction === 'recall',
    )!;
    await repositories.cards.putState(recall.id, reviewed(12));
    await answer(recall.id, 'good');
    expect(await directions(note.id)).toEqual(['production', 'recall', 'recognition']);
    // Recognition answered far past every threshold changes nothing more.
    await answer(card.id, 'easy');
    expect(await directions(note.id)).toEqual(['production', 'recall', 'recognition']);
  });

  it('opens once for a whole offline batch, and again for its exact retry', async () => {
    const { note, card } = await word(10);
    const now = Date.now();
    const reviews = [0, 1].map((offset) => ({
      id: uuidV7(),
      cardId: card.id,
      rating: 'good',
      reviewedAt: new Date(now - (2 - offset) * 60_000).toISOString(),
      durationMs: 2000,
    }));
    await post<ReviewBatchResult>('reviews/batch', { reviews });
    await post<ReviewBatchResult>('reviews/batch', { reviews });
    expect(await directions(note.id)).toEqual(['recall', 'recognition']);
  });

  it('opens from answers pushed through synchronization', async () => {
    const { note, card } = await word(10);
    await post('sync', {
      reviews: [
        {
          id: uuidV7(),
          cardId: card.id,
          rating: 'good',
          reviewedAt: new Date().toISOString(),
          durationMs: 1000,
        },
      ],
    });
    expect(await directions(note.id)).toEqual(['recall', 'recognition']);
  });

  it('takes back what an undone answer opened, then opens it again on the redo', async () => {
    const { note, card } = await word(10);
    const reviewId = uuidV7();
    await answer(card.id, 'good', reviewId);
    const opened = (await repositories.cards.forNote(note.id)).find(
      (row) => row.direction === 'recall',
    )!;

    await post('reviews/undo', { id: uuidV7(), reviewId });
    expect(await directions(note.id)).toEqual(['recognition']);
    // The retraction travels to other devices as a tombstone.
    const tombstone = (await repositories.sync.pull(0, 5000)).changes.find(
      (row) => row.id === opened.id,
    );
    expect(tombstone?.deleted).toBe(true);
    // The original answer is still in the log, cancelled, never removed.
    expect(await repositories.reviews.countForCards([card.id])).toBe(1);

    await answer(card.id, 'good');
    const again = await repositories.cards.forNote(note.id);
    expect(again.map((row) => row.direction).sort()).toEqual(['recall', 'recognition']);
    expect(again.find((row) => row.direction === 'recall')?.id).not.toBe(opened.id);
  });

  it('keeps a direction the undone answer opened once it has been answered', async () => {
    const { note, card } = await word(10);
    const reviewId = uuidV7();
    await answer(card.id, 'good', reviewId);
    const recall = (await repositories.cards.forNote(note.id)).find(
      (row) => row.direction === 'recall',
    )!;
    await answer(recall.id, 'good');
    await post('reviews/undo', { id: uuidV7(), reviewId });
    const after = await repositories.cards.forNote(note.id);
    expect(after.find((row) => row.direction === 'recall')).toMatchObject({
      id: recall.id,
      reps: 1,
    });
  });

  it('keeps a direction the undone answer opened while the Note still qualifies', async () => {
    // Recognition already held 30 days before this answer, so it still qualifies.
    const { note, card } = await word(30);
    const reviewId = uuidV7();
    await answer(card.id, 'good', reviewId);
    await post('reviews/undo', { id: uuidV7(), reviewId });
    expect(await directions(note.id)).toEqual(['recall', 'recognition']);
  });

  it('never takes a direction back for a lapse', async () => {
    const { note, card } = await word(10);
    await answer(card.id, 'good');
    const lapsed = await answer(card.id, 'again');
    expect(lapsed.card.stability).toBeLessThan(14);
    expect(await directions(note.id)).toEqual(['recall', 'recognition']);
  });

  it('keeps opened directions through a reset of the predecessor', async () => {
    const { note, card } = await word(10);
    await answer(card.id, 'good');
    await post(`cards/${card.id}/reset`, {});
    expect(await directions(note.id)).toEqual(['recall', 'recognition']);
  });

  it('catches up an existing learner when Study plans, once', async () => {
    const deck = await repositories.decks.create({ name: uuidV7() });
    const ready = await Promise.all([30, 45, 90].map(() => word(30, { deckId: deck.id })));
    const young = await word(5, { deckId: deck.id });
    const suspended = await word(60, { deckId: deck.id });
    await repositories.cards.suspend(suspended.card.id);
    const known = await word(60, { deckId: deck.id });
    await repositories.notes.setStatus(known.note.id, 'known');

    const plan = await post<DailyStudySession & { planningContext: { revision: number } }>(
      'study/session',
      { deckIds: [deck.id], minutes: 60 },
    );
    for (const { note } of ready)
      expect(await directions(note.id)).toEqual(['recall', 'recognition']);
    expect(await directions(young.note.id)).toEqual(['recognition']);
    expect(await directions(suspended.note.id)).toEqual(['recognition']);
    expect(await directions(known.note.id)).toEqual(['recognition']);
    const opened = (await repositories.cards.forNote(ready[0]!.note.id)).find(
      (row) => row.direction === 'recall',
    );
    expect(opened).toMatchObject({ unlockReason: 'ladder', unlockedByReviewId: null });
    expect(plan.planningContext.revision).toBe((await repositories.account.read()).currentRev);
    // The opened Cards are new material the throttle admits, never extra.
    const newInPlan = plan.cards.filter((card) => card.state === 'new');
    expect(newInPlan.length).toBe(plan.newCount);
    expect(plan.newCount).toBeLessThanOrEqual(plan.newCards.allowed);

    const before = (await repositories.account.read()).currentRev;
    await post('study/session', { deckIds: [deck.id], minutes: 60 });
    expect((await repositories.account.read()).currentRev).toBe(before);
  });

  it('follows the ladder inherited from a Folder and a Deck override', async () => {
    const folder = await repositories.decks.create({ name: uuidV7(), kind: 'folder' });
    await repositories.decks.updateSettings(folder.id, {
      ladder: [
        { direction: 'recognition', opensAtStability: 0 },
        { direction: 'recall', opensAtStability: 3 },
      ],
    });
    const inherits = await repositories.decks.create({ name: uuidV7(), parentId: folder.id });
    const overrides = await repositories.decks.create({ name: uuidV7(), parentId: folder.id });
    await repositories.decks.updateSettings(overrides.id, {
      ladder: [
        { direction: 'recognition', opensAtStability: 0 },
        { direction: 'recall', opensAtStability: 500 },
      ],
    });
    const low = await word(5, { deckId: inherits.id });
    const high = await word(5, { deckId: overrides.id });
    await post('study/session', { deckIds: [inherits.id, overrides.id], minutes: 30 });
    expect(await directions(low.note.id)).toEqual(['recall', 'recognition']);
    expect(await directions(high.note.id)).toEqual(['recognition']);
  });

  it('progresses Basic Notes to recall only, and Cloze Notes not at all', async () => {
    const deck = await repositories.decks.create({ name: uuidV7() });
    const basic = await repositories.notes.create({
      deckId: deck.id,
      noteType: 'basic',
      fields: { front: 'Frage', back: 'question' },
    });
    const basicCard = await repositories.cards.create({
      noteId: basic.id,
      direction: 'recognition',
      due: new Date(),
      scheduling: reviewed(40),
    });
    const cloze = await repositories.notes.create({
      deckId: deck.id,
      noteType: 'cloze',
      fields: { text: 'Ich {{stehe}} früh auf.' },
    });
    await repositories.cards.create({
      noteId: cloze.id,
      direction: 'cloze',
      slot: 1,
      due: new Date(),
      scheduling: reviewed(400),
    });
    await post('study/session', { deckIds: [deck.id] });
    const recall = (await repositories.cards.forNote(basic.id)).find(
      (row) => row.direction === 'recall',
    )!;
    await repositories.cards.putState(recall.id, reviewed(400));
    await answer(recall.id, 'good');
    await answer(basicCard.id, 'good');
    expect(await directions(basic.id)).toEqual(['recall', 'recognition']);
    expect(await directions(cloze.id)).toEqual(['cloze']);
  });

  it('opens nothing in a deleted Deck or for a deleted Note', async () => {
    const gone = await word(40);
    await repositories.notes.softDelete(gone.note.id);
    const inDeleted = await word(10);
    await repositories.decks.softDelete(inDeleted.deckId);
    await post('study/session', {});
    // A late answer to a Card in a deleted Deck is history, never progress.
    await answer(inDeleted.card.id, 'good');
    expect((await repositories.cards.forNote(gone.note.id)).length).toBe(0);
    const remaining = await repositories.sync.pull(0, 5000);
    const opened = remaining.changes.filter(
      (row) =>
        row.entity === 'cards' &&
        [gone.note.id, inDeleted.note.id].includes(String(row.row['noteId'])) &&
        row.row['direction'] === 'recall',
    );
    expect(opened).toEqual([]);
  });

  it('leaves exactly one Card when manual opening races qualifying answers', async () => {
    for (let round = 0; round < 4; round += 1) {
      const { note, card } = await word(10);
      const responses = await Promise.all([
        ...Array.from({ length: 3 }, () =>
          server.request(`/api/notes/${note.id}/cards`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ direction: 'recall' }),
          }),
        ),
        answer(card.id, 'good').then(() => new Response(null, { status: 200 })),
        post<ReviewBatchResult>('reviews/batch', {
          reviews: [
            {
              id: uuidV7(),
              cardId: card.id,
              rating: 'good',
              reviewedAt: new Date(Date.now() - 1000).toISOString(),
              durationMs: 1000,
            },
          ],
        }).then(() => new Response(null, { status: 200 })),
        post('study/session', { deckIds: [note.deckId] }).then(
          () => new Response(null, { status: 200 }),
        ),
      ]);
      for (const response of responses) expect([200, 201, 409]).toContain(response.status);
      expect(responses.filter((response) => response.status === 201).length).toBeLessThanOrEqual(1);
      const recall = (await repositories.cards.forNote(note.id)).filter(
        (row) => row.direction === 'recall',
      );
      expect(recall).toHaveLength(1);
    }
  });

  it('records a manual opening as manual and refuses it once the direction is open', async () => {
    const { note } = await word(null);
    const opened = await post<{ card: Card }>(
      `notes/${note.id}/cards`,
      { direction: 'production' },
      201,
    );
    expect(opened.card.unlockReason).toBe('manual');
    const again = await server.request(`/api/notes/${note.id}/cards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ direction: 'production' }),
    });
    expect(again.status).toBe(409);
  });

  it('never reaches another account', async () => {
    const { note, card } = await word(10);
    const stranger = testServer(database!, STRANGER);
    const answered = await stranger.request('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: uuidV7(),
        cardId: card.id,
        rating: 'good',
        reviewedAt: new Date().toISOString(),
      }),
    });
    expect(answered.status).toBe(404);
    const opened = await stranger.request(`/api/notes/${note.id}/cards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ direction: 'recall' }),
    });
    expect(opened.status).toBe(404);
    expect(
      await repositoriesFor(database!, STRANGER).cards.sweepProgression([note.deckId], new Date()),
    ).toEqual([]);
    expect(await directions(note.id)).toEqual(['recognition']);
  });

  it('keeps the rating constant used by the fixtures honest', () => {
    expect(RATING.good).toBe(3);
  });
});

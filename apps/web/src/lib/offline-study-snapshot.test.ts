import { describe, expect, it } from 'vitest';

import { createSchedulerConfig, createSeededRandom, review, seedFromReviewId } from '@neuron/core';
import type { Card, Me } from '@neuron/shared';

import { planDownloadedStudy, schedulingOf } from './offline-study-snapshot';

import type { CollectionRow } from './collection-db';
import type { StudySnapshot } from './offline-study-snapshot';
import type { PendingReview } from './review-intent';

const id = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const now = new Date('2026-10-15T12:00:00.000Z');
const past = '2026-10-01T12:00:00.000Z';
const accountId = 'offline-planner';
const scheduler = createSchedulerConfig({ timezone: 'UTC', dayCutoffHour: 4 });
function row(entity: CollectionRow['entity'], data: object, rev = 4): CollectionRow {
  const value = data as Record<string, unknown>;
  return {
    entity,
    id: String(value['id']),
    rev,
    deleted: false,
    purged: false,
    row: { ...value, rev },
  };
}
function snapshot(): StudySnapshot {
  const decks = [1, 2].map((n) =>
    row('decks', {
      id: id(n),
      name: `Deck ${n}`,
      kind: 'deck',
      parentId: null,
      position: n,
      settings: { targetLanguage: n === 1 ? 'de' : 'en' },
      createdAt: past,
      updatedAt: past,
    }),
  );
  const notes = [1, 2, 3, 4].map((n) =>
    row('notes', {
      id: id(10 + n),
      deckId: id(n < 3 ? 1 : 2),
      noteTypeId: id(99),
      noteType: 'basic',
      fields: { front: `Question ${n}`, back: `Answer ${n}` },
      tags: [],
      source: null,
      rank: null,
      status: 'active',
      importBatchId: null,
      createdAt: past,
      updatedAt: past,
    }),
  );
  const cards = notes.map((note, n) =>
    row('cards', {
      id: id(20 + n),
      noteId: note.id,
      deckId: note.row['deckId'],
      direction: 'recognition',
      slot: 0,
      state: 'new',
      stability: null,
      difficulty: null,
      due: past,
      lastReview: null,
      reps: 0,
      lapses: 0,
      learningStep: 0,
      suspendedAt: null,
      unlockedAt: past,
      resetAt: null,
      updatedAt: past,
    }),
  );
  return {
    account: {
      id: accountId,
      name: 'Learner',
      email: 'learner@example.test',
      image: null,
      locale: 'en',
      theme: 'dark',
      timezone: 'UTC',
      dayCutoffHour: 4,
      plan: 'free',
      settings: { budgetMinutes: [30, 30, 30, 30, 30, 30, 30], maximumNewCardsPerDay: 1 },
      twoFactorEnabled: false,
      revision: 4,
    },
    complete: true,
    cursor: 4,
    reviewSequence: 0,
    decks,
    notes,
    cards,
    reviews: [],
    edits: [],
    events: [],
  };
}
function answer(
  card: Card,
  sequence = 1,
  rating: 'good' | 'easy' = 'easy',
  time = now.toISOString(),
): PendingReview {
  return {
    kind: 'review-event',
    operationId: id(100 + sequence),
    accountId,
    sessionId: id(200 + sequence),
    sequence,
    predecessor: null,
    before: card,
    state: 'pending',
    event: {
      type: 'answer',
      payload: {
        id: id(100 + sequence),
        cardId: card.id,
        rating,
        reviewedAt: time,
        durationMs: 4000,
      },
    },
  };
}
function commit(s: StudySnapshot, entry: PendingReview) {
  s.events.push(entry);
  s.reviewSequence++;
}
function serverAnswer(s: StudySnapshot, index: number, n: number, time: string) {
  const stored = s.cards[index]!;
  const card = stored.row as unknown as Card;
  const before = schedulingOf(card);
  const result = review(
    before,
    4,
    new Date(time),
    scheduler,
    createSeededRandom(seedFromReviewId(id(n))),
    4000,
  );
  const log = result.log;
  const serial = (value: object) => JSON.parse(JSON.stringify(value));
  s.reviews.push(
    row('reviews', {
      id: id(n),
      cardId: card.id,
      rating: 'easy',
      reviewedAt: time,
      submittedAt: time,
      durationMs: 4000,
      elapsedDays: log.elapsedDays,
      scheduledDays: log.scheduledDays,
      placedDue: log.placedDue.toISOString(),
      stateBefore: log.stateBefore,
      stabilityBefore: log.stabilityBefore ?? null,
      difficultyBefore: log.difficultyBefore ?? null,
      resetsLearning: false,
      restartId: null,
      cancelsReviewId: null,
      priorState: {
        ...serial(before),
        stability: before.stability ?? null,
        difficulty: before.difficulty ?? null,
        lastReview: before.lastReview?.toISOString() ?? null,
      },
    }),
  );
  stored.row = {
    ...stored.row,
    ...serial(result.next),
    stability: result.next.stability ?? null,
    difficulty: result.next.difficulty ?? null,
    lastReview: result.next.lastReview?.toISOString() ?? null,
  };
  return { before: card, after: stored.row as unknown as Card };
}
const plan = (s: StudySnapshot, body = {}, time = now) =>
  planDownloadedStudy(s, accountId, body, time);

describe('downloaded Study authority and committed history', () => {
  it('admits one language with the existing shared daily new-card ceiling', () => {
    const s = snapshot();
    const first = plan(s, { targetLanguage: 'de' });
    expect(first.offlineStudy.limit).toBeNull();
    expect(first.newCount).toBe(1);
    expect(first.languages).toEqual(['de', 'en']);
    expect(first.cards.every((card) => card.deckId === id(1))).toBe(true);
    commit(s, answer(first.cards[0]!));
    expect(plan(s, { targetLanguage: 'en' }).newCount).toBe(0);
    expect(plan(s, { targetLanguage: 'de' }).cards.map((card) => card.id)).not.toContain(
      first.cards[0]!.id,
    );
  });

  it('projects a previous offline sitting and its immutable Undo before the next admission', () => {
    const s = snapshot();
    const first = plan(s).cards[0]!;
    const event = answer(first);
    commit(s, event);
    const undo: PendingReview = {
      ...event,
      operationId: id(102),
      sequence: 2,
      predecessor: event.operationId,
      event: {
        type: 'undo',
        payload: { id: id(102), reviewId: event.operationId, reviewedAt: now.toISOString() },
      },
    };
    commit(s, undo);
    expect(plan(s).newCount).toBe(1);
    expect(plan(s).cards[0]!.id).toBe(first.id);
    expect(s.events).toHaveLength(2);
  });

  it('waits for retry instants and permits learning steps in a subsequent sitting', () => {
    const s = snapshot();
    const first = plan(s).cards[0]!;
    commit(s, answer(first, 1, 'good'));
    expect(plan(s).cards).toHaveLength(0);
    const retry = plan(s, {}, new Date(now.getTime() + 11 * 60_000));
    expect(retry.cards[0]?.id).toBe(first.id);
    expect(retry.cards[0]?.state).toBe('learning');
    expect(retry.reviewCount).toBe(1);
  });

  it('deduplicates a lost server acknowledgement against downloaded Review identity', () => {
    const s = snapshot();
    const first = plan(s).cards[0]!;
    const index = s.cards.findIndex((card) => card.id === first.id);
    serverAnswer(s, index, 101, now.toISOString());
    commit(s, answer(first));
    expect(plan(s).offlineStudy.limit).toBeNull();
    expect(plan(s, { targetLanguage: 'en' }).newCount).toBe(0);
    const changed = structuredClone(s);
    const altered = changed.events[0] as PendingReview;
    if (altered.event.type === 'answer') altered.event.payload.rating = 'good';
    expect(() => plan(changed)).toThrow('offline_study_history');
  });

  it('uses the study-day cutoff rather than civil midnight for the daily introduction budget', () => {
    const s = snapshot();
    const first = plan(s).cards[0]!;
    commit(s, answer(first, 1, 'easy', '2026-10-15T03:59:00.000Z'));
    expect(plan(s, { targetLanguage: 'en' }, new Date('2026-10-15T03:59:30.000Z')).newCount).toBe(
      0,
    );
    expect(plan(s, { targetLanguage: 'en' }, new Date('2026-10-15T04:00:00.000Z')).newCount).toBe(
      1,
    );
  });

  it('keeps an unrelated due review available while settings uncertainty blocks new material and override', () => {
    const s = snapshot();
    serverAnswer(s, 0, 301, past);
    (s.account as { revision: number }).revision = 3;
    const result = plan(s, { newCards: 'override' });
    expect(result.offlineStudy.limit).toBe('settings');
    expect(result.newCount).toBe(0);
    expect(result.reviewCount).toBe(1);
  });

  it('withholds missing-history cards and new material while retaining other correct due work', () => {
    const s = snapshot();
    serverAnswer(s, 0, 301, past);
    serverAnswer(s, 1, 302, past);
    s.reviews.shift();
    const result = plan(s, { newCards: 'override' });
    expect(result.offlineStudy.limit).toBe('history');
    expect(result.newCount).toBe(0);
    expect(result.cards.map((card) => card.id)).toEqual([s.cards[1]!.id]);
  });

  it.each(['rejected', 'archived'] as const)(
    'retains %s events and blocks affected work without silently acknowledging it',
    (state) => {
      const s = snapshot();
      serverAnswer(s, 1, 302, past);
      const first = plan(s).cards.find((card) => card.state === 'new')!;
      const event = { ...answer(first), state };
      commit(s, event);
      expect(plan(s).offlineStudy.limit).toBe('recovery');
      expect(plan(s).newCount).toBe(0);
      expect(plan(s).reviewCount).toBe(1);
      expect(s.events[0]).toBe(event);
    },
  );

  it('allows explicit override only when the full local admission decision is supported', () => {
    const s = snapshot();
    (s.account as { settings: { maximumNewCardsPerDay: number } }).settings.maximumNewCardsPerDay =
      0;
    expect(plan(s).newCount).toBe(0);
    expect(plan(s, { newCards: 'override' }).newCount).toBeGreaterThan(0);
    s.complete = false;
    expect(() => plan(s, { newCards: 'override' })).toThrow('offline_study_incomplete');
  });

  it('never studies provisional Note content or generates new Card identities', () => {
    const s = snapshot();
    s.edits.push({ kind: 'note-edit', entityId: s.notes[0]!.id, state: 'pending' });
    const before = JSON.stringify(s.cards);
    const result = plan(s);
    expect(result.offlineStudy.limit).toBe('content');
    expect(result.newCount).toBe(0);
    expect(JSON.stringify(s.cards)).toBe(before);
  });

  it('restricts admission when a complete marker has missing referenced content', () => {
    const s = snapshot();
    serverAnswer(s, 1, 302, past);
    s.notes = s.notes.filter((note) => note.id !== s.cards[0]!.row['noteId']);
    const result = plan(s, { newCards: 'override' });
    expect(result.offlineStudy.limit).toBe('content');
    expect(result.newCount).toBe(0);
    expect(result.cards.map((card) => card.id)).toEqual([s.cards[1]!.id]);
  });

  it('uses newer visit settings for safe due work and withholds new admission against older metadata', () => {
    const s = snapshot();
    serverAnswer(s, 1, 302, past);
    const known = structuredClone(s.account) as Me;
    known.revision++;
    known.settings = {
      ...known.settings,
      maximumNewCardsPerDay: 20,
      budgetMinutes: [7, 7, 7, 7, 7, 7, 7],
      allowCarryOver: false,
    };
    const result = planDownloadedStudy(s, accountId, { newCards: 'override' }, now, known);
    expect(result.offlineStudy.limit).toBe('settings');
    expect(result.budgetMinutes).toBe(7);
    expect(result.newCount).toBe(0);
    expect(result.cards.map((card) => card.id)).toEqual([s.cards[1]!.id]);
    expect(
      planDownloadedStudy(s, accountId, {}, now, { ...known, revision: s.cursor }).offlineStudy
        .limit,
    ).toBe('settings');
    expect(() => planDownloadedStudy(s, accountId, {}, now, { ...known, id: 'another' })).toThrow(
      'offline_study_account',
    );
  });

  it('refuses missing causal entries, another account and incompatible settings', () => {
    const s = snapshot();
    s.reviewSequence = 1;
    expect(() => plan(s)).toThrow('offline_study_history');
    s.reviewSequence = 0;
    expect(() => planDownloadedStudy(s, 'another-account', {}, now)).toThrow(
      'offline_study_account',
    );
    (s.account as { settings: unknown }).settings = { maximumNewCardsPerDay: -1 };
    expect(() => plan(s)).toThrow('offline_study_settings');
  });

  it('does not resume later work in a rejected causal sitting even on another Card', () => {
    const s = snapshot();
    const first = plan(s).cards[0]!;
    const base = answer(first);
    const rejected: PendingReview = { ...base, state: 'rejected' };
    const secondCard = s.cards.find((row) => row.id !== first.id)!.row as unknown as Card;
    const second: PendingReview = {
      ...answer(secondCard, 2),
      sessionId: base.sessionId,
      predecessor: base.operationId,
    };
    const thirdCard = s.cards.find((row) => row.id !== first.id && row.id !== secondCard.id)!
      .row as unknown as Card;
    const third: PendingReview = {
      ...answer(thirdCard, 3),
      sessionId: base.sessionId,
      predecessor: second.operationId,
    };
    commit(s, rejected);
    commit(s, second);
    commit(s, third);
    const result = plan(s, { newCards: 'override' });
    expect(result.offlineStudy.limit).toBe('recovery');
    expect(result.cards).toEqual([]);
    expect(s.events).toEqual([rejected, second, third]);
  });
});

import { describe, expect, it } from 'vitest';

import { createSchedulerConfig } from '../fsrs/parameters.js';
import { createSeededRandom } from '../fsrs/random.js';
import { MS_PER_DAY } from '../time/day.js';

import { createBudget } from './budget.js';
import { freshCard, reviewCard } from './cards.js';
import { createWorkloadConfig } from './config.js';
import {
  buildSession,
  createSessionQueue,
  queueSessionRetry,
  takeNextSessionCard,
} from './session.js';

import type { WorkloadCard } from './types.js';

const NOW = new Date('2026-08-05T12:00:00Z');

const config = createWorkloadConfig({
  scheduler: createSchedulerConfig({ enableFuzz: false, timezone: 'UTC', dayCutoffHour: 4 }),
});

/** Twenty minutes every day. At six seconds a card that is two hundred cards. */
const budget = createBudget({ minutesByWeekday: [20, 20, 20, 20, 20, 20, 20] });

const rng = (): (() => number) => createSeededRandom(42);

/** Cards due today. */
function dueToday(size: number): WorkloadCard[] {
  return Array.from({ length: size }, (_unused, index) =>
    reviewCard({ id: `due-${String(index).padStart(4, '0')}` }, 5 + (index % 20), NOW),
  );
}

/** Cards that were due some days ago. */
function overdue(size: number, daysLate = 5): WorkloadCard[] {
  return Array.from({ length: size }, (_unused, index) =>
    reviewCard(
      { id: `late-${String(index).padStart(4, '0')}` },
      5 + (index % 20),
      new Date(NOW.getTime() - daysLate * MS_PER_DAY),
    ),
  );
}

/** Cards nobody has answered yet. */
function untouched(size: number): WorkloadCard[] {
  return Array.from({ length: size }, (_unused, index) =>
    freshCard({ id: `new-${String(index).padStart(4, '0')}` }, NOW),
  );
}

describe('filling the time available', () => {
  it('merges unequal Decks fairly and deterministically without imposing equal quotas', () => {
    const huge = untouched(1000).map((card) => ({ ...card, deckId: 'a' }));
    const small = [0, 1].map((index) => ({
      ...freshCard({ id: `small-${index}` }, NOW),
      deckId: 'b',
    }));
    const build = (cards: readonly WorkloadCard[]) =>
      buildSession({
        cards,
        budget,
        config,
        now: NOW,
        rng: rng(),
        oneOffMinutes: 1,
        newCardMode: 'override',
      });
    const plan = build([...huge, ...small]);
    expect(plan.cards.slice(0, 4).map((card) => card.deckId)).toEqual(['a', 'b', 'a', 'b']);
    expect(plan.cards.length).toBeGreaterThan(4);
    expect(plan.cards.filter((card) => card.deckId === 'a').map((card) => card.id)).toEqual(
      huge.slice(0, plan.cards.length - 2).map((card) => card.id),
    );
    expect(build([...small, ...huge].reverse()).cards).toEqual(plan.cards);
    const next = buildSession({
      cards: [...huge.slice(1), ...small],
      budget,
      config,
      now: NOW,
      rng: rng(),
      oneOffMinutes: 0.01,
      newCardMode: 'override',
      logs: [
        {
          cardId: huge[0]!.id,
          deckId: 'a',
          direction: 'recognition',
          rating: 3,
          reviewedAt: NOW,
          elapsedDays: 0,
          scheduledDays: 0,
          placedDue: NOW,
          stateBefore: 'new',
          stabilityBefore: undefined,
          difficultyBefore: undefined,
          durationMs: 6000,
        },
      ],
    });
    expect(next.cards[0]?.deckId).toBe('b');
  });
  it('fills the budget for the day and stops', () => {
    const session = buildSession({
      cards: dueToday(500),
      budget,
      config,
      now: NOW,
      rng: rng(),
      preset: { minutes: null, allowNewCards: false },
    });

    expect(session.budgetMinutes).toBe(20);
    expect(session.estimatedMinutes).toBeGreaterThanOrEqual(20);
    expect(session.estimatedMinutes).toBeLessThan(21);
  });

  it('ends on a whole card rather than stopping halfway through one', () => {
    const session = buildSession({
      cards: dueToday(500),
      budget: createBudget({ minutesByWeekday: [5.05, 5.05, 5.05, 5.05, 5.05, 5.05, 5.05] }),
      config,
      now: NOW,
      rng: rng(),
      preset: { minutes: null, allowNewCards: false },
    });

    // Six second cards against a budget that ends mid card: the session goes
    // a little over rather than a little under.
    expect(session.estimatedMinutes).toBeGreaterThan(5.05);
    expect(session.cards).toHaveLength(51);
  });

  it('takes everything when there is less due than time', () => {
    const session = buildSession({
      cards: dueToday(10),
      budget,
      config,
      now: NOW,
      rng: rng(),
      preset: { minutes: null, allowNewCards: false },
    });

    expect(session.cards).toHaveLength(10);
    expect(session.estimatedMinutes).toBeCloseTo(1, 6);
  });

  it('honours a preset that asks for a shorter session', () => {
    const session = buildSession({
      cards: dueToday(500),
      budget,
      config,
      now: NOW,
      rng: rng(),
      preset: { minutes: 2, allowNewCards: false },
    });

    expect(session.budgetMinutes).toBe(2);
    expect(session.estimatedMinutes).toBeLessThan(2.2);
  });

  it('uses one-off minutes without changing the daily planning budget', () => {
    const session = buildSession({
      cards: dueToday(500),
      budget,
      config,
      now: NOW,
      rng: rng(),
      oneOffMinutes: 3,
      preset: { minutes: null, allowNewCards: false },
    });

    expect(session.budgetMinutes).toBe(3);
    expect(budget.minutesByWeekday).toEqual([20, 20, 20, 20, 20, 20, 20]);
  });

  it('says how long it will take before it starts', () => {
    const session = buildSession({
      cards: dueToday(30),
      budget,
      config,
      now: NOW,
      rng: rng(),
      preset: { minutes: null, allowNewCards: false },
    });

    expect(session.estimatedMinutes).toBeCloseTo(session.cards.length * 0.1, 6);
  });

  it('gives an empty session on a day with no budget', () => {
    const dayOff = createBudget({ minutesByWeekday: [0, 20, 20, 20, 20, 20, 20] });
    const session = buildSession({
      cards: dueToday(100),
      budget: dayOff,
      config,
      now: new Date('2026-08-09T12:00:00Z'),
      rng: rng(),
    });

    expect(session.cards).toHaveLength(0);
    expect(session.estimatedMinutes).toBe(0);
  });
});

describe('the rules about order', () => {
  it('never shows two cards of the same note', () => {
    const pair = [
      reviewCard({ id: 'a1', noteId: 'shared' }, 5, NOW),
      reviewCard({ id: 'a2', noteId: 'shared' }, 5, NOW),
      ...dueToday(50),
    ];
    const session = buildSession({
      cards: pair,
      budget,
      config,
      now: NOW,
      rng: rng(),
      preset: { minutes: null, allowNewCards: false },
    });
    const notes = session.cards.map((card) => card.noteId);

    expect(new Set(notes).size).toBe(notes.length);
  });

  it('does not put a new card and its own review together either', () => {
    const cards = [
      reviewCard({ id: 'seen', noteId: 'shared' }, 5, NOW),
      freshCard({ id: 'unseen', noteId: 'shared' }, NOW),
      ...dueToday(20),
    ];
    const session = buildSession({ cards, budget, config, now: NOW, rng: rng() });
    const notes = session.cards.map((card) => card.noteId);

    expect(new Set(notes).size).toBe(notes.length);
  });

  it('spreads new cards through the first two thirds instead of the front', () => {
    const session = buildSession({
      cards: [...dueToday(100), ...untouched(10)],
      budget,
      config,
      now: NOW,
      rng: rng(),
      marginalCost: 0.3,
    });
    const positions = session.cards
      .map((card, index) => (card.scheduling.state === 'new' ? index : -1))
      .filter((index) => index >= 0);

    expect(positions.length).toBeGreaterThan(0);
    expect(positions[0]).toBeGreaterThan(0);
    expect(Math.max(...positions)).toBeLessThan(session.cards.length * 0.75);

    // Spread, not clustered: the gaps between them are all about the same.
    const gaps = positions.slice(1).map((position, index) => position - (positions[index] ?? 0));

    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(2);
  });

  it('keeps review priority while new cards fill only remaining time', () => {
    const session = buildSession({
      cards: [...dueToday(5), ...untouched(20)],
      budget,
      config,
      now: NOW,
      rng: rng(),
      oneOffMinutes: 1,
      marginalCost: 0.01,
    });

    expect(session.reviewCount).toBe(5);
    expect(session.newCount).toBeGreaterThan(0);
    expect(session.cards.filter((card) => card.scheduling.state !== 'new')).toHaveLength(5);
  });

  it('mixes overdue cards in rather than putting them all at the front', () => {
    const session = buildSession({
      cards: [...overdue(50), ...dueToday(50)],
      budget,
      config,
      now: NOW,
      rng: rng(),
      preset: { minutes: null, allowNewCards: false },
    });
    const firstFresh = session.cards.findIndex((card) => card.id.startsWith('due-'));

    expect(firstFresh).toBeGreaterThanOrEqual(0);
    expect(firstFresh).toBeLessThan(5);
  });

  it('avoids three hard cards in a row', () => {
    const hard = Array.from({ length: 30 }, (_unused, index) =>
      reviewCard({ id: `hard-${index}` }, 5, NOW, 9.5),
    );
    const easy = Array.from({ length: 30 }, (_unused, index) =>
      reviewCard({ id: `easy-${index}` }, 5, NOW, 3),
    );
    const session = buildSession({
      cards: [...hard, ...easy],
      budget,
      config,
      now: NOW,
      rng: rng(),
      preset: { minutes: null, allowNewCards: false },
    });

    let run = 0;
    let longest = 0;

    for (const card of session.cards) {
      const difficulty = card.scheduling.state === 'new' ? 5 : card.scheduling.difficulty;

      run = difficulty > 8 ? run + 1 : 0;
      longest = Math.max(longest, run);
    }

    expect(longest).toBeLessThanOrEqual(2);
  });
});

describe('what the session says about itself', () => {
  it('stops introducing new cards while a backlog is being worked through', () => {
    const session = buildSession({
      cards: [...overdue(2000, 20), ...untouched(50)],
      budget,
      config,
      now: NOW,
      rng: rng(),
      marginalCost: 0.3,
    });

    expect(session.backlog.active).toBe(true);
    expect(session.newCount).toBe(0);
    expect(session.newCards.reason).toBe('backlogActive');
    expect(session.newCards.overrideAvailable).toBe(false);
  });

  it('distinguishes an automatic backlog stop from an intentional override', () => {
    const backlog = { active: true, overdueCount: 100, overdueMinutes: 50, budgetMinutes: 20 };
    const automatic = buildSession({
      cards: untouched(20),
      budget,
      config,
      now: NOW,
      rng: rng(),
      oneOffMinutes: 2,
      marginalCost: 0.3,
      backlog,
    });
    const overridden = buildSession({
      cards: untouched(20),
      budget,
      config,
      now: NOW,
      rng: rng(),
      oneOffMinutes: 2,
      newCardMode: 'override',
      marginalCost: 0.3,
      backlog,
    });

    expect(automatic.newCards).toMatchObject({
      admitted: 0,
      reason: 'backlogActive',
      overrideAvailable: true,
      limitedBy: 'automaticPolicy',
    });
    expect(overridden.newCards).toMatchObject({
      admitted: 20,
      mode: 'override',
      reason: 'backlogActive',
      overrideAvailable: false,
    });
  });

  it('uses stable new-card order instead of collection traversal order', () => {
    const cards = untouched(12);
    const first = buildSession({
      cards,
      budget,
      config,
      now: NOW,
      rng: createSeededRandom(1),
      oneOffMinutes: 1,
      newCardMode: 'override',
    });
    const second = buildSession({
      cards: [...cards].reverse(),
      budget,
      config,
      now: NOW,
      rng: createSeededRandom(999),
      oneOffMinutes: 1,
      newCardMode: 'override',
    });

    expect(second.cards.map((card) => card.id)).toEqual(first.cards.map((card) => card.id));
  });

  it('counts what it holds', () => {
    const session = buildSession({
      cards: [...dueToday(50), ...untouched(10)],
      budget,
      config,
      now: NOW,
      rng: rng(),
      marginalCost: 0.3,
    });

    expect(session.reviewCount + session.newCount).toBe(session.cards.length);
    expect(session.newCount).toBeGreaterThan(0);
  });

  it('gives the same session twice for the same seed', () => {
    const first = buildSession({ cards: dueToday(300), budget, config, now: NOW, rng: rng() });
    const second = buildSession({ cards: dueToday(300), budget, config, now: NOW, rng: rng() });

    expect(second.cards.map((card) => card.id)).toEqual(first.cards.map((card) => card.id));
  });

  it('does not show the same cards every day when more are due than fit', () => {
    const cards = dueToday(300);
    const monday = buildSession({ cards, budget, config, now: NOW, rng: createSeededRandom(1) });
    const tuesday = buildSession({ cards, budget, config, now: NOW, rng: createSeededRandom(2) });

    expect(tuesday.cards.map((card) => card.id)).not.toEqual(monday.cards.map((card) => card.id));
  });
});

describe('the retry pool', () => {
  function relearning(card: WorkloadCard, due = NOW): WorkloadCard {
    return {
      ...card,
      scheduling: {
        state: 'relearning',
        stability: 0.2,
        difficulty: 9,
        due,
        lastReview: NOW,
        reps: 2,
        lapses: 1,
        learningStep: 0,
      },
    };
  }

  it('does not let many eligible retries starve unseen planned cards', () => {
    const session = buildSession({
      cards: dueToday(30),
      budget,
      config,
      now: NOW,
      rng: rng(),
      oneOffMinutes: 3,
      newCardMode: 'exclude',
    });
    let queue = createSessionQueue(session);

    for (const card of dueToday(100).map((entry) => relearning(entry))) {
      queue = queueSessionRetry(queue, card);
    }

    const sources: string[] = [];

    for (let index = 0; index < 20; index += 1) {
      const step = takeNextSessionCard(queue, NOW, index * 1000, 3);

      expect(step.card).not.toBeNull();
      if (step.card === null) break;
      sources.push(step.source);
      queue = step.queue;
    }

    expect(sources).toEqual(
      Array.from({ length: 20 }, (_entry, index) => (index % 2 === 0 ? 'planned' : 'retry')),
    );
    expect(queue.planned).toHaveLength(session.cards.length - 10);
  });

  it('leaves a retry due for later when session time ends first', () => {
    const session = buildSession({
      cards: dueToday(2),
      budget,
      config,
      now: NOW,
      rng: rng(),
      oneOffMinutes: 0.1,
      newCardMode: 'exclude',
    });
    const first = takeNextSessionCard(createSessionQueue(session), NOW, 0, 0.1);

    expect(first.card).not.toBeNull();
    if (first.card === null) return;

    const retry = relearning(first.card);
    const queued = queueSessionRetry(first.queue, retry);
    const stopped = takeNextSessionCard(queued, NOW, 6000, 0.1);

    expect(stopped).toMatchObject({ card: null, reason: 'timeEnded' });
    expect(stopped.queue.retries[0]?.scheduling.due).toEqual(retry.scheduling.due);
  });

  it('waits for a future retry without changing its FSRS due time', () => {
    const future = new Date(NOW.getTime() + 10 * 60_000);
    const retry = relearning(dueToday(1)[0]!, future);
    const queue = queueSessionRetry({ planned: [], retries: [], retryMayRun: false }, retry);
    const step = takeNextSessionCard(queue, NOW, 0, 20);

    expect(step).toMatchObject({ card: null, reason: 'retryNotDue' });
    expect(step.queue.retries[0]?.scheduling.due).toEqual(future);
  });
});

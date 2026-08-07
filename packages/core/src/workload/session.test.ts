import { describe, expect, it } from 'vitest';

import { createSchedulerConfig } from '../fsrs/parameters.js';
import { createSeededRandom } from '../fsrs/random.js';
import { MS_PER_DAY } from '../time/day.js';

import { createBudget } from './budget.js';
import { freshCard, reviewCard } from './cards.js';
import { createWorkloadConfig } from './config.js';
import { buildSession } from './session.js';

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

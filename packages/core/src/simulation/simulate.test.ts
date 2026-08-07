/**
 * The simulator is a measuring instrument, so it needs checking like one.
 *
 * These are not tests of the scheduler. They are tests that the runs are
 * reproducible, that the two arms differ only where they are meant to, and
 * that the numbers the tables print are the numbers the days add up to.
 */

import { describe, expect, it } from 'vitest';

import { createSchedulerConfig } from '../fsrs/parameters.js';
import { createSeededRandom } from '../fsrs/random.js';
import { createBudget } from '../workload/budget.js';
import { createWorkloadConfig } from '../workload/config.js';

import { AVERAGE_LEARNER, DEFAULT_DROPOUT, skipChance } from './learner.js';
import {
  KNOWN_STABILITY_DAYS,
  simulate,
  type DeckSpec,
  type SimulationOptions,
} from './simulate.js';

const START = new Date('2026-01-05T12:00:00Z');

const config = createWorkloadConfig({
  scheduler: createSchedulerConfig({ timezone: 'UTC', dayCutoffHour: 4 }),
});

const budget = createBudget({ minutesByWeekday: [30, 15, 15, 15, 15, 15, 30] });

/** A deck of a given number of cards, two directions to each note. */
function deck(cards: number, newPerDay = 20): DeckSpec {
  return {
    id: 'test',
    notes: Math.ceil(cards / 2),
    directions: ['recognition', 'recall'],
    newPerDay,
  };
}

/** A short run, enough to have a shape without taking a minute. */
function options(overrides: Partial<SimulationOptions> = {}): SimulationOptions {
  return {
    label: 'test',
    decks: [deck(300)],
    days: 60,
    start: START,
    config,
    budget,
    learner: AVERAGE_LEARNER,
    policy: { kind: 'fixed' },
    ...overrides,
  };
}

describe('a run', () => {
  it('gives exactly the same year twice for the same seed', () => {
    const first = simulate(options(), createSeededRandom(5));
    const second = simulate(options(), createSeededRandom(5));

    expect(second.days.map((day) => day.minutes)).toEqual(first.days.map((day) => day.minutes));
    expect(second.summary).toEqual(first.summary);
  });

  it('gives a different year for a different seed', () => {
    const first = simulate(options(), createSeededRandom(5));
    const second = simulate(options(), createSeededRandom(6));

    expect(second.days.map((day) => day.minutes)).not.toEqual(first.days.map((day) => day.minutes));
  });

  it('reports as many days as it was asked for', () => {
    const result = simulate(options({ days: 30 }), createSeededRandom(1));

    expect(result.days).toHaveLength(30);
    expect(result.days[0]?.day).toBe(0);
    expect(result.days[29]?.day).toBe(29);
  });

  it('adds up to what the summary says', () => {
    const result = simulate(options(), createSeededRandom(2));
    const total = result.days.reduce((sum, day) => sum + day.minutes, 0);

    expect(result.summary.totalMinutes).toBeCloseTo(total, 6);
    expect(result.summary.meanMinutes).toBeCloseTo(total / result.days.length, 6);
    expect(result.summary.newCardsIntroduced).toBe(
      result.days.reduce((sum, day) => sum + day.newCards, 0),
    );
    expect(result.summary.peakDailyMinutes).toBe(
      Math.max(...result.days.map((day) => day.minutes)),
    );
  });

  it('learns cards, and only counts one as known once it is worth three weeks', () => {
    const result = simulate(options({ days: 90 }), createSeededRandom(3));
    const last = result.days[result.days.length - 1];

    expect(result.summary.newCardsIntroduced).toBeGreaterThan(100);
    expect(last?.known ?? 0).toBeGreaterThan(0);
    expect(last?.known ?? 0).toBeLessThanOrEqual(result.summary.newCardsIntroduced);
    expect(KNOWN_STABILITY_DAYS).toBe(21);
  });

  it('recalls about as often as the target says it should', () => {
    const result = simulate(options({ days: 120 }), createSeededRandom(4));

    // The learner recalls with exactly the probability the model gives them,
    // so this lands near the target retention and is a check on the loop
    // rather than a finding about memory.
    expect(result.summary.retention).toBeGreaterThan(0.85);
    expect(result.summary.retention).toBeLessThan(0.93);
  });
});

describe('the numbers that describe the experience', () => {
  it('orders the peak, the ninety fifth day and the median', () => {
    const result = simulate(options({ days: 120 }), createSeededRandom(13));
    const summary = result.summary;

    expect(summary.peakDailyMinutes).toBeGreaterThanOrEqual(summary.p95DailyMinutes);
    expect(summary.p95DailyMinutes).toBeGreaterThanOrEqual(summary.medianMinutes);
    expect(summary.dailyMinutesStdDev).toBeGreaterThan(0);
  });

  it('counts a day over double the budget as also over the budget', () => {
    const result = simulate(options({ days: 120 }), createSeededRandom(14));

    expect(result.summary.daysOverDoubleBudget).toBeLessThanOrEqual(result.summary.daysOverBudget);
  });

  it('finds the worst week somewhere inside the total', () => {
    const result = simulate(options({ days: 120 }), createSeededRandom(15));

    expect(result.summary.worstWeekMinutes).toBeGreaterThan(0);
    expect(result.summary.worstWeekMinutes).toBeLessThanOrEqual(result.summary.totalMinutes);
  });

  it('reports one recovery time per absence', () => {
    const result = simulate(
      options({
        days: 200,
        decks: [deck(1000)],
        absences: [
          { startDay: 40, days: 14 },
          { startDay: 120, days: 21 },
        ],
      }),
      createSeededRandom(16),
    );

    expect(result.summary.daysToRecover).toHaveLength(2);
  });
});

describe('the two policies', () => {
  it('lets the fixed limit hand out exactly its number a day', () => {
    const result = simulate(options({ days: 20, decks: [deck(300, 10)] }), createSeededRandom(7));

    for (const day of result.days) {
      expect(day.newCards).toBeLessThanOrEqual(10);
    }
  });

  it('keeps the adaptive arm nearer the budget than the fixed one', { timeout: 120_000 }, () => {
    const fixed = simulate(
      options({ days: 120, decks: [deck(2000, 20)], policy: { kind: 'fixed' } }),
      createSeededRandom(8),
    );
    const adaptive = simulate(
      options({ days: 120, decks: [deck(2000, 20)], policy: { kind: 'adaptive' } }),
      createSeededRandom(8),
    );

    expect(adaptive.summary.meanOvershootMinutes).toBeLessThan(fixed.summary.meanOvershootMinutes);
    expect(adaptive.summary.peakDailyMinutes).toBeLessThan(fixed.summary.peakDailyMinutes);
  });

  it('holds the adaptive arm under the budget on average', { timeout: 120_000 }, () => {
    const result = simulate(
      options({ days: 120, decks: [deck(2000, 20)], policy: { kind: 'adaptive' } }),
      createSeededRandom(9),
    );
    const meanBudget =
      result.days.reduce((sum, day) => sum + day.budgetMinutes, 0) / result.days.length;

    expect(result.summary.meanMinutes).toBeLessThan(meanBudget);
  });

  it('gives every deck its own allowance in the fixed arm', () => {
    const result = simulate(
      options({
        days: 10,
        decks: [
          { id: 'english', notes: 200, directions: ['recognition', 'recall'], newPerDay: 10 },
          { id: 'german', notes: 200, directions: ['recognition', 'recall'], newPerDay: 10 },
        ],
      }),
      createSeededRandom(17),
    );

    // Two decks of ten a day is twenty a day, which is the point of the
    // scenario: neither deck looks unreasonable on its own.
    for (const day of result.days) {
      expect(day.newCards).toBeLessThanOrEqual(20);
    }

    expect(result.summary.newCardsIntroduced).toBeGreaterThan(100);
  });
});

describe('a month away', () => {
  it('piles up overdue cards and then clears most of them', { timeout: 120_000 }, () => {
    const result = simulate(
      options({
        days: 150,
        decks: [deck(2000)],
        policy: { kind: 'adaptive' },
        absences: [{ startDay: 60, days: 30 }],
      }),
      createSeededRandom(11),
    );
    const duringAbsence = result.days[89];
    const twoWeeksAfter = result.days[104];

    expect(duringAbsence?.minutes).toBe(0);
    expect(duringAbsence?.backlog ?? 0).toBeGreaterThan(50);
    expect(twoWeeksAfter?.backlog ?? 0).toBeLessThan((duringAbsence?.backlog ?? 0) / 4);
  });

  it('spreads the recovery instead of dumping it on the first day', { timeout: 120_000 }, () => {
    // Coming back to four hundred overdue cards is where other applications
    // hand over a two hour session. The recovery plan is what stops that.
    const result = simulate(
      options({
        days: 160,
        decks: [deck(3000)],
        policy: { kind: 'adaptive' },
        absences: [{ startDay: 90, days: 45 }],
      }),
      createSeededRandom(12),
    );
    const firstDayBack = result.days[135];
    const fortnightBack = result.days.slice(135, 149);

    expect(firstDayBack?.backlog ?? 0).toBeGreaterThan(300);

    for (const day of fortnightBack) {
      expect(day.minutes).toBeLessThan(day.budgetMinutes * 2.5);
    }
  });
});

describe('the attendance assumption', () => {
  it('says overload changes nothing when the sensitivity is zero', () => {
    expect(skipChance(DEFAULT_DROPOUT, 200, 15)).toBe(DEFAULT_DROPOUT.baseSkip);
  });

  it('raises the chance of skipping with the overload, once it is not zero', () => {
    const sensitive = { ...DEFAULT_DROPOUT, overloadSensitivity: 0.5 };

    expect(skipChance(sensitive, 15, 15)).toBeCloseTo(0.05, 10);
    expect(skipChance(sensitive, 30, 15)).toBeCloseTo(0.55, 10);
    expect(skipChance(sensitive, 300, 15)).toBe(sensitive.maxSkip);
  });

  it('abandons the collection after enough silence', () => {
    // A learner who skips almost every day gives up inside three weeks.
    const result = simulate(
      options({
        days: 120,
        dropout: { ...DEFAULT_DROPOUT, baseSkip: 1, maxSkip: 1, abandonAfterSkippedDays: 21 },
      }),
      createSeededRandom(18),
    );

    expect(result.summary.abandonedOnDay).toBe(20);
    expect(result.summary.daysStudied).toBe(0);
  });

  it('never abandons a learner who keeps turning up', () => {
    const result = simulate(
      options({ days: 120, dropout: { ...DEFAULT_DROPOUT, baseSkip: 0 } }),
      createSeededRandom(19),
    );

    expect(result.summary.abandonedOnDay).toBeNull();
    expect(result.summary.daysStudied).toBe(120);
  });
});

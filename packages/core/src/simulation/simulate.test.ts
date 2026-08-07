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

import { AVERAGE_LEARNER } from './learner.js';
import { KNOWN_STABILITY_DAYS, simulate, type SimulationOptions } from './simulate.js';

const START = new Date('2026-01-05T12:00:00Z');

const config = createWorkloadConfig({
  scheduler: createSchedulerConfig({ timezone: 'UTC', dayCutoffHour: 4 }),
});

const budget = createBudget({ minutesByWeekday: [30, 15, 15, 15, 15, 15, 30] });

/** A short run, enough to have a shape without taking a minute. */
function options(overrides: Partial<SimulationOptions> = {}): SimulationOptions {
  return {
    label: 'test',
    deckSize: 300,
    days: 60,
    start: START,
    config,
    budget,
    learner: AVERAGE_LEARNER,
    policy: { kind: 'fixed', perDay: 20 },
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

describe('the two policies', () => {
  it('lets the fixed limit hand out exactly its number a day', () => {
    const result = simulate(
      options({ days: 20, policy: { kind: 'fixed', perDay: 10 } }),
      createSeededRandom(7),
    );

    for (const day of result.days) {
      expect(day.newCards).toBeLessThanOrEqual(10);
    }
  });

  it('keeps the adaptive arm nearer the budget than the fixed one', { timeout: 120_000 }, () => {
    const fixed = simulate(
      options({ days: 120, deckSize: 2000, policy: { kind: 'fixed', perDay: 20 } }),
      createSeededRandom(8),
    );
    const adaptive = simulate(
      options({ days: 120, deckSize: 2000, policy: { kind: 'adaptive' } }),
      createSeededRandom(8),
    );

    expect(adaptive.summary.meanOvershootMinutes).toBeLessThan(fixed.summary.meanOvershootMinutes);
    expect(adaptive.summary.newCardsIntroduced).toBeLessThan(fixed.summary.newCardsIntroduced);
  });

  it('holds the adaptive arm under the budget on average', { timeout: 120_000 }, () => {
    const result = simulate(
      options({ days: 120, deckSize: 2000, policy: { kind: 'adaptive' } }),
      createSeededRandom(9),
    );
    const meanBudget =
      result.days.reduce((sum, day) => sum + day.budgetMinutes, 0) / result.days.length;

    expect(result.summary.meanMinutes).toBeLessThan(meanBudget);
  });
});

describe('a month away', () => {
  it('piles up overdue cards and then clears most of them', { timeout: 120_000 }, () => {
    const result = simulate(
      options({
        days: 150,
        deckSize: 2000,
        policy: { kind: 'adaptive' },
        absence: { startDay: 60, days: 30 },
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
        deckSize: 3000,
        policy: { kind: 'adaptive' },
        absence: { startDay: 90, days: 45 },
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

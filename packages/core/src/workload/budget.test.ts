import { describe, expect, it } from 'vitest';

import { RATING } from '../fsrs/types.js';
import { MS_PER_DAY, type DayBoundary } from '../time/day.js';

import {
  CARRY_OVER_WINDOW_DAYS,
  DEFAULT_BUDGET,
  budgetFor,
  carryOverMinutes,
  createBudget,
  meanBudget,
} from './budget.js';

import type { WorkloadReview } from './types.js';

/** UTC with a four o'clock cutoff, the default day. */
const boundary: DayBoundary = { timezone: 'UTC', dayCutoffHour: 4 };

/** A Wednesday. */
const wednesday = new Date('2026-08-05T12:00:00Z');

/** A row of the log that only says when it happened and how long it took. */
function spent(at: Date, minutes: number): WorkloadReview {
  return {
    cardId: 'card',
    direction: 'recall',
    rating: RATING.good,
    reviewedAt: at,
    elapsedDays: 1,
    scheduledDays: 1,
    placedDue: at,
    stateBefore: 'review',
    stabilityBefore: 4,
    difficultyBefore: 5,
    durationMs: minutes * 60_000,
  };
}

describe('the budget for a day', () => {
  it('gives a weekday fifteen minutes and a weekend thirty', () => {
    expect(budgetFor(wednesday, DEFAULT_BUDGET, boundary)).toBe(15);
    expect(budgetFor(new Date('2026-08-08T12:00:00Z'), DEFAULT_BUDGET, boundary)).toBe(30);
    expect(budgetFor(new Date('2026-08-09T12:00:00Z'), DEFAULT_BUDGET, boundary)).toBe(30);
  });

  it('reads a late night as the day that just ended', () => {
    // 02:00 on Saturday is still Friday's fifteen minutes.
    expect(budgetFor(new Date('2026-08-08T02:00:00Z'), DEFAULT_BUDGET, boundary)).toBe(15);
    expect(budgetFor(new Date('2026-08-08T05:00:00Z'), DEFAULT_BUDGET, boundary)).toBe(30);
  });

  it('averages a fortnight at the right number', () => {
    const firstDay = Math.floor(Date.UTC(2026, 7, 3) / MS_PER_DAY);

    // Two weeks: ten weekdays at fifteen and four weekend days at thirty.
    expect(meanBudget(firstDay, 14, DEFAULT_BUDGET)).toBeCloseTo((10 * 15 + 4 * 30) / 14, 10);
  });
});

describe('carrying minutes over', () => {
  /** One answer a week ago, so the person counts as having been here. */
  const joinedAWeekAgo = [
    spent(new Date(wednesday.getTime() - CARRY_OVER_WINDOW_DAYS * MS_PER_DAY), 5),
  ];

  it('gives back the whole budget of a day nobody studied', () => {
    const budget = createBudget({ minutesByWeekday: [20, 20, 20, 20, 20, 20, 20] });

    expect(carryOverMinutes(joinedAWeekAgo, budget, boundary, wednesday)).toBe(20);
  });

  it('gives back nothing to somebody who has not started yet', () => {
    const budget = createBudget({ minutesByWeekday: [20, 20, 20, 20, 20, 20, 20] });

    expect(carryOverMinutes([], budget, boundary, wednesday)).toBe(0);
  });

  it('counts only the days since the first review', () => {
    const budget = createBudget({ minutesByWeekday: [20, 20, 20, 20, 20, 20, 20] });
    const joinedYesterday = [spent(new Date(wednesday.getTime() - MS_PER_DAY), 12)];

    expect(carryOverMinutes(joinedYesterday, budget, boundary, wednesday)).toBe(8);
  });

  it('gives back nothing when every day was used up', () => {
    const budget = createBudget({ minutesByWeekday: [20, 20, 20, 20, 20, 20, 20] });
    const logs = Array.from({ length: CARRY_OVER_WINDOW_DAYS }, (_unused, offset) =>
      spent(new Date(wednesday.getTime() - (offset + 1) * MS_PER_DAY), 25),
    );

    expect(carryOverMinutes(logs, budget, boundary, wednesday)).toBe(0);
  });

  it('never hands over more than one more day', () => {
    const budget = createBudget({ minutesByWeekday: [20, 20, 20, 20, 20, 20, 20] });

    // A whole week untouched adds up to 140 minutes, and it is worth 20.
    expect(carryOverMinutes(joinedAWeekAgo, budget, boundary, wednesday)).toBe(20);
  });

  it('leaves today out of it, because today is not over', () => {
    const budget = createBudget({
      minutesByWeekday: [20, 20, 20, 20, 20, 20, 20],
      allowCarryOver: true,
    });
    const logs = [...joinedAWeekAgo, spent(new Date(wednesday.getTime() - 60_000), 100)];

    expect(carryOverMinutes(logs, budget, boundary, wednesday)).toBe(20);
  });

  it('gives back nothing when the user turned it off', () => {
    const budget = createBudget({ allowCarryOver: false });

    expect(carryOverMinutes([], budget, boundary, wednesday)).toBe(0);
  });
});

describe('checking a budget', () => {
  it('refuses a week that is not seven days', () => {
    expect(() => createBudget({ minutesByWeekday: [10, 10, 10] })).toThrow(RangeError);
  });

  it('refuses negative minutes', () => {
    expect(() => createBudget({ minutesByWeekday: [10, 10, 10, -1, 10, 10, 10] })).toThrow(
      RangeError,
    );
  });

  it('accepts a day of zero, which is how somebody takes Sundays off', () => {
    const budget = createBudget({ minutesByWeekday: [0, 15, 15, 15, 15, 15, 15] });

    expect(budgetFor(new Date('2026-08-09T12:00:00Z'), budget, boundary)).toBe(0);
  });
});

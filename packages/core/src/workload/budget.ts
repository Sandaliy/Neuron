/**
 * How many minutes a day the person has agreed to.
 *
 * This is the setting the whole application is built around. Every other
 * review app asks for a number of cards, which is a guess about an amount of
 * work that only arrives weeks later. Minutes are something a person actually
 * knows about themselves.
 *
 * The budget is per weekday, because Tuesday and Sunday are not the same day
 * for anybody.
 */

import { DAYS_PER_WEEK, dayIndexOf, weekdayOf, type DayBoundary } from '../time/day.js';

import type { WorkloadReview } from './types.js';

/** Minutes of study the user has offered, by day of the week. */
export interface Budget {
  /** Minutes for each day, index 0 being Sunday, matching `Date.getDay`. */
  readonly minutesByWeekday: readonly number[];
  /**
   * Whether minutes left unused earlier in the week may be spent later.
   *
   * A budget nobody ever exceeds turns a missed evening into work that is
   * simply gone. Carry over lets a quiet Tuesday pay for a longer Thursday,
   * and it is capped at one day's budget so a fortnight away cannot produce a
   * six hour session.
   */
  readonly allowCarryOver: boolean;
}

/** Fifteen minutes on a weekday, half an hour when there is more time. */
export const DEFAULT_BUDGET: Budget = Object.freeze({
  minutesByWeekday: Object.freeze([30, 15, 15, 15, 15, 15, 30]),
  allowCarryOver: true,
});

/** How far back unused minutes are collected from. */
export const CARRY_OVER_WINDOW_DAYS = 7;

/** Milliseconds in one minute. */
const MS_PER_MINUTE = 60_000;

/**
 * The budget for the study day a moment falls in.
 *
 * @param date any moment inside the day being asked about
 * @param budget the user's weekly budget
 * @param boundary the timezone and cutoff hour, usually the scheduler settings
 * @returns minutes of study offered that day
 */
export function budgetFor(date: Date, budget: Budget, boundary: DayBoundary): number {
  return budgetForDay(dayIndexOf(date, boundary), budget);
}

/**
 * The budget for a study day named by its index.
 *
 * @param dayIndex the study day
 * @param budget the user's weekly budget
 * @returns minutes of study offered that day
 */
export function budgetForDay(dayIndex: number, budget: Budget): number {
  const minutes = budget.minutesByWeekday[weekdayOf(dayIndex)];

  return minutes === undefined || !Number.isFinite(minutes) || minutes < 0 ? 0 : minutes;
}

/**
 * The mean budget over a stretch of days, which is what the throttle compares
 * a forecast against.
 *
 * @param firstDay the first study day of the window
 * @param days how many days the window covers
 * @param budget the user's weekly budget
 * @returns mean minutes per day, or zero for an empty window
 */
export function meanBudget(firstDay: number, days: number, budget: Budget): number {
  if (days <= 0) {
    return 0;
  }

  let total = 0;

  for (let offset = 0; offset < days; offset += 1) {
    total += budgetForDay(firstDay + offset, budget);
  }

  return total / days;
}

/**
 * Minutes left over from the last week, available to spend today.
 *
 * Only what actually happened counts: the log says how long every answer took,
 * so a day nobody studied gives back its whole budget and a day somebody
 * overran gives back nothing. Today itself is left out, since it is not over.
 *
 * Days before the first review in the log are left out too. Somebody who
 * installed the application yesterday has not been skipping sessions, and
 * handing them a double length one on their second day would be a strange way
 * to say hello.
 *
 * @param logs the user's review log, in any order
 * @param budget the user's weekly budget
 * @param boundary the timezone and cutoff hour
 * @param now the moment the session is being built
 * @returns extra minutes available today, never more than one day's budget
 */
export function carryOverMinutes(
  logs: readonly WorkloadReview[],
  budget: Budget,
  boundary: DayBoundary,
  now: Date,
): number {
  if (!budget.allowCarryOver || logs.length === 0) {
    return 0;
  }

  const today = dayIndexOf(now, boundary);
  const spent = new Map<number, number>();
  let firstDay = Number.POSITIVE_INFINITY;

  for (const log of logs) {
    const day = dayIndexOf(log.reviewedAt, boundary);

    firstDay = Math.min(firstDay, day);

    if (day < today && day >= today - CARRY_OVER_WINDOW_DAYS) {
      spent.set(day, (spent.get(day) ?? 0) + log.durationMs / MS_PER_MINUTE);
    }
  }

  let unused = 0;

  for (let offset = 1; offset <= CARRY_OVER_WINDOW_DAYS; offset += 1) {
    const day = today - offset;

    if (day >= firstDay) {
      unused += Math.max(budgetForDay(day, budget) - (spent.get(day) ?? 0), 0);
    }
  }

  return Math.min(unused, budgetForDay(today, budget));
}

/**
 * Checks a budget and fills in what is missing.
 *
 * @param overrides the fields to change
 * @returns a frozen budget with seven weekdays in it
 * @throws RangeError if a day is missing or is not a sensible number of minutes
 */
export function createBudget(overrides: Partial<Budget> = {}): Budget {
  const minutes = overrides.minutesByWeekday ?? DEFAULT_BUDGET.minutesByWeekday;

  if (minutes.length !== DAYS_PER_WEEK) {
    throw new RangeError(`A budget needs ${DAYS_PER_WEEK} days, got ${minutes.length}.`);
  }

  const invalid = minutes.findIndex((value) => !Number.isFinite(value) || value < 0);

  if (invalid >= 0) {
    throw new RangeError(`minutesByWeekday[${invalid}] must be zero minutes or more.`);
  }

  return Object.freeze({
    minutesByWeekday: Object.freeze([...minutes]),
    allowCarryOver: overrides.allowCarryOver ?? DEFAULT_BUDGET.allowCarryOver,
  });
}

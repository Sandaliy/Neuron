/**
 * Small numeric helpers shared by the formulas.
 *
 * The rounding helper is not cosmetic. The reference implementation rounds
 * every intermediate memory value to eight decimals, and the results only match
 * if the rounding happens at the same points, so it is applied here in the same
 * places rather than once at the end.
 */

/** Milliseconds in one day. */
export const MS_PER_DAY = 86_400_000;

/** Milliseconds in one minute. */
export const MS_PER_MINUTE = 60_000;

/** Minutes in one day, the point where a step is long enough to be an interval. */
export const MINUTES_PER_DAY = 1440;

/**
 * Holds a value inside a range.
 *
 * @param value the number to constrain
 * @param min lower bound, applied first
 * @param max upper bound, applied second
 * @returns the value, moved into the range if it was outside it
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Rounds to eight decimals, the precision the reference implementation keeps
 * memory values at.
 *
 * @param value any finite number
 * @returns the value rounded to eight decimal places
 */
export function round8(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

/**
 * Whole days between two moments, counted as calendar days in UTC.
 *
 * FSRS is trained on data where a day is the unit of scheduling, so two answers
 * on the same UTC date are zero days apart no matter how many hours passed, and
 * answers on consecutive dates are one day apart even if only minutes passed.
 * The scheduler leans on that: zero elapsed days selects the same day formula.
 *
 * @param from the earlier moment
 * @param to the later moment
 * @returns the number of date boundaries crossed, negative if `to` is earlier
 */
export function calendarDaysBetween(from: Date, to: Date): number {
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());

  return Math.floor((end - start) / MS_PER_DAY);
}

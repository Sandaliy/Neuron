/**
 * Small numeric helpers shared by the formulas.
 *
 * The rounding helper is not cosmetic. The reference implementation rounds
 * every intermediate memory value to eight decimals, and the results only match
 * if the rounding happens at the same points, so it is applied here in the same
 * places rather than once at the end.
 *
 * Anything to do with days and calendars lives in ../time/day.ts, because
 * which day an answer belongs to is a question about the user's timezone
 * rather than a question about memory.
 */

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

/**
 * How long an answer takes.
 *
 * Everything downstream is measured in minutes, so this is the number the
 * whole workload manager rests on. It is measured rather than guessed: the
 * review log already records how long every answer took, and a person who
 * types out a full word is not the same person as one who taps a recognition
 * card, even when both have 200 cards due.
 *
 * Three decisions worth knowing about.
 *
 * The median is used, not the mean. A review interrupted by a phone call is
 * recorded as four minutes of thinking, and a handful of those would drag a
 * mean well past anything real.
 *
 * Everything above the 95th percentile is dropped before the median is taken.
 * The median already survives outliers, but the trim keeps the estimate steady
 * for the small samples where a couple of interruptions are a large share.
 *
 * The measured value is blended into the default rather than switched to.
 * Twenty answers is where the estimate starts being worth trusting, so the
 * weight moves from the default to the measurement linearly over those first
 * twenty. Without that, the forecast would jump the moment somebody crossed
 * the threshold, and a person watching the number would see it lurch for no
 * reason they could name.
 */

import type { CardDirection, WorkloadReview } from './types.js';
import type { CardState } from '../fsrs/types.js';

/** Seconds per answer, per direction, for somebody with no history yet. */
export type AnswerTimeDefaults = Readonly<Record<CardDirection, number>>;

/**
 * What an answer costs before anything has been measured. These are rough,
 * and they stop mattering after twenty reviews of that kind.
 */
export const DEFAULT_ANSWER_SECONDS: AnswerTimeDefaults = Object.freeze({
  recognition: 4,
  recall: 6,
  production: 12,
  cloze: 10,
  listening: 6,
});

/** Answers of one kind needed before the measurement is trusted on its own. */
export const ANSWER_TIME_SAMPLE = 20;

/** Everything slower than this share of the sample is treated as a break. */
export const ANSWER_TIME_TRIM = 0.95;

/** Measured seconds per answer, for every direction and every card state. */
export type AnswerTimes = Readonly<Record<CardDirection, Readonly<Record<CardState, number>>>>;

/** Milliseconds in one second. */
const MS_PER_SECOND = 1000;

/**
 * The middle value of a sorted list.
 *
 * @param sorted a non empty list in ascending order
 * @returns the middle value, or the mean of the two middle values
 */
function medianOfSorted(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? 0;
  }

  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/**
 * Turns a pile of measured durations into one number of seconds.
 *
 * @param durationsMs every recorded duration for one kind of answer
 * @param fallbackSeconds what to say when there is nothing to go on
 * @returns seconds per answer
 */
function estimateFromDurations(durationsMs: readonly number[], fallbackSeconds: number): number {
  const usable = durationsMs
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  if (usable.length === 0) {
    return fallbackSeconds;
  }

  // Nearest rank: the smallest value with at least 95% of the sample at or
  // below it. Everything past that index is a break rather than a thought.
  const lastKept = Math.ceil(ANSWER_TIME_TRIM * usable.length) - 1;
  const measured = medianOfSorted(usable.slice(0, lastKept + 1)) / MS_PER_SECOND;
  const weight = Math.min(usable.length, ANSWER_TIME_SAMPLE) / ANSWER_TIME_SAMPLE;

  return fallbackSeconds * (1 - weight) + measured * weight;
}

/**
 * How long one kind of answer takes this person.
 *
 * @param logs the user's review log, in any order
 * @param direction which way round the card asks
 * @param state the state the card was in when it was asked
 * @param defaults what to fall back on while the sample is small
 * @returns seconds per answer
 */
export function estimateAnswerTime(
  logs: readonly WorkloadReview[],
  direction: CardDirection,
  state: CardState,
  defaults: AnswerTimeDefaults = DEFAULT_ANSWER_SECONDS,
): number {
  const durations: number[] = [];

  for (const log of logs) {
    if (log.direction === direction && log.stateBefore === state) {
      durations.push(log.durationMs);
    }
  }

  return estimateFromDurations(durations, defaults[direction]);
}

/**
 * The whole table at once, in one pass over the log.
 *
 * The forecast asks for an answer time on every card of every simulated day,
 * so the table is built once and read from there. Calling
 * {@link estimateAnswerTime} in that loop would walk the log tens of thousands
 * of times.
 *
 * @param logs the user's review log, in any order
 * @param defaults what to fall back on while a sample is small
 * @returns seconds per answer for every direction and state
 */
export function estimateAnswerTimes(
  logs: readonly WorkloadReview[],
  defaults: AnswerTimeDefaults = DEFAULT_ANSWER_SECONDS,
): AnswerTimes {
  const buckets = new Map<string, number[]>();

  for (const log of logs) {
    const key = `${log.direction}:${log.stateBefore}`;
    const bucket = buckets.get(key);

    if (bucket === undefined) {
      buckets.set(key, [log.durationMs]);
    } else {
      bucket.push(log.durationMs);
    }
  }

  const forDirection = (direction: CardDirection): Record<CardState, number> => {
    const seconds = (state: CardState): number =>
      estimateFromDurations(buckets.get(`${direction}:${state}`) ?? [], defaults[direction]);

    return {
      new: seconds('new'),
      learning: seconds('learning'),
      review: seconds('review'),
      relearning: seconds('relearning'),
    };
  };

  return {
    recognition: forDirection('recognition'),
    recall: forDirection('recall'),
    production: forDirection('production'),
    cloze: forDirection('cloze'),
    listening: forDirection('listening'),
  };
}

/**
 * The table every direction and state would have with no history at all.
 *
 * @param defaults seconds per answer per direction
 * @returns a table holding those defaults everywhere
 */
export function defaultAnswerTimes(
  defaults: AnswerTimeDefaults = DEFAULT_ANSWER_SECONDS,
): AnswerTimes {
  return estimateAnswerTimes([], defaults);
}

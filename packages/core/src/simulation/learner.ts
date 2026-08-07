/**
 * A virtual student.
 *
 * The point of the simulator is to compare policies, so the learner has to be
 * the same person under each of them: same memory, same speed, same habits,
 * same seed. Everything about them is drawn from an injected generator, so a
 * run can be repeated exactly.
 *
 * The circularity has to be said out loud. Whether this learner remembers a
 * card is decided by the scheduler's own estimate of how likely they are to
 * remember it. The model both sets the exam and marks it, so the simulator
 * cannot tell you whether FSRS is right about human memory. Nothing here
 * claims it can. What it can tell you is what happens to the workload under
 * one policy against another, because the model is identical in both arms and
 * only the policy differs.
 *
 * The attendance model below is a second and much weaker claim, and it is kept
 * in its own type for exactly that reason. See {@link DropoutModel}.
 */

import { retrievability } from '../fsrs/scheduler.js';
import { RATING, type Rating, type SchedulingState } from '../fsrs/types.js';

import type { SchedulerConfig } from '../fsrs/parameters.js';
import type { RandomSource } from '../fsrs/random.js';
import type { CardDirection } from '../workload/types.js';

/** Seconds one answer takes this person, by direction. */
export type AnswerSpeed = Readonly<Record<CardDirection, number>>;

/** How fast somebody answers and how they grade themselves. */
export interface LearnerProfile {
  /** A name for the tables. */
  readonly name: string;
  /** Of the cards they do recall, the share they answer Hard. */
  readonly hardShare: number;
  /** Of the cards they do recall, the share they answer Easy. */
  readonly easyShare: number;
  /** How long an answer really takes them, before any measurement. */
  readonly seconds: AnswerSpeed;
  /**
   * How much one answer varies. 0.4 means most answers land within about
   * forty percent either side of their usual speed.
   */
  readonly secondsSpread: number;
}

/** Somebody ordinary: mostly right, a little slower than the defaults. */
export const AVERAGE_LEARNER: LearnerProfile = Object.freeze({
  name: 'average',
  hardShare: 0.12,
  easyShare: 0.08,
  seconds: Object.freeze({
    recognition: 5,
    recall: 7,
    production: 14,
    cloze: 11,
    listening: 7,
  }),
  secondsSpread: 0.4,
});

/**
 * Whether somebody opens the application today, and whether they ever open it
 * again.
 *
 * This is an assumption, not a measurement, and it is the weakest thing in the
 * simulator. It says that a day which looks like more work than was promised is
 * a day people are likelier to skip, and that enough skipped days in a row is
 * how a collection gets abandoned. Both are plausible and neither is measured
 * here.
 *
 *   chance of skipping = clamp(baseSkip + k * max(0, load / budget - 1), 0, maxSkip)
 *
 * Because `k` is unknown, the honest way to use this is to sweep it rather than
 * to pick a value. At k = 0 the model says overload has no effect on behaviour
 * and the two scheduling policies come out level. The interesting question is
 * how far above zero k has to be before that changes, which is a number the
 * simulator can produce and a fact about real people that it cannot.
 */
export interface DropoutModel {
  /** The chance of skipping a day that is exactly on budget. */
  readonly baseSkip: number;
  /** How steeply the chance of skipping rises with overload. The unknown. */
  readonly overloadSensitivity: number;
  /** The chance of skipping never goes above this. */
  readonly maxSkip: number;
  /**
   * Consecutive skipped days after which the collection is abandoned.
   *
   * Days the scenario says the learner was away do not count. A holiday is a
   * stated fact rather than a sign of giving up, and letting the two be the
   * same thing would mean any absence longer than this ended the run.
   */
  readonly abandonAfterSkippedDays: number;
}

/**
 * The default attendance: two days a month skipped, overload changes nothing,
 * three weeks of silence counts as having given up.
 */
export const DEFAULT_DROPOUT: DropoutModel = Object.freeze({
  baseSkip: 0.05,
  overloadSensitivity: 0,
  maxSkip: 0.9,
  abandonAfterSkippedDays: 21,
});

/** What the learner did with one card. */
export interface Answer {
  readonly rating: Rating;
  readonly durationMs: number;
  readonly recalled: boolean;
}

/**
 * Asks the learner a card.
 *
 * @param state the card as it stands
 * @param direction which way round it asks
 * @param now the moment of the answer
 * @param profile who is answering
 * @param config the scheduler settings, read for the memory model
 * @param rng the seeded generator
 * @returns the button they pressed and how long they took
 */
export function answerCard(
  state: SchedulingState,
  direction: CardDirection,
  now: Date,
  profile: LearnerProfile,
  config: SchedulerConfig,
  rng: RandomSource,
): Answer {
  // A card being seen for the first time is not a memory test, so it counts as
  // recalled and is graded like any other first answer.
  const chance = state.state === 'new' ? 1 : retrievability(state, now, config);
  const recalled = rng() < chance;

  if (!recalled) {
    return {
      rating: RATING.again,
      durationMs: durationFor(direction, state, profile, rng),
      recalled,
    };
  }

  const roll = rng();
  const rating =
    roll < profile.hardShare
      ? RATING.hard
      : roll < profile.hardShare + profile.easyShare
        ? RATING.easy
        : RATING.good;

  return { rating, durationMs: durationFor(direction, state, profile, rng), recalled };
}

/**
 * How long this answer took.
 *
 * A card being learned or relearned takes half as long again as one being
 * reviewed, and every answer is scattered around the person's usual speed.
 * This is what the answer time estimator has to measure back out of the log,
 * so it matters that it is not a constant.
 */
function durationFor(
  direction: CardDirection,
  state: SchedulingState,
  profile: LearnerProfile,
  rng: RandomSource,
): number {
  const base = profile.seconds[direction] * (state.state === 'review' ? 1 : 1.5);
  // Two draws averaged give a rough bell rather than a flat spread, so the
  // median stays near the true speed and the tail is thin.
  const spread = 1 + ((rng() + rng()) / 2 - 0.5) * 2 * profile.secondsSpread;

  return Math.max(base * spread, 0.5) * 1000;
}

/**
 * How likely this person is to skip today.
 *
 * @param model the attendance assumption
 * @param loadMinutes what today looks like when the application is opened
 * @param budgetMinutes what they agreed to
 * @returns a probability from 0 to 1
 */
export function skipChance(
  model: DropoutModel,
  loadMinutes: number,
  budgetMinutes: number,
): number {
  const overload = budgetMinutes > 0 ? Math.max(0, loadMinutes / budgetMinutes - 1) : 0;
  const chance = model.baseSkip + model.overloadSensitivity * overload;

  return Math.min(Math.max(chance, 0), model.maxSkip);
}

/**
 * Whether the learner studies today.
 *
 * @param model the attendance assumption
 * @param loadMinutes what today looks like when the application is opened
 * @param budgetMinutes what they agreed to
 * @param rng the seeded generator
 * @returns true when they study
 */
export function studiesToday(
  model: DropoutModel,
  loadMinutes: number,
  budgetMinutes: number,
  rng: RandomSource,
): boolean {
  return rng() >= skipChance(model, loadMinutes, budgetMinutes);
}

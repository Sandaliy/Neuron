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
 */

import { retrievability } from '../fsrs/scheduler.js';
import { RATING, type Rating, type SchedulingState } from '../fsrs/types.js';

import type { SchedulerConfig } from '../fsrs/parameters.js';
import type { RandomSource } from '../fsrs/random.js';
import type { CardDirection } from '../workload/types.js';

/** Seconds one answer takes this person, by direction. */
export type AnswerSpeed = Readonly<Record<CardDirection, number>>;

/** Who is studying. */
export interface LearnerProfile {
  /** A name for the tables. */
  readonly name: string;
  /** Of the cards they do recall, the share they answer Hard. */
  readonly hardShare: number;
  /** Of the cards they do recall, the share they answer Easy. */
  readonly easyShare: number;
  /** How many days in a month they skip entirely. */
  readonly skippedDaysPerMonth: number;
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
  skippedDaysPerMonth: 2,
  seconds: Object.freeze({
    recognition: 5,
    recall: 7,
    production: 14,
    cloze: 11,
    listening: 7,
  }),
  secondsSpread: 0.4,
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
 * Whether the learner sits down to study at all today.
 *
 * @param profile who is studying
 * @param rng the seeded generator
 * @returns true when they study
 */
export function studiesToday(profile: LearnerProfile, rng: RandomSource): boolean {
  return rng() >= profile.skippedDaysPerMonth / 30;
}

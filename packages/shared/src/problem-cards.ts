/**
 * Slipping Cards: which Cards the learner keeps forgetting, and why each one is listed.
 *
 * This is a recommendation to look at material, never a scheduling decision. Nothing here
 * changes a Card, a Note or a Review, and nothing claims to know why something is forgotten.
 *
 * Evidence is a Card's current learning history: its answers that still count. That excludes
 * an answer taken back with Undo, the cancellation event itself, every answer before the most
 * recent restart event, and every answer before an explicit Card reset. Each Card direction
 * (and each Cloze gap) has its own history, so one direction can be listed while another of
 * the same Note is not.
 *
 * The thresholds are hypotheses for owner testing (ROADMAP Milestone 9), deliberately
 * conservative and visible to the learner in plain words:
 *
 * - Repeated lapses: forgotten at least 3 times after it had been learned, that is, answered
 *   Again while it was on a schedule measured in days.
 * - Frequent Again: at least 4 Again answers, making up at least half of all counted answers.
 *   This catches a Card that never settles, including during its first learning steps, while a
 *   long-studied Card with occasional misses is left alone.
 *
 * One or two misses are never enough on their own, whatever the share.
 */

import type { Rating } from './rating.js';

export const PROBLEM_CARD_POLICY = {
  /** Again answers given while the Card was in the review state. */
  repeatedLapses: 3,
  /** Again answers in the current history, any state. */
  frequentAgain: 4,
  /** The least share of counted answers that were Again, for the second rule. */
  frequentAgainShare: 0.5,
  /** Successful answers in a row since the last Again that read as recovering. */
  recovering: 3,
  /** How many recent answers each listed Card carries as its explanation. */
  recentAnswers: 8,
} as const;

/**
 * Every rule needs at least this many counted answers, and the Card's `reps` projection is
 * never smaller than its counted answers. The server uses it as an exact index-friendly
 * pre-filter before it reads any Review.
 */
export const PROBLEM_CARD_MINIMUM_ANSWERS = Math.min(
  PROBLEM_CARD_POLICY.frequentAgain,
  // Each rule counts answers, so neither can be met with fewer answers than its threshold.
  PROBLEM_CARD_POLICY.repeatedLapses,
);

export const PROBLEM_REASONS = ['repeated_lapses', 'frequent_again'] as const;
export type ProblemReason = (typeof PROBLEM_REASONS)[number];

export interface ProblemCounts {
  /** Counted answers in the current history. */
  readonly answers: number;
  /** Counted Again answers, any state. */
  readonly again: number;
  /** Counted Again answers given in the review state. */
  readonly lapses: number;
}

/** The rules a Card meets, in a fixed order. Empty means it is not listed. */
export function problemReasons(counts: ProblemCounts): ProblemReason[] {
  const reasons: ProblemReason[] = [];
  if (counts.lapses >= PROBLEM_CARD_POLICY.repeatedLapses) reasons.push('repeated_lapses');
  if (
    counts.again >= PROBLEM_CARD_POLICY.frequentAgain &&
    counts.again >= counts.answers * PROBLEM_CARD_POLICY.frequentAgainShare
  )
    reasons.push('frequent_again');
  return reasons;
}

/** Recovering is a description of the latest answers, not a reason to hide the Card. */
export function isRecovering(sinceLastAgain: number): boolean {
  return sinceLastAgain >= PROBLEM_CARD_POLICY.recovering;
}

export interface CountedAnswer {
  readonly rating: Rating;
  readonly stateBefore: string;
}

/**
 * The same counts from answers already filtered to the current history, oldest first.
 * Used by tests to state the policy over a plain sequence.
 */
export function countAnswers(answers: readonly CountedAnswer[]): ProblemCounts & {
  readonly sinceLastAgain: number;
} {
  let again = 0;
  let lapses = 0;
  let sinceLastAgain = 0;
  for (const answer of answers) {
    if (answer.rating === 'again') {
      again++;
      if (answer.stateBefore === 'review') lapses++;
      sinceLastAgain = 0;
    } else sinceLastAgain++;
  }
  return { answers: answers.length, again, lapses, sinceLastAgain };
}

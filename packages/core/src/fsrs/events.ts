import { createSeededRandom } from './random.js';
import { review } from './scheduler.js';
import { newCard } from './types.js';

import type { SchedulerConfig } from './parameters.js';
import type { ReviewLog, SchedulingState } from './types.js';

export interface ReviewEvent {
  readonly id: string;
  readonly resetsLearning?: boolean;
  readonly order?: number;
  readonly log: ReviewLog;
  readonly cancelsReviewId?: string | null;
  readonly priorState?: SchedulingState;
}

export function reviewSeed(id: string): number {
  let seed = 0;
  for (const character of id.replaceAll('-', ''))
    seed = (Math.imul(seed, 31) + character.charCodeAt(0)) | 0;
  return seed >>> 0;
}

/** Find the beginning of a merged history without depending on arrival order. */
export function reviewProjectionOrigin(
  events: readonly ReviewEvent[],
  fallback: SchedulingState,
): SchedulingState {
  const candidates = events.flatMap((event) => (event.priorState ? [event.priorState] : []));
  return candidates.sort(compareOrigins)[0] ?? fallback;
}

/** Cancellation is set subtraction, never a state assignment at event arrival time. */
export function projectReviewEvents(
  events: readonly ReviewEvent[],
  initial: SchedulingState,
  config: SchedulerConfig,
): SchedulingState {
  const unique = new Map(events.map((event) => [event.id, event]));
  const cancelled = new Set(
    [...unique.values()].flatMap((event) => (event.cancelsReviewId ? [event.cancelsReviewId] : [])),
  );
  const answers = [...unique.values()]
    .filter((event) => !event.cancelsReviewId)
    .sort(
      (a, b) =>
        a.log.reviewedAt.getTime() - b.log.reviewedAt.getTime() ||
        (a.order ?? 0) - (b.order ?? 0) ||
        a.id.localeCompare(b.id),
    );
  let state = initial;
  let changed = false;
  for (const event of answers) {
    if (event.resetsLearning) {
      state = newCard(event.log.reviewedAt);
      changed = false;
      continue;
    }
    if (cancelled.has(event.id)) {
      changed = true;
      continue;
    }
    // Out-of-order arrivals may have been graded against another predecessor.
    // Preserve recorded placement only while that predecessor is still valid.
    if (event.priorState && !sameState(state, event.priorState)) changed = true;
    const next = review(
      state,
      event.log.rating,
      event.log.reviewedAt,
      config,
      createSeededRandom(reviewSeed(event.id)),
      event.log.durationMs,
    ).next;
    state = changed ? next : { ...next, due: event.log.placedDue };
  }
  return state;
}

function sameState(a: SchedulingState, b: SchedulingState): boolean {
  return (
    a.state === b.state &&
    a.reps === b.reps &&
    a.lapses === b.lapses &&
    a.learningStep === b.learningStep &&
    a.due.getTime() === b.due.getTime() &&
    a.lastReview?.getTime() === b.lastReview?.getTime() &&
    a.stability === b.stability &&
    a.difficulty === b.difficulty
  );
}

function compareOrigins(a: SchedulingState, b: SchedulingState): number {
  return (
    a.reps - b.reps ||
    a.lapses - b.lapses ||
    (a.lastReview?.getTime() ?? Number.MIN_SAFE_INTEGER) -
      (b.lastReview?.getTime() ?? Number.MIN_SAFE_INTEGER) ||
    a.due.getTime() - b.due.getTime() ||
    a.state.localeCompare(b.state) ||
    a.learningStep - b.learningStep ||
    (a.stability ?? -1) - (b.stability ?? -1) ||
    (a.difficulty ?? -1) - (b.difficulty ?? -1)
  );
}

/**
 * Small builders for cards, used by the tests and by the simulator.
 *
 * They live in the package rather than in a test file because the simulator
 * needs them too, and two copies of "what a card looks like" would drift.
 */

import { MS_PER_DAY } from '../time/day.js';

import type { CardDirection, WorkloadCard } from './types.js';
import type { SchedulingState } from '../fsrs/types.js';

/** What a card looks like before anything has been decided about it. */
export interface CardShape {
  readonly id: string;
  readonly noteId?: string;
  readonly direction?: CardDirection;
}

/**
 * A card in the review state.
 *
 * @param shape the identity of the card
 * @param stability its stability in days
 * @param due when it comes up next
 * @param difficulty how hard it is for this person, 1 to 10
 * @returns the card
 */
export function reviewCard(
  shape: CardShape,
  stability: number,
  due: Date,
  difficulty = 5,
): WorkloadCard {
  const scheduling: SchedulingState = {
    state: 'review',
    stability,
    difficulty,
    lastReview: new Date(due.getTime() - stability * MS_PER_DAY),
    due,
    reps: 5,
    lapses: 0,
    learningStep: 0,
  };

  return {
    id: shape.id,
    noteId: shape.noteId ?? `note-${shape.id}`,
    direction: shape.direction ?? 'recall',
    scheduling,
  };
}

/**
 * A card nobody has answered yet.
 *
 * @param shape the identity of the card
 * @param createdAt when it entered the collection
 * @returns the card
 */
export function freshCard(shape: CardShape, createdAt: Date): WorkloadCard {
  return {
    id: shape.id,
    noteId: shape.noteId ?? `note-${shape.id}`,
    direction: shape.direction ?? 'recall',
    scheduling: {
      state: 'new',
      stability: undefined,
      difficulty: undefined,
      lastReview: undefined,
      due: createdAt,
      reps: 0,
      lapses: 0,
      learningStep: 0,
    },
  };
}

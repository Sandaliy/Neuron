import { RATING, newCard } from '@neuron/core';
import type { CardState, Rating, ReviewLog, SchedulingState } from '@neuron/core';
import { RATINGS } from '@neuron/shared';
import type { Rating as RatingWord } from '@neuron/shared';

/**
 * Translating between a database row and what packages/core works with.
 *
 * The scheduler thinks in a discriminated union and in numbers. The database
 * stores columns and words. Everything that crosses between the two goes
 * through this file, so there is one place to look when a value arrives
 * looking wrong.
 */

/** The scheduling half of a card row. */
export interface CardStateRow {
  readonly state: string;
  readonly stability: number | null;
  readonly difficulty: number | null;
  readonly due: Date;
  readonly lastReview: Date | null;
  readonly reps: number;
  readonly lapses: number;
  readonly learningStep: number;
}

/** The columns of a review row that the scheduler cares about. */
export interface ReviewLogRow {
  readonly rating: string;
  readonly reviewedAt: Date;
  readonly elapsedDays: number;
  readonly scheduledDays: number;
  readonly placedDue: Date;
  readonly stateBefore: string;
  readonly stabilityBefore: number | null;
  readonly difficultyBefore: number | null;
  readonly durationMs: number;
}

/**
 * The rating as a word, for storage.
 *
 * The log stores words rather than the numbers FSRS indexes its weights with,
 * because a row someone reads in a database browser two years from now should
 * say what happened.
 *
 * @param rating the rating as the scheduler uses it
 * @returns the word stored in the review log
 */
export function ratingToWord(rating: Rating): RatingWord {
  const word = RATINGS[rating - 1];

  if (word === undefined) {
    throw new RangeError(`no word for rating ${rating}`);
  }

  return word;
}

/**
 * The rating as a number, for the scheduler.
 *
 * @param word the word stored in the review log
 * @returns the rating as the scheduler uses it
 */
export function wordToRating(word: string): Rating {
  const index = RATINGS.indexOf(word as RatingWord);

  if (index < 0) {
    throw new RangeError(`not a rating: ${word}`);
  }

  return (index + 1) as Rating;
}

/**
 * Reads a card row as the scheduler's view of the card.
 *
 * The check constraint on the table already refuses a row that contradicts the
 * union, so the branches here mirror a shape the database is holding to rather
 * than guessing at one.
 *
 * @param row the scheduling columns of a card
 * @returns the card as the scheduler sees it
 */
export function toSchedulingState(row: CardStateRow): SchedulingState {
  if (row.state === 'new') {
    return {
      ...newCard(row.due),
      reps: row.reps,
      lapses: row.lapses,
      learningStep: row.learningStep,
    };
  }

  if (row.stability === null || row.difficulty === null || row.lastReview === null) {
    throw new Error(`card in state ${row.state} is missing its memory state`);
  }

  return {
    state: row.state as Exclude<CardState, 'new'>,
    stability: row.stability,
    difficulty: row.difficulty,
    lastReview: row.lastReview,
    due: row.due,
    reps: row.reps,
    lapses: row.lapses,
    learningStep: row.learningStep,
  };
}

/**
 * Turns the scheduler's view of a card back into columns.
 *
 * @param state the card as the scheduler left it
 * @returns the columns to write
 */
export function fromSchedulingState(state: SchedulingState): CardStateRow {
  return {
    state: state.state,
    stability: state.stability ?? null,
    difficulty: state.difficulty ?? null,
    due: state.due,
    lastReview: state.lastReview ?? null,
    reps: state.reps,
    lapses: state.lapses,
    learningStep: state.learningStep,
  };
}

/**
 * Reads a review row as a log entry.
 *
 * @param row the review row
 * @returns the entry, ready to hand to replay
 */
export function toReviewLog(row: ReviewLogRow): ReviewLog {
  return {
    rating: wordToRating(row.rating),
    reviewedAt: row.reviewedAt,
    elapsedDays: row.elapsedDays,
    scheduledDays: row.scheduledDays,
    placedDue: row.placedDue,
    stateBefore: row.stateBefore as CardState,
    stabilityBefore: row.stabilityBefore ?? undefined,
    difficultyBefore: row.difficultyBefore ?? undefined,
    durationMs: row.durationMs,
  };
}

/**
 * Turns a log entry into columns.
 *
 * @param log the entry the scheduler produced
 * @returns the columns to write
 */
export function fromReviewLog(log: ReviewLog): ReviewLogRow {
  return {
    rating: ratingToWord(log.rating),
    reviewedAt: log.reviewedAt,
    elapsedDays: log.elapsedDays,
    scheduledDays: log.scheduledDays,
    placedDue: log.placedDue,
    stateBefore: log.stateBefore,
    stabilityBefore: log.stabilityBefore ?? null,
    difficultyBefore: log.difficultyBefore ?? null,
    durationMs: log.durationMs,
  };
}

/** Every rating, as the words stored in the log. Handy in tests and seeds. */
export const RATING_WORDS = {
  again: ratingToWord(RATING.again),
  hard: ratingToWord(RATING.hard),
  good: ratingToWord(RATING.good),
  easy: ratingToWord(RATING.easy),
} as const;

/**
 * The vocabulary of the scheduler: what a card knows about itself and what a
 * single answer records.
 */

/**
 * The four answers a review can end with. FSRS uses the numbers directly (the
 * rating indexes the weight vector and appears in several exponents), so they
 * are part of the algorithm rather than a storage choice.
 */
export const RATING = {
  again: 1,
  hard: 2,
  good: 3,
  easy: 4,
} as const;

/** One of the four answers, as the number FSRS works with. */
export type Rating = (typeof RATING)[keyof typeof RATING];

/** The four ratings in button order, for code that has to cover all of them. */
export const RATINGS: readonly Rating[] = [RATING.again, RATING.hard, RATING.good, RATING.easy];

/**
 * Where a card sits in its life.
 *
 * - `new` has never been answered
 * - `learning` is walking through the learning steps for the first time
 * - `review` is on a schedule measured in days
 * - `relearning` is walking through the relearning steps after a lapse
 */
export type CardState = 'new' | 'learning' | 'review' | 'relearning';

/** The parts of the state that exist whatever the card has been through. */
interface CardCounters {
  /** When the card comes up next. */
  readonly due: Date;
  /** How many answers the card has had, lapses included. */
  readonly reps: number;
  /** How many times a card already in the review state was answered Again. */
  readonly lapses: number;
  /** Index into the learning or relearning steps. Zero outside those states. */
  readonly learningStep: number;
}

/**
 * A card nobody has answered yet. It has no memory state, and saying so in the
 * type is the point: a zero stability would flow through the formulas and come
 * out as a number that looks like an answer.
 */
export interface NewCardState extends CardCounters {
  readonly state: 'new';
  readonly stability: undefined;
  readonly difficulty: undefined;
  readonly lastReview: undefined;
}

/** A card with at least one answer behind it, so it has a memory state. */
export interface ReviewedCardState extends CardCounters {
  readonly state: 'learning' | 'review' | 'relearning';
  /** Days until the chance of recall falls to 90%. Always above zero. */
  readonly stability: number;
  /** How hard this card is for this person, from 1 to 10. */
  readonly difficulty: number;
  /** When the last answer was given. */
  readonly lastReview: Date;
}

/**
 * Everything the scheduler needs to know about one card. Narrow on `state` to
 * get at the memory values.
 */
export type SchedulingState = NewCardState | ReviewedCardState;

/**
 * One row of the review log. The log is append only and card state is a
 * projection of it, so these are the fields needed to rebuild a card and to
 * explain afterwards why it was scheduled the way it was.
 */
export interface ReviewLog {
  /** The answer given. */
  readonly rating: Rating;
  /** When it was given. */
  readonly reviewedAt: Date;
  /** Whole days between the previous answer and this one. Zero on the first. */
  readonly elapsedDays: number;
  /** Whole days the card had been waiting for. Zero for a card in learning. */
  readonly scheduledDays: number;
  /** The state the card was in when the question was asked. */
  readonly stateBefore: CardState;
  /** Stability before this answer, absent on the first review of a card. */
  readonly stabilityBefore: number | undefined;
  /** Difficulty before this answer, absent on the first review of a card. */
  readonly difficultyBefore: number | undefined;
  /** How long the answer took. The scheduler does not read it. */
  readonly durationMs: number;
}

/**
 * Builds the state of a card that has never been answered.
 *
 * @param createdAt when the card entered the collection, which is when it is due
 * @returns a new card, ready for its first review
 */
export function newCard(createdAt: Date): NewCardState {
  return {
    state: 'new',
    stability: undefined,
    difficulty: undefined,
    lastReview: undefined,
    due: createdAt,
    reps: 0,
    lapses: 0,
    learningStep: 0,
  };
}

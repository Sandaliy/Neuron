/**
 * The vocabulary of the workload manager.
 *
 * The scheduler works on one card at a time and knows nothing about the rest
 * of the collection. The workload manager works on all of them at once, so it
 * needs a little more: which note a card belongs to, which direction it tests,
 * and how long its answers have taken.
 */

import type { CardState, ReviewLog, SchedulingState } from '../fsrs/types.js';

/** A card's identity. Opaque here, a UUID in the database. */
export type CardId = string;

/** A note's identity. Several cards can point at the same note. */
export type NoteId = string;

/**
 * Which way round a card asks its note.
 *
 * The direction is what makes answer times differ by a factor of three:
 * recognising a word you are shown is not the same task as producing it from
 * nothing, and a schedule built on one average for both is wrong for both.
 */
export type CardDirection = 'recognition' | 'recall' | 'production' | 'cloze' | 'listening';

/** Every direction, for code that has to cover all of them. */
export const CARD_DIRECTIONS: readonly CardDirection[] = [
  'recognition',
  'recall',
  'production',
  'cloze',
  'listening',
];

/** Every card state, for code that has to cover all of them. */
export const CARD_STATES: readonly CardState[] = ['new', 'learning', 'review', 'relearning'];

/** A card as the workload manager sees it. */
export interface WorkloadCard {
  readonly id: CardId;
  /** The note this card asks about. Two cards of one note share it. */
  readonly noteId: NoteId;
  /** Which way round the card asks. */
  readonly direction: CardDirection;
  /** Everything the scheduler knows about the card. */
  readonly scheduling: SchedulingState;
}

/**
 * A row of the review log, with the two card facts the workload manager needs.
 *
 * The scheduler does not care which card a row belongs to, because it is
 * handed the card. The workload manager reads the log the other way round: it
 * asks how long answers of a given kind take, so the row has to say what kind
 * of answer it was.
 */
export interface WorkloadReview extends ReviewLog {
  readonly cardId: CardId;
  readonly direction: CardDirection;
}

/** What one day of study is expected to cost. */
export interface DailyLoad {
  /** The study day, counted from 1 January 1970 in the user's timezone. */
  readonly dayIndex: number;
  /** The moment that study day starts. */
  readonly date: Date;
  /** Reviews expected that day. Fractional, because it is an expectation. */
  readonly reviewCount: number;
  /** Minutes of work expected that day. */
  readonly minutes: number;
  /** New cards expected to be introduced that day. */
  readonly newCardCount: number;
}

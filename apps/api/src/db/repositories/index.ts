import { accountRepository } from './account.js';
import { cardRepository } from './cards.js';
import { deckRepository } from './decks.js';
import { noteTypeRepository } from './note-types.js';
import { noteRepository } from './notes.js';
import { reviewRepository } from './reviews.js';
import { nameUser, transactionRunner } from './session.js';
import { importBatchRepository, presetRepository } from './study.js';
import { syncRepository } from './sync.js';

import type { AccountRepository } from './account.js';
import type { CardRepository } from './cards.js';
import type { Database } from '../client.js';
import type { DeckRepository } from './decks.js';
import type { NoteTypeRepository } from './note-types.js';
import type { NoteRepository } from './notes.js';
import type { ReviewRepository } from './reviews.js';
import type { Runner } from './session.js';
import type { ImportBatchRepository, PresetRepository } from './study.js';
import type { SyncRepository } from './sync.js';

/**
 * The only way into the database.
 *
 * There is no exported function here that takes a bare database handle, and no
 * repository method takes a user id. The user is supplied once, when the set is
 * built, and every statement afterwards carries it. A query that forgot whose
 * data it was reading is not something a reviewer has to catch, because it is
 * not something anyone can write.
 *
 * That is the first of the two barriers. The second is in the database: every
 * statement runs inside a transaction that names the user, and the isolation
 * policies compare rows against that name. If this layer were somehow bypassed,
 * the connection would read an empty database rather than someone else's.
 */

export interface Repositories {
  readonly decks: DeckRepository;
  readonly notes: NoteRepository;
  readonly noteTypes: NoteTypeRepository;
  readonly cards: CardRepository;
  readonly reviews: ReviewRepository;
  readonly presets: PresetRepository;
  readonly importBatches: ImportBatchRepository;
  readonly sync: SyncRepository;
  readonly account: AccountRepository;
  /**
   * Runs several operations in one transaction.
   *
   * Everything inside either all lands or none of it does. Each repository write
   * still allocates its own revision. Creating a note and its cards belongs here: a note with no cards
   * is invisible, and a card with no note is an error waiting to be read.
   */
  readonly transaction: <T>(work: (repositories: Repositories) => Promise<T>) => Promise<T>;
}

function build(db: Database, userId: string, run: Runner): Repositories {
  return {
    decks: deckRepository(userId, run),
    notes: noteRepository(userId, run),
    noteTypes: noteTypeRepository(userId, run),
    cards: cardRepository(userId, run),
    reviews: reviewRepository(userId, run),
    presets: presetRepository(userId, run),
    importBatches: importBatchRepository(userId, run),
    sync: syncRepository(userId, run),
    account: accountRepository(userId, run),

    transaction: async (work) =>
      db.transaction(async (tx) => {
        await nameUser(tx, userId);

        // The nested set runs everything on this transaction rather than
        // opening its own. Revision allocation stays with each repository write.
        return work(build(db, userId, async (inner) => inner(tx)));
      }),
  };
}

/**
 * Builds the repositories for one user.
 *
 * @param db the client
 * @param userId whose data these repositories may touch
 * @returns the repositories
 */
export function createRepositories(db: Database, userId: string): Repositories {
  if (!userId) {
    throw new Error('repositories cannot be built without a user');
  }

  return build(db, userId, transactionRunner(db, userId));
}

export { DeckCycle, DeckNotFound } from './decks.js';
export { UnknownNoteType } from './notes.js';
export { CardNotFound, seedFromReviewId } from './reviews.js';
export { RATING_WORDS, ratingToWord, toReviewLog, wordToRating } from './mapping.js';
export { toSchedulingState } from './mapping.js';
export { MAX_CLOCK_SKEW_MS } from './sync.js';

export type { AccountRow, UpdatePreferences } from './account.js';
export type { CardRow, CreateCard, DeckCount, DueQuery } from './cards.js';
export type { CreateDeck, DeckRow } from './decks.js';
export type { NoteTypeRow } from './note-types.js';
export type { CreateNote, ListNotes, NotePage, NoteRow } from './notes.js';
export type { RecordReview, RecordedReview, ReviewRow } from './reviews.js';
export type { ImportBatchRow, StudyPresetRow } from './study.js';
export type {
  ConflictedChange,
  IncomingChange,
  PullResult,
  PushResult,
  PushableEntity,
  SyncRow,
} from './sync.js';

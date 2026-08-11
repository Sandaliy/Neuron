import { account, session, user, verification } from './auth.js';
import { cards } from './cards.js';
import { decks } from './decks.js';
import { noteTypes } from './note-types.js';
import { notes } from './notes.js';
import { reviews } from './reviews.js';
import { importBatches, studyPresets } from './study.js';

/**
 * Every table, in one object for the Drizzle client and the migration tool.
 *
 * The tables a user owns are listed separately because the security work has to
 * cover all of them and nothing else: the four Better Auth tables carry no
 * isolation policy, for the reason written in docs/architecture.md, and
 * `note_types` has its own policy because the built in types belong to nobody.
 * Deriving both lists from one place means a table added later cannot be
 * quietly left out of the checks that prove isolation works.
 */

export { account, session, user, verification } from './auth.js';
export { cards } from './cards.js';
export { decks } from './decks.js';
export { noteTypes } from './note-types.js';
export { notes } from './notes.js';
export { reviews } from './reviews.js';
export { importBatches, studyPresets } from './study.js';

export const schema = {
  user,
  session,
  account,
  verification,
  decks,
  noteTypes,
  notes,
  cards,
  reviews,
  studyPresets,
  importBatches,
};

/** Tables whose rows belong to exactly one user, keyed by a `user_id` column. */
export const USER_OWNED_TABLES = [
  'decks',
  'notes',
  'cards',
  'reviews',
  'study_presets',
  'import_batches',
] as const;

/** Tables Better Auth owns, which carry no isolation policy. */
export const AUTH_TABLES = ['user', 'session', 'account', 'verification'] as const;

/** Tables the application writes to, in an order that satisfies the keys. */
export const WRITE_ORDER = [
  'decks',
  'import_batches',
  'notes',
  'cards',
  'reviews',
  'study_presets',
] as const;

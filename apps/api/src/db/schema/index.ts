import { account, session, user, verification } from './auth.js';
import { cards } from './cards.js';
import { decks } from './decks.js';
import { noteTypes } from './note-types.js';
import { notes } from './notes.js';
import { rateLimits } from './rate-limits.js';
import { reviews } from './reviews.js';
import { importBatches, studyPresets } from './study.js';
import { syncConflicts } from './sync.js';

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
export { rateLimits } from './rate-limits.js';
export { reviews } from './reviews.js';
export { importBatches, studyPresets } from './study.js';
export { CONFLICT_REASONS, syncConflicts } from './sync.js';

/**
 * The four tables Better Auth owns, on their own.
 *
 * Better Auth is handed this rather than the whole schema, so the one client
 * holding the credential that can read a password hash cannot also name a
 * table in the collection.
 */
export const authSchema = { user, session, account, verification };

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
  syncConflicts,
  rateLimits,
};

/** Tables whose rows belong to exactly one user, keyed by a `user_id` column. */
export const USER_OWNED_TABLES = [
  'decks',
  'notes',
  'cards',
  'reviews',
  'study_presets',
  'import_batches',
  'sync_conflicts',
] as const;

/**
 * Tables Better Auth owns.
 *
 * These are reached over a second connection, as a role of their own. The
 * application role can read a few columns of `user` and nothing else here,
 * which is what keeps an email address and a password hash out of reach of a
 * bug in a route handler. See `0004_auth_isolation.sql`.
 */
export const AUTH_TABLES = ['user', 'session', 'account', 'verification'] as const;

/**
 * Columns of `user` the application role may read.
 *
 * Everything the scheduler and the preferences screen need, and nothing that
 * identifies the person. Listed here rather than only in the migration so that
 * a query selecting something else fails the moment someone writes it, instead
 * of at run time in production.
 */
export const USER_COLUMNS_FOR_APP = [
  'id',
  'timezone',
  'day_cutoff_hour',
  'locale',
  'theme',
  'plan',
  'settings',
  'current_rev',
  'created_at',
  'updated_at',
] as const;

/** Columns of `user` the application role may write, on its own row only. */
export const USER_COLUMNS_WRITABLE_BY_APP = [
  'timezone',
  'day_cutoff_hour',
  'locale',
  'theme',
  'settings',
  'current_rev',
  'updated_at',
] as const;

/** Tables the application writes to, in an order that satisfies the keys. */
export const WRITE_ORDER = [
  'decks',
  'import_batches',
  'notes',
  'cards',
  'reviews',
  'study_presets',
  'sync_conflicts',
] as const;

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { id, instant, withoutNulls } from './columns.js';
import { decks } from './decks.js';
import { owned } from './owned.js';

/**
 * Saved session settings, and a record of every import.
 */

/**
 * A way of studying: which directions are on, what appears on the front, how
 * the answer is given, whether audio plays.
 *
 * A preset with no deck is global and offered everywhere. One attached to a
 * deck belongs to that deck and the decks under it.
 */
export const studyPresets = pgTable(
  'study_presets',
  {
    id: id(),
    ...owned(),
    /** Null means the preset is offered on every deck. */
    deckId: uuid('deck_id').references(() => decks.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    config: jsonb('config').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
  },
  (table) => [
    index('study_presets_user_deck_idx')
      .on(table.userId, table.deckId)
      .where(sql`${table.deletedAt} is null`),
    index('study_presets_user_rev_idx').on(table.userId, table.rev),
    /** At most one default per deck, and one global default. */
    uniqueIndex('study_presets_one_default_key')
      .on(table.userId, withoutNulls(table.deckId, 'uuid'))
      .where(sql`${table.isDefault} and ${table.deletedAt} is null`),
    check('study_presets_name_not_blank', sql`length(btrim(${table.name})) > 0`),
    check('study_presets_rev_not_negative', sql`${table.rev} >= 0`),
  ],
);

/**
 * One import, so that a bad one can be undone in a single action.
 *
 * Five hundred badly generated cards is a normal thing to do once. Picking them
 * out of a deck by hand afterwards is not, so every imported note points back
 * at the batch it arrived in.
 */
export const importBatches = pgTable(
  'import_batches',
  {
    id: id(),
    ...owned(),
    /** Where the notes landed. Kept even after the batch is undone. */
    deckId: uuid('deck_id')
      .notNull()
      .references(() => decks.id, { onDelete: 'cascade' }),
    /** Where the notes came from: a file name, a list name, a prompt. */
    source: text('source').notNull(),
    /** What the file was, so an undo can explain what it is about to remove. */
    format: text('format').notNull().default('json'),
    noteCount: integer('note_count').notNull().default(0),
    /** Set when the import was rolled back. Null while it stands. */
    undoneAt: instant('undone_at'),
  },
  (table) => [
    index('import_batches_user_created_idx').on(table.userId, table.createdAt),
    index('import_batches_user_rev_idx').on(table.userId, table.rev),
    check('import_batches_note_count_not_negative', sql`${table.noteCount} >= 0`),
    check('import_batches_rev_not_negative', sql`${table.rev} >= 0`),
  ],
);

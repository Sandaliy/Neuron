import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { NOTE_STATUSES } from '@neuron/shared';
import type { NoteFields } from '@neuron/shared';

import { id, literalList } from './columns.js';
import { decks } from './decks.js';
import { noteTypes } from './note-types.js';
import { owned } from './owned.js';
import { importBatches } from './study.js';

/**
 * A note is the fact. A word with everything known about it.
 *
 * The cards that ask about it live in their own table, because they are
 * scheduled independently: recognising a word and producing it are two
 * different skills, and forcing them onto one schedule gets both wrong.
 *
 * `fields` is jsonb, and Postgres will accept any shape at all in it. What
 * makes a `vocab` note actually have a term and a translation is the schema in
 * packages/shared, applied in the repository layer before every write. That
 * guarantee holds only because nothing else writes to this table, which is the
 * reason the repository layer is the only way in.
 */
export const notes = pgTable(
  'notes',
  {
    id: id(),
    ...owned(),
    deckId: uuid('deck_id')
      .notNull()
      .references(() => decks.id, { onDelete: 'cascade' }),
    noteTypeId: uuid('note_type_id')
      .notNull()
      .references(() => noteTypes.id, { onDelete: 'restrict' }),
    fields: jsonb('fields').$type<NoteFields>().notNull(),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Where the note came from, such as "Oxford 5000". */
    source: text('source'),
    /**
     * Position in a frequency list, when the source had one.
     *
     * New cards are introduced in this order, so an unfinished import of five
     * thousand words still teaches the most useful eight hundred rather than a
     * random eight hundred.
     */
    rank: integer('rank'),
    status: text('status').notNull().default('active'),
    importBatchId: uuid('import_batch_id').references(() => importBatches.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    index('notes_user_deck_idx')
      .on(table.userId, table.deckId)
      .where(sql`${table.deletedAt} is null`),
    index('notes_user_rank_idx')
      .on(table.userId, table.rank)
      .where(sql`${table.deletedAt} is null`),
    index('notes_tags_idx').using('gin', table.tags),
    index('notes_user_rev_idx').on(table.userId, table.rev),
    index('notes_import_batch_idx').on(table.importBatchId),
    check('notes_status_known', sql`${table.status} in (${literalList(NOTE_STATUSES)})`),
    check('notes_rank_not_negative', sql`${table.rank} is null or ${table.rank} >= 0`),
    check('notes_rev_not_negative', sql`${table.rev} >= 0`),
  ],
);

import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import type { DeckSettings } from '@neuron/shared';

import { id, withoutNulls } from './columns.js';
import { owned } from './owned.js';

import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * A deck and a folder are the same thing.
 *
 * A deck holding other decks is what a person calls a folder. Studying one
 * means studying everything underneath it, at any depth. Keeping them as one
 * entity is what makes "German / Textbook / Lesson 3" work without deciding in
 * advance which levels are allowed to hold cards.
 */

/** How deep the tree may go. Eight is far past anything anyone organises. */
const MAX_DEPTH = 8;

export const decks = pgTable(
  'decks',
  {
    id: id(),
    ...owned(),
    parentId: uuid('parent_id').references((): AnyPgColumn => decks.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Order among siblings. Rewritten for the whole level on a reorder. */
    position: integer('position').notNull().default(0),
    /**
     * Every ancestor, root first, this deck not included.
     *
     * Denormalised so that "everything under this folder" is one indexed query
     * instead of a recursive walk. It is maintained in the repository layer,
     * which rewrites the whole subtree inside the transaction that moves a
     * deck.
     */
    path: uuid('path')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    /** Null means inherit from the parent, and from the user at the root. */
    settings: jsonb('settings').$type<DeckSettings>(),
  },
  (table) => [
    /**
     * Two siblings cannot share a name, comparing without regard to case.
     *
     * The parent is folded through `withoutNulls` so that the rule holds at the
     * root as well, where the parent is null and Postgres would otherwise
     * consider every root deck distinct from every other.
     */
    uniqueIndex('decks_sibling_name_key')
      .on(table.userId, withoutNulls(table.parentId, 'uuid'), sql`lower(${table.name})`)
      .where(sql`${table.deletedAt} is null`),
    index('decks_user_parent_idx').on(table.userId, table.parentId, table.position),
    index('decks_path_idx').using('gin', table.path),
    index('decks_user_rev_idx').on(table.userId, table.rev),
    check('decks_not_own_ancestor', sql`not (${table.id} = any(${table.path}))`),
    check(
      'decks_depth_limit',
      sql`coalesce(array_length(${table.path}, 1), 0) <= ${sql.raw(String(MAX_DEPTH))}`,
    ),
    check('decks_name_not_blank', sql`length(btrim(${table.name})) > 0`),
    check('decks_rev_not_negative', sql`${table.rev} >= 0`),
  ],
);

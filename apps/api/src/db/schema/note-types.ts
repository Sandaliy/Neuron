import { sql } from 'drizzle-orm';
import { boolean, check, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import type { CardTemplate, NoteFieldDefinition } from '@neuron/shared';

import { user } from './auth.js';
import { id, instant, withoutNulls } from './columns.js';

/**
 * What fields a note has, and which cards it produces.
 *
 * The three built in types are rows with no owner, shared by everybody. That is
 * the one exception to every row carrying a user id, and it is deliberate:
 * `vocab` is the same thing for every account, and copying it per user would
 * mean a schema change to fix a typo in it.
 *
 * The isolation policy on this table is therefore not the usual one. Anyone may
 * read a row with no owner. Only the owner may write one. The effect is that
 * the built in types are visible and untouchable, and a custom type, when the
 * editor for those eventually exists, behaves like any other user row.
 *
 * The shapes stored in `fieldSchema` and `cardTemplates` are generated from the
 * definitions in packages/shared rather than typed out again here, so the
 * database and the validation cannot drift apart.
 */
export const noteTypes = pgTable(
  'note_types',
  {
    id: id(),
    /** Null for a built in type. Set for one a user made. */
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    fieldSchema: jsonb('field_schema').$type<readonly NoteFieldDefinition[]>().notNull(),
    cardTemplates: jsonb('card_templates').$type<readonly CardTemplate[]>().notNull(),
    createdAt: instant('created_at').notNull().defaultNow(),
    updatedAt: instant('updated_at').notNull().defaultNow(),
    deletedAt: instant('deleted_at'),
  },
  (table) => [
    uniqueIndex('note_types_owner_name_key')
      .on(withoutNulls(table.userId, 'text'), table.name)
      .where(sql`${table.deletedAt} is null`),
    /** A built in type has no owner, and an owned type is not built in. */
    check(
      'note_types_system_has_no_owner',
      sql`(${table.isSystem} and ${table.userId} is null) or (not ${table.isSystem} and ${table.userId} is not null)`,
    ),
  ],
);

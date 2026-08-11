import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { user } from './auth.js';
import { id, instant, literalList } from './columns.js';

/**
 * What a merge threw away.
 *
 * Two devices editing the same note while neither can reach the network is a
 * normal thing to do, and one of the two edits has to lose. Last write wins is
 * the rule, but a rule that quietly destroys the losing version is a rule that
 * eventually destroys the version someone cared about. So the loser is written
 * here, whole, and can be read back.
 *
 * Nothing reads this table yet. The screen that offers "this is what the other
 * device had" belongs with the interface, in a later phase. The rows have to
 * start being written now, because a conflict that was not recorded at the time
 * cannot be recovered afterwards.
 */

/** Why a version lost. */
export const CONFLICT_REASONS = ['older_update', 'deleted_remotely'] as const;

export const syncConflicts = pgTable(
  'sync_conflicts',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Which table the row belongs to, as the sync protocol names it. */
    entity: text('entity').notNull(),
    /** The row that was being written. */
    entityId: uuid('entity_id').notNull(),
    reason: text('reason').notNull(),
    /** The version that lost, exactly as the client sent it. */
    losing: jsonb('losing').notNull(),
    /** What the server kept, for comparison. */
    kept: jsonb('kept'),
    createdAt: instant('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('sync_conflicts_user_created_idx').on(table.userId, table.createdAt),
    index('sync_conflicts_entity_idx').on(table.userId, table.entity, table.entityId),
    check(
      'sync_conflicts_reason_known',
      sql`${table.reason} in (${literalList(CONFLICT_REASONS)})`,
    ),
  ],
);

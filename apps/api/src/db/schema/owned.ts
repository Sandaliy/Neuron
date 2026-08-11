import { bigint, text } from 'drizzle-orm/pg-core';

import { user } from './auth.js';
import { instant } from './columns.js';

/**
 * The four columns every row a user owns has to carry.
 *
 * A function rather than a shared object because each call has to produce its
 * own column builders. Handing the same builder to two tables makes them share
 * state, which fails later and confusingly.
 *
 * `deletedAt` is what makes a delete recoverable: rows are marked, never
 * removed, and a cleanup job takes them away thirty days later. `rev` is the
 * user's version counter at the moment of the write, which is what lets a
 * client ask for exactly what changed since it last synced.
 *
 * @returns the columns, ready to spread into a table definition
 */
export function owned() {
  return {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: instant('created_at').notNull().defaultNow(),
    updatedAt: instant('updated_at').notNull().defaultNow(),
    deletedAt: instant('deleted_at'),
    rev: bigint('rev', { mode: 'number' }).notNull().default(0),
  };
}

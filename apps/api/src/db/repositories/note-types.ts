import { and, eq, isNull, or, sql } from 'drizzle-orm';

import { noteTypes } from '../schema/index.js';

import type { Runner } from './session.js';

/**
 * Note types, which are mostly not the user's.
 *
 * The three built in types have no owner and are shared by every account. The
 * isolation policy on the table lets anyone read a row with no owner and lets
 * only the owner of a row write one, so they are visible and untouchable.
 *
 * The rest of the api works in type names, because `vocab` is what a client
 * means and a uuid is not. This is what turns one into the other.
 */

export type NoteTypeRow = typeof noteTypes.$inferSelect;

export interface NoteTypeRepository {
  /** Every type this user can use: the built in ones and their own. */
  all: () => Promise<NoteTypeRow[]>;
  /** The type names by id, for turning rows into what the wire carries. */
  namesById: () => Promise<Map<string, string>>;
}

export function noteTypeRepository(userId: string, run: Runner): NoteTypeRepository {
  async function readable() {
    return run(async (tx) =>
      tx
        .select()
        .from(noteTypes)
        .where(
          and(
            isNull(noteTypes.deletedAt),
            or(isNull(noteTypes.userId), eq(noteTypes.userId, userId)),
          ),
        )
        .orderBy(sql`${noteTypes.isSystem} desc`, noteTypes.name),
    );
  }

  return {
    all: readable,

    async namesById() {
      return new Map((await readable()).map((row) => [row.id, row.name]));
    },
  };
}

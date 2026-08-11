import { sql } from 'drizzle-orm';
import { timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Column shapes that repeat across the schema.
 *
 * This file deliberately imports nothing from the tables, so that every table
 * can use it without arranging a cycle. The one helper that needs to point at
 * the user table lives in owned.ts.
 */

/**
 * A moment in time, with its offset.
 *
 * Always `timestamptz`, never `timestamp`. A column without an offset silently
 * reinterprets every value as local time, and the day boundary logic in
 * packages/core is built on knowing exactly which instant it was handed.
 *
 * @param name the column name
 * @returns the column builder
 */
export function instant(name: string) {
  return timestamp(name, { withTimezone: true });
}

/**
 * A primary key the client generates.
 *
 * No database default on purpose. A row created with no network has to carry
 * the id it was born with, so a write arriving without one is a bug worth
 * failing on rather than papering over with a server side value.
 *
 * @returns the column builder
 */
export function id() {
  return uuid('id').primaryKey();
}

/**
 * Stands in for a null in a unique index.
 *
 * Postgres treats every null as different from every other one, so a unique
 * index over a nullable column does not stop two rows that are both null there.
 * At the root of the deck tree that would mean ten folders all called German.
 * `nulls not distinct` fixes it but cannot be combined with the partial index
 * that excludes soft deleted rows, so the null is folded to a value instead.
 */
export const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * A nullable column with its nulls folded together, for a unique index.
 *
 * @param column the nullable column
 * @param empty what a null counts as
 * @returns the expression to index on
 */
export function withoutNulls(column: unknown, empty: 'uuid' | 'text') {
  const stand = empty === 'uuid' ? sql.raw(`'${NIL_UUID}'::uuid`) : sql.raw("''");

  return sql`coalesce(${column}, ${stand})`;
}

/**
 * A list of string literals for a check constraint.
 *
 * Written straight into the migration rather than passed as parameters,
 * because a check constraint is part of a table definition and cannot carry
 * bound values. The inputs are constants from packages/shared, never anything a
 * user typed. The guard is what keeps that true if someone later passes
 * something else.
 *
 * @param values the allowed values
 * @returns a fragment such as `'en', 'ru'`
 */
export function literalList(values: readonly string[]) {
  for (const value of values) {
    if (!/^[a-z][a-z0-9_]*$/.test(value)) {
      throw new Error(`refusing to inline "${value}" into a check constraint`);
    }
  }

  return sql.raw(values.map((value) => `'${value}'`).join(', '));
}

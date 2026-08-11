import { sql } from 'drizzle-orm';

import { user } from '../schema/index.js';

import type { Database } from '../client.js';

/**
 * How a repository reaches the database, and how the database learns who is
 * asking.
 *
 * Every statement runs inside a transaction that begins by naming the user.
 * The isolation policies compare `user_id` against that name, so a query that
 * escaped this file would run with nothing set and read an empty database. The
 * failure mode is emptiness rather than someone else's data, which is the right
 * way round.
 */

/**
 * One transaction, already told who the user is.
 *
 * Read off the client rather than spelled out, because the exact shape depends
 * on the driver and on the schema, and a hand written version of it drifts the
 * first time either changes.
 */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Runs a unit of work inside such a transaction. */
export type Runner = <T>(work: (tx: Tx) => Promise<T>) => Promise<T>;

/**
 * Names the user for the rest of the transaction.
 *
 * `set_config` with a bound parameter, not string interpolation into
 * `SET LOCAL`, which takes no parameters and would put a value from outside
 * straight into a statement.
 *
 * The third argument is what makes it local: the setting is dropped when the
 * transaction ends, so a pooled connection cannot carry one user's identity
 * into the next request.
 *
 * @param tx the transaction
 * @param userId whose data the transaction may touch
 */
export async function nameUser(tx: Tx, userId: string): Promise<void> {
  await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
}

/**
 * Takes the next version number for a user and returns it.
 *
 * The update takes a row lock, so two devices writing at the same moment queue
 * up rather than both reading the same number. Sync depends on the sequence
 * having no gaps and no repeats.
 *
 * @param tx the transaction
 * @param userId whose counter to advance
 * @returns the new version number, to stamp on the rows this transaction writes
 */
export async function nextRev(tx: Tx, userId: string): Promise<number> {
  const rows = await tx.execute<{ current_rev: string | number }>(
    sql`update ${user} set current_rev = current_rev + 1, updated_at = now()
        where ${user.id} = ${userId}
        returning current_rev`,
  );

  const value = rows.rows[0]?.current_rev;

  if (value === undefined) {
    throw new Error(`no user row for ${userId}, so no version could be taken`);
  }

  // bigint arrives as a string from the driver when it is wide enough to need
  // one. Numbers stay exact well past any revision count a person can produce.
  return typeof value === 'number' ? value : Number(value);
}

/**
 * Builds a runner that opens a fresh transaction for each unit of work.
 *
 * @param db the client
 * @param userId whose data the work may touch
 * @returns the runner
 */
export function transactionRunner(db: Database, userId: string): Runner {
  return async (work) =>
    db.transaction(async (tx) => {
      await nameUser(tx, userId);

      return work(tx);
    });
}

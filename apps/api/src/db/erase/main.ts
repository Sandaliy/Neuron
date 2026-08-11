import process from 'node:process';

import { describeConnection, requireUrl, withPool } from '../tooling.js';

import type { Pool } from '@neondatabase/serverless';

/**
 * The cleanup that actually removes things.
 *
 * Nothing in the request path deletes a row. Asking to delete an account
 * anonymises the person, drops their credentials and sessions, marks the row
 * and soft deletes their collection. This runs later, as the database owner,
 * and is the only place in the project where a review is removed.
 *
 * Splitting it this way is the point. The review log is append only, and the
 * trigger that enforces it now checks two things: the erasing flag, and that
 * the deleting role owns the table. The application role fails the second test
 * whatever it sets, so no route, no handler and no injected statement can reach
 * a review. This script passes it because it holds the owner credential, which
 * the deployed server never receives.
 *
 * Run it by hand, or on a schedule once there is somewhere to schedule it.
 */

/** How long a deleted account is recoverable by hand before it goes. */
const GRACE_DAYS = 30;

interface Erasure {
  readonly id: string;
  readonly requestedAt: Date;
}

/**
 * Accounts whose grace period has run out.
 *
 * @param pool the owner connection
 * @param graceDays how long an account waits before it is removed
 * @returns the accounts to erase, oldest request first
 */
async function accountsPastGrace(pool: Pool, graceDays: number): Promise<Erasure[]> {
  const result = await pool.query<{ id: string; deletion_requested_at: Date }>(
    `select id, deletion_requested_at
     from "user"
     where deletion_requested_at is not null
       and deletion_requested_at < now() - make_interval(days => $1)
     order by deletion_requested_at`,
    [graceDays],
  );

  return result.rows.map((row) => ({ id: row.id, requestedAt: row.deletion_requested_at }));
}

/**
 * Removes one account and everything that hangs off it.
 *
 * One transaction, with the flag set locally so it cannot leak onto the next
 * statement over a pooled connection. Every table reaches the user row through
 * a cascading foreign key, so the single delete takes the decks, the notes, the
 * cards, the presets, the imports, the conflict log and the reviews with it.
 *
 * @param pool the owner connection
 * @param userId whose account to erase
 * @returns how many reviews went with it, for the log
 */
async function erase(pool: Pool, userId: string): Promise<number> {
  const connection = await pool.connect();

  try {
    await connection.query('begin');
    await connection.query("select set_config('app.erasing_account', 'on', true)");

    const counted = await connection.query<{ n: number }>(
      'select count(*)::int as n from reviews where user_id = $1',
      [userId],
    );

    await connection.query('delete from "user" where id = $1', [userId]);
    await connection.query('commit');

    return counted.rows[0]?.n ?? 0;
  } catch (error) {
    await connection.query('rollback');

    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Drops rate limiter rows that have stopped meaning anything.
 *
 * The limiter itself never deletes: a row it is about to reset is cheaper to
 * overwrite than to remove and insert again. That leaves rows behind for keys
 * nobody has used since, which is what this clears.
 *
 * @param pool the owner connection
 * @returns how many rows went
 */
async function sweepRateLimits(pool: Pool): Promise<number> {
  const result = await pool.query(
    'delete from rate_limits where expires_at < now() and (blocked_until is null or blocked_until < now())',
  );

  return result.rowCount ?? 0;
}

async function main(): Promise<void> {
  const ownerUrl = requireUrl(
    'DATABASE_URL_OWNER',
    'Erasing an account is the one thing the application role cannot do, so this needs the owner.',
  );

  console.log(`erasing on ${describeConnection(ownerUrl)}`);

  await withPool(ownerUrl, async (pool) => {
    const pending = await accountsPastGrace(pool, GRACE_DAYS);

    if (pending.length === 0) {
      console.log(`no account has been waiting more than ${GRACE_DAYS} days`);
    }

    for (const account of pending) {
      const reviews = await erase(pool, account.id);

      console.log(
        `erased ${account.id}, requested ${account.requestedAt.toISOString()}, ${reviews} reviews removed`,
      );
    }

    console.log(`swept ${await sweepRateLimits(pool)} expired rate limit rows`);
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});

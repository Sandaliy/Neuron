import { createHash } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';

import { registrationCounts } from '../db/schema/index.js';

import type { AuthDatabase } from '../db/client.js';

/**
 * A ceiling on how many accounts one address may create in a day.
 *
 * Separate from the rate limiter, and for a different attack. The rate limiter
 * counts attempts, which stops a script working through a password list. It
 * does nothing about somebody registering three hundred accounts patiently, one
 * every few minutes, every attempt succeeding. Nothing here is under attack
 * today; the point is that open registration without either check is a decision
 * nobody made on purpose.
 *
 * Both this and the open registration switch exist only until email
 * verification is turned on, which is the real answer. Written down as such in
 * the known limitations section of docs/architecture.md.
 */

/**
 * The stored key for one address.
 *
 * Hashed, like the rate limiter's keys. The table then says how many accounts
 * came from somewhere and nothing about where, so a copy of it is not a list of
 * who signed up from which network.
 *
 * Exported so a test can ask about one address's row rather than about every
 * row in a table the whole suite shares.
 *
 * @param address the caller's address
 * @returns the key to store
 */
export function addressKey(address: string): string {
  return createHash('sha256').update(`registration ${address}`).digest('hex');
}

/**
 * Which day a moment falls in, in UTC.
 *
 * UTC rather than the person's timezone, because there is no person yet: this
 * runs before an account exists, and the only thing being counted is a rate.
 *
 * @param now the moment
 * @returns the day, as `2026-08-12`
 */
function dayOf(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Whether this address may create another account today.
 *
 * Asked before the account is made. The count only goes up once one actually
 * has been, so a run of failed attempts costs nothing here, and the person who
 * mistyped their password twice is not turned away.
 *
 * @param db the authentication connection
 * @param address the caller's address
 * @param limit how many are allowed in a day
 * @param now the moment of the request
 * @returns true when there is room
 */
export async function registrationAllowed(
  db: AuthDatabase,
  address: string,
  limit: number,
  now: Date,
): Promise<boolean> {
  const rows = await db
    .select({ count: registrationCounts.count })
    .from(registrationCounts)
    .where(
      and(
        eq(registrationCounts.addressHash, addressKey(address)),
        eq(registrationCounts.day, dayOf(now)),
      ),
    );

  return (rows[0]?.count ?? 0) < limit;
}

/**
 * Records that an account was actually created from this address.
 *
 * One statement, so two registrations arriving together cannot both read the
 * same count and both write it back plus one.
 *
 * @param db the authentication connection
 * @param address the caller's address
 * @param now the moment of the request
 */
export async function recordRegistration(
  db: AuthDatabase,
  address: string,
  now: Date,
): Promise<void> {
  await db
    .insert(registrationCounts)
    .values({ addressHash: addressKey(address), day: dayOf(now), count: 1 })
    .onConflictDoUpdate({
      target: [registrationCounts.addressHash, registrationCounts.day],
      set: { count: sql`${registrationCounts.count} + 1` },
    });
}

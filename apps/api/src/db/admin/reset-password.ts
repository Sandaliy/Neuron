import { randomBytes, randomUUID } from 'node:crypto';
import process from 'node:process';

import { resetIdentifier } from '../../auth/reset-tokens.js';
import { requireUrl, withPool } from '../tooling.js';

import type { Pool } from '@neondatabase/serverless';

/**
 * The last way back into an account, when everything else is gone.
 *
 * Somebody who has forgotten their password and lost every recovery code has no
 * route back through the api, and that is on purpose: any route that existed
 * would also be a route for somebody who is not them. What is left is a person
 * with the owner credential, running this from their own machine.
 *
 * Never a route. It takes no password and proves nothing about who is asking,
 * so the only thing standing between it and an account takeover is that running
 * it requires the database owner's connection string, which is not on the
 * server at all.
 *
 * Usage: pnpm admin:reset-password somebody@example.com
 */

/** How long the printed token lasts. Long enough to read it out loud once. */
export const TOKEN_LIFETIME_MINUTES = 30;

/**
 * The token Better Auth's reset endpoint will accept.
 *
 * Its shape is fixed by that endpoint: a row in `verification` whose identifier
 * says this is a reset and whose value is the user id. Writing that row here
 * rather than inventing a second mechanism means the reset itself goes through
 * exactly the code path every other reset goes through, including the password
 * policy and the revoking of sessions.
 *
 * What is stored is the digest, the same as for a reset somebody asked for
 * themselves. The plain token is printed once, here, and never written down.
 *
 * @returns a token with 256 bits behind it
 */
function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Finds the account, writes the token, and closes every session it had.
 *
 * @param pool the owner connection
 * @param email whose account
 * @returns the token to hand over, and where to use it
 */
export async function issueReset(
  pool: Pool,
  email: string,
): Promise<{ token: string; userId: string }> {
  const found = await pool.query<{ id: string; deletion_requested_at: Date | null }>(
    'select id, deletion_requested_at from "user" where lower(email) = lower($1)',
    [email],
  );

  const account = found.rows[0];

  if (!account) {
    throw new Error(`No account uses ${email}.`);
  }

  if (account.deletion_requested_at) {
    throw new Error(
      `${email} asked for their account to be erased on ${account.deletion_requested_at.toISOString()}. Restoring it is a separate decision, so this refuses rather than quietly undoing it.`,
    );
  }

  const token = generateToken();
  const expiresAt = new Date(Date.now() + TOKEN_LIFETIME_MINUTES * 60 * 1000);

  await pool.query(
    `insert into verification (id, identifier, value, expires_at)
     values ($1, $2, $3, $4)`,
    [randomUUID(), resetIdentifier(token), account.id, expiresAt],
  );

  // Everything the account had open. Somebody needing this has lost control of
  // their credentials, and a session opened before that is a session that may
  // not be theirs.
  const closed = await pool.query('delete from "session" where user_id = $1', [account.id]);

  console.log(`Closed ${closed.rowCount ?? 0} session(s) for ${email}.`);

  return { token, userId: account.id };
}

async function main(): Promise<void> {
  const email = process.argv[2];

  if (!email) {
    throw new Error('Usage: pnpm admin:reset-password somebody@example.com');
  }

  const ownerUrl = requireUrl(
    'DATABASE_URL_OWNER',
    'It is the connection string Neon shows under Connect, for the neondb_owner role.',
  );

  const { token, userId } = await withPool(ownerUrl, (pool) => issueReset(pool, email));

  // Logged deliberately, and this is the only place in the project where an
  // address appears in output on purpose. The whole point of this script is
  // that a human being reads what it printed and acts on it, and a record that
  // it happened is worth more than the address being absent from one terminal.
  console.log('');
  console.log(`Password reset issued for ${email} (user ${userId}).`);
  console.log(`Token: ${token}`);
  console.log(`Valid for ${TOKEN_LIFETIME_MINUTES} minutes, and works once.`);
  console.log('');
  console.log('Give it to them over a channel you trust, and have them open:');
  console.log(`  ${'{APP_ORIGIN}'}/reset-password?token=${token}`);
  console.log('');
  console.log('Their old recovery codes still work. Tell them to generate a new set.');
}

// Only when run directly, so importing issueReset from a test does not reset
// somebody's password as a side effect of the import.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/'))) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

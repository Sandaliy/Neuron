import { symmetricDecrypt } from 'better-auth/crypto';
import { and, eq } from 'drizzle-orm';

import { account, twoFactor } from '../db/schema/index.js';

import { verifySecret, wasteVerificationTime } from './hashing.js';
import { claimStep, matchingStep } from './totp-replay.js';

import type { AuthDatabase } from '../db/client.js';

/**
 * Proving an account is this person's, outside a sign in.
 *
 * Two things ask for that proof: turning the second factor off, and deleting
 * the account. Both are reachable from a session that is already open, and a
 * session that is already open is exactly the thing a borrowed unlocked laptop
 * hands to somebody else. Neither is undone by signing in again: one removes
 * the protection, the other removes everything.
 *
 * Everything here runs on the authentication connection, because the password
 * hash and the authenticator secret live on that side of the role split and the
 * application connection cannot read either.
 */

/** The provider id Better Auth files an email and password credential under. */
const CREDENTIAL_PROVIDER = 'credential';

/** The key `symmetricDecrypt` wants, whatever shape this version of it is. */
export type SecretKey = Parameters<typeof symmetricDecrypt>[0]['key'];

/**
 * Whether a password is the one on the account.
 *
 * The hash is compared with the same parameters it was written with, from
 * `hashing.ts`, which is also what Better Auth is configured to use. An account
 * with no credential row spends the same time as a real check and answers
 * false, so the time taken says nothing about how the account was created.
 *
 * @param db the authentication connection
 * @param userId whose password
 * @param password what somebody typed
 * @returns whether they match
 */
export async function passwordMatches(
  db: AuthDatabase,
  userId: string,
  password: string,
): Promise<boolean> {
  const rows = await db
    .select({ password: account.password })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, CREDENTIAL_PROVIDER)));

  const stored = rows[0]?.password;

  if (!stored) {
    return wasteVerificationTime(password);
  }

  return verifySecret(stored, password).catch(() => false);
}

/** What checking an authenticator code came to. */
export type CodeVerdict = 'ok' | 'invalid' | 'reused' | 'unavailable';

/**
 * Checks an authenticator code and spends it.
 *
 * Spent, not merely checked: the step the code came from is claimed, so the
 * same six digits cannot be used twice inside the skew window. That is the same
 * guarantee `/two-factor/verify-totp` gets from the replay guard in
 * `plugin.ts`, and it has to hold here as well or the weaker of the two paths
 * is the one an attacker takes.
 *
 * @param db the authentication connection
 * @param key the key Better Auth encrypted the secret with
 * @param userId whose second factor
 * @param code the six digits somebody typed
 * @param now the moment of the request
 */
export async function spendTotpCode(
  db: AuthDatabase,
  key: SecretKey,
  userId: string,
  code: string,
  now: Date,
): Promise<CodeVerdict> {
  const rows = await db
    .select({ secret: twoFactor.secret })
    .from(twoFactor)
    .where(eq(twoFactor.userId, userId));

  const stored = rows[0]?.secret;

  if (!stored) {
    return 'unavailable';
  }

  const secret = await symmetricDecrypt({ key, data: stored });
  const step = await matchingStep(secret, code, now);

  if (step === undefined) {
    return 'invalid';
  }

  return (await claimStep(db, userId, step)) ? 'ok' : 'reused';
}

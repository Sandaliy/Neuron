import { createHash } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { verification } from '../db/schema/index.js';

import type { AuthDatabase } from '../db/client.js';

/**
 * Keeping the password reset token out of the database in readable form.
 *
 * Better Auth stores it as the identifier of a row in `verification`, in the
 * clear, and looks it up by that identifier. That is a working design and it
 * has one property worth removing: anybody who can read that table can reset
 * any password in it. Everything else that opens an account in this project is
 * hashed, and a reset token opens an account.
 *
 * So the row is rewritten the moment the token is handed to the mailer, and the
 * token on the way back in is hashed before Better Auth looks it up. Nothing in
 * the flow changes; the value at rest is a digest instead of a key.
 *
 * SHA-256, not argon2, and the difference is not an oversight. Argon2 is slow
 * on purpose because a password is short and guessable. This token is thirty
 * two random bytes, so there is nothing to guess and no work factor to buy.
 */

/** The prefix Better Auth builds its identifier with. */
const PREFIX = 'reset-password:';

/** The digest of one token. */
export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The identifier a hashed token is stored and looked up under. */
export function resetIdentifier(token: string): string {
  return `${PREFIX}${hashResetToken(token)}`;
}

/**
 * Replaces the readable row Better Auth just wrote with a hashed one.
 *
 * Called from `sendResetPassword`, which is the one place the plain token
 * exists and the last moment before it leaves the server.
 *
 * @param db the authentication connection
 * @param token the plain token, as it is about to be mailed
 */
export async function storeHashed(db: AuthDatabase, token: string): Promise<void> {
  await db
    .update(verification)
    .set({ identifier: resetIdentifier(token) })
    .where(eq(verification.identifier, `${PREFIX}${token}`));
}

/**
 * Whether a value looks like the identifier of a reset token.
 *
 * @param identifier a row's identifier
 */
export function isResetIdentifier(identifier: string): boolean {
  return identifier.startsWith(PREFIX);
}

/** The token a reset request carried, hashed, ready for Better Auth. */
export function hashIncoming(token: string): string {
  return hashResetToken(token);
}

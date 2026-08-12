import { hash, verify } from '@node-rs/argon2';

/**
 * One set of hashing parameters, used for every secret this project stores.
 *
 * The values OWASP recommends for argon2id: 19 MiB of memory, two passes, one
 * lane. Hashing takes roughly a tenth of a second, which is the point. It is
 * what makes a stolen table useless.
 *
 * Passwords and recovery codes share these, because a recovery code is a
 * credential in exactly the same sense a password is: it opens the account on
 * its own. Storing it any more weakly would mean the strength of the password
 * hash decided nothing.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Hashes a secret for storage.
 *
 * @param secret a password or a recovery code
 * @returns the encoded argon2id hash, salt included
 */
export function hashSecret(secret: string): Promise<string> {
  return hash(secret, ARGON2_OPTIONS);
}

/**
 * Checks a secret against a stored hash.
 *
 * @param stored what came out of the database
 * @param secret what somebody typed
 * @returns whether they match
 */
export function verifySecret(stored: string, secret: string): Promise<boolean> {
  return verify(stored, secret, ARGON2_OPTIONS);
}

/**
 * Spends the same time as a real verification, and answers false.
 *
 * For the case where there is no account at that address. Without this, a
 * request for an unknown address comes back in a millisecond and a request for
 * a known one takes a tenth of a second, which turns the sign in endpoint into
 * a way of asking which addresses have accounts.
 *
 * @param secret whatever was typed, so the work is the same shape
 */
export async function wasteVerificationTime(secret: string): Promise<false> {
  // A hash of a fixed string, computed once, so the comparison below does the
  // same work a real one would.
  DUMMY_HASH ??= await hashSecret('there is no account at this address');

  await verifySecret(DUMMY_HASH, secret).catch(() => false);

  return false;
}

let DUMMY_HASH: string | undefined;

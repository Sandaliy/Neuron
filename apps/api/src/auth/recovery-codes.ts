import { randomBytes, randomUUID } from 'node:crypto';

import { and, eq, isNull, sql } from 'drizzle-orm';

import {
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_LENGTH,
  RECOVERY_CODE_LOW_WATERMARK,
  formatRecoveryCode,
} from '@neuron/shared';

import { recoveryCodes } from '../db/schema/index.js';

import { hashSecret, verifySecret } from './hashing.js';

import type { AuthDatabase } from '../db/client.js';

/**
 * The codes that get somebody back into an account they have lost the password
 * to.
 *
 * Worth being plain about what these are, because the design follows from it.
 * There is no mail sender, so there is no channel to prove somebody owns the
 * address. Recovery therefore has to rest on something they hold, and these are
 * it. A recovery code is not a step towards getting in; it is the way in, and
 * anybody holding one has the account. The screen that issues them says exactly
 * that, in both languages.
 *
 * Everything here runs on the authentication connection. The application role
 * has no grant on this table and no policy naming it, so a route handler cannot
 * read a hash even by accident.
 */

/** What a fresh set looks like on the way to the person who asked for it. */
export interface IssuedRecoveryCodes {
  /** Grouped and hyphenated, ready to be shown. Never stored in this form. */
  readonly codes: string[];
}

/**
 * One code's worth of characters, drawn without bias.
 *
 * `byte % 31` is the obvious version and it is wrong: 256 is not a multiple of
 * 31, so the first nine characters of the alphabet come up slightly more often
 * than the rest. The bias is small and it is also free to remove, and "small
 * enough not to matter" is not a judgement worth making about the only
 * credential standing between somebody and their account.
 *
 * @returns fifteen characters from the alphabet
 */
function generateCode(): string {
  const alphabet = RECOVERY_CODE_ALPHABET;
  // The largest multiple of the alphabet size that fits in a byte. Anything at
  // or above it is thrown away and redrawn, which is what removes the bias.
  const ceiling = Math.floor(256 / alphabet.length) * alphabet.length;

  let code = '';

  while (code.length < RECOVERY_CODE_LENGTH) {
    // A generous batch, so the loop almost never needs a second one.
    for (const byte of randomBytes(RECOVERY_CODE_LENGTH * 2)) {
      if (byte >= ceiling) {
        continue;
      }

      code += alphabet[byte % alphabet.length];

      if (code.length === RECOVERY_CODE_LENGTH) {
        break;
      }
    }
  }

  return code;
}

/**
 * Replaces every code an account has with ten new ones.
 *
 * The old rows go rather than being marked, because a used code and a replaced
 * code are the same thing from here on: neither will ever be accepted again,
 * and keeping them would only make the table grow. What is worth keeping is the
 * fact that a code was spent, and that is a line in the log rather than a row.
 *
 * @param db the authentication connection
 * @param userId whose codes
 * @returns the codes, formatted, exactly once
 */
export async function issueRecoveryCodes(
  db: AuthDatabase,
  userId: string,
): Promise<IssuedRecoveryCodes> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateCode);

  // Hashed in parallel. Argon2 is deliberately slow, and ten of them one after
  // another is most of a second added to registration for no reason.
  const rows = await Promise.all(
    codes.map(async (code) => ({
      id: randomUUID(),
      userId,
      codeHash: await hashSecret(code),
    })),
  );

  await db.transaction(async (transaction) => {
    await transaction.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
    await transaction.insert(recoveryCodes).values(rows);
  });

  return { codes: codes.map(formatRecoveryCode) };
}

/** How many codes an account has left. */
export async function countRecoveryCodes(db: AuthDatabase, userId: string): Promise<number> {
  const result = await db
    .select({ remaining: sql<number>`count(*)::int` })
    .from(recoveryCodes)
    .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)));

  return result[0]?.remaining ?? 0;
}

/** Whether the count is low enough that the interface should say so. */
export function isLow(remaining: number): boolean {
  return remaining < RECOVERY_CODE_LOW_WATERMARK;
}

/** What happened when somebody typed a code in. */
export interface SpendResult {
  readonly spent: boolean;
  /** How many are left afterwards. */
  readonly remaining: number;
}

/**
 * Spends one code, if it is one of this account's unused codes.
 *
 * Argon2 salts every hash separately, so there is no way to look a code up.
 * Every unused code has to be tried, which is up to ten verifications and most
 * of a second. That is acceptable here and nowhere else: this endpoint is
 * behind the strictest rate limit in the system and a person reaches it perhaps
 * twice in their life.
 *
 * The spend is a conditional update rather than a read followed by a write. Two
 * requests arriving with the same code both find the row unused; only one of
 * them changes it, and the other is told the code is not valid. A read then a
 * write would let both through.
 *
 * @param db the authentication connection
 * @param userId whose codes
 * @param code the normalised code, without its hyphens
 * @returns whether it was spent, and what is left
 */
export async function spendRecoveryCode(
  db: AuthDatabase,
  userId: string,
  code: string,
): Promise<SpendResult> {
  const unused = await db
    .select({ id: recoveryCodes.id, codeHash: recoveryCodes.codeHash })
    .from(recoveryCodes)
    .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)));

  for (const candidate of unused) {
    if (!(await verifySecret(candidate.codeHash, code))) {
      continue;
    }

    const claimed = await db
      .update(recoveryCodes)
      .set({ usedAt: new Date() })
      .where(and(eq(recoveryCodes.id, candidate.id), isNull(recoveryCodes.usedAt)))
      .returning({ id: recoveryCodes.id });

    // Nothing came back: another request spent this same code between the read
    // above and the write here. From the outside that is a code that was
    // already used, which is exactly what it is.
    if (claimed.length === 0) {
      break;
    }

    return { spent: true, remaining: await countRecoveryCodes(db, userId) };
  }

  return { spent: false, remaining: unused.length };
}

import { createOTP } from '@better-auth/utils/otp';
import { and, eq, lt } from 'drizzle-orm';

import { twoFactor } from '../db/schema/index.js';

import type { AuthDatabase } from '../db/client.js';

/**
 * Making an authenticator code work exactly once.
 *
 * Better Auth accepts any code inside the skew window, which is the current
 * thirty second step and one on either side. That is correct for clocks and
 * wrong for replay: a code read over somebody's shoulder, or lifted from a
 * request, keeps working for the rest of its window. RFC 6238 says so directly
 * and says to prevent it by remembering the last step that was accepted.
 *
 * So that is what this does. Every accepted code is pinned to the step it came
 * from, and a step at or below the last accepted one is refused. The window
 * still absorbs a clock that is a little out; it no longer absorbs the same
 * code arriving twice.
 */

/** Thirty seconds, the step length every authenticator app assumes. */
export const TOTP_PERIOD_SECONDS = 30;

/** Six digits, likewise. */
export const TOTP_DIGITS = 6;

/**
 * How far out of step a clock may be.
 *
 * One step either way, and no more. Two would double the time a stolen code
 * stays useful in exchange for tolerating a phone whose clock is a minute out,
 * and a phone whose clock is a minute out has a problem worth fixing.
 */
export const TOTP_WINDOW = 1;

/** Which thirty second step a moment falls in. */
export function stepAt(now: Date): number {
  return Math.floor(now.getTime() / 1000 / TOTP_PERIOD_SECONDS);
}

/**
 * Works out which step a submitted code came from.
 *
 * @param secret the shared secret, decrypted
 * @param code the six digits somebody typed
 * @param now the moment of the request
 * @returns the step, or undefined when the code is not one of ours
 */
export async function matchingStep(
  secret: string,
  code: string,
  now: Date,
): Promise<number | undefined> {
  const current = stepAt(now);
  const otp = createOTP(secret, { digits: TOTP_DIGITS, period: TOTP_PERIOD_SECONDS });

  for (let offset = -TOTP_WINDOW; offset <= TOTP_WINDOW; offset += 1) {
    const step = current + offset;

    if (code === (await otp.hotp(step))) {
      return step;
    }
  }

  return undefined;
}

/**
 * Claims a step for an account, if it has not been claimed already.
 *
 * A single conditional update, so two requests carrying the same code cannot
 * both succeed: they both try to move the stored step to the same number, and
 * only the first one finds a row to move.
 *
 * @param db the authentication connection
 * @param userId whose second factor
 * @param step the step the code came from
 * @returns true when the step was ahead of everything already spent
 */
export async function claimStep(db: AuthDatabase, userId: string, step: number): Promise<boolean> {
  const claimed = await db
    .update(twoFactor)
    .set({ lastTotpStep: step })
    .where(and(eq(twoFactor.userId, userId), lt(twoFactor.lastTotpStep, step)))
    .returning({ id: twoFactor.id });

  return claimed.length > 0;
}

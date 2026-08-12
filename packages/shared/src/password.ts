import { z } from 'zod';

/**
 * What counts as an acceptable password, decided in one place.
 *
 * Both ends check this. The client refuses a short password without a round
 * trip, and the server refuses it again because a client is something anybody
 * can replace. Neither copy can drift, because there is only one.
 */

/**
 * Ten characters, and no rules about which ones.
 *
 * Character class rules ("one capital, one digit, one symbol") make people
 * write `Password1!` and then write it on a sticky note. Length is the only
 * requirement that reliably buys anything, so it is the only one here.
 */
export const MINIMUM_PASSWORD_LENGTH = 10;

/**
 * The longest a password may be.
 *
 * Not a security limit. Argon2 hashes whatever it is given, and hashing a
 * megabyte of text is how a login endpoint becomes a way to exhaust the server.
 */
export const MAXIMUM_PASSWORD_LENGTH = 200;

/**
 * The passwords a list attack starts with.
 *
 * Small on purpose. A full breach corpus is tens of millions of entries, which
 * is a service call or a large file shipped to the browser, and the value of
 * the two thousandth entry is close to nothing. What this catches is the
 * password somebody picks in five seconds because the field demanded ten
 * characters: the keyboard walks, the repeated words, the site name.
 *
 * Phase 11 replaces this with a check against a breach corpus, which is worth
 * doing once there is a mail sender to warn people with.
 */
const WEAK_PASSWORDS: readonly string[] = [
  'password',
  'password1',
  'password12',
  'password123',
  'password1234',
  'passw0rd123',
  '1234567890',
  '12345678901',
  '123456789012',
  '0123456789',
  'qwertyuiop',
  'qwerty12345',
  'qwertyuiop1',
  'asdfghjkl1',
  '1q2w3e4r5t',
  'qazwsxedc1',
  'zaqwsxcde3',
  'iloveyou12',
  'letmein123',
  'welcome123',
  'admin12345',
  'administrator',
  'trustno1234',
  'monkey1234',
  'dragon1234',
  'football12',
  'baseball12',
  'superman12',
  'sunshine12',
  'princess12',
  'starwars12',
  'whatever12',
  'changeme12',
  'secret1234',
  'abc12345678',
  'aaaaaaaaaa',
  'neuron1234',
  'neuronapp1',
  'spacedrepetition',
  'йцукенгшщз',
  'пароль1234',
  'привет1234',
];

/** The weak list as a set, lowercased, built once. */
const WEAK = new Set(WEAK_PASSWORDS);

/**
 * Why a password was refused.
 *
 * A code rather than a sentence, because the sentence has to exist in English
 * and in Russian and the server has no business choosing which.
 */
export const PASSWORD_PROBLEMS = ['too_short', 'too_long', 'too_common'] as const;

export type PasswordProblem = (typeof PASSWORD_PROBLEMS)[number];

/**
 * Judges one password.
 *
 * @param password what the person typed, exactly as they typed it
 * @returns the problem with it, or undefined when there is none
 */
export function passwordProblem(password: string): PasswordProblem | undefined {
  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    return 'too_short';
  }

  if (password.length > MAXIMUM_PASSWORD_LENGTH) {
    return 'too_long';
  }

  // Lowercased before the comparison, so `Password123` is caught by the same
  // entry as `password123`. Capitalising the first letter is the most common
  // way of meeting a rule without changing the guess an attacker makes.
  if (WEAK.has(password.toLowerCase())) {
    return 'too_common';
  }

  return undefined;
}

/** Whether a password is acceptable. */
export function isAcceptablePassword(password: string): boolean {
  return passwordProblem(password) === undefined;
}

/**
 * The password field, for any schema that takes one being chosen.
 *
 * Not for the sign in field: an existing password chosen before this rule
 * existed still has to be typeable, and refusing it at the door would lock
 * somebody out of their own account over a policy change.
 */
export const newPasswordSchema = z
  .string()
  .min(MINIMUM_PASSWORD_LENGTH)
  .max(MAXIMUM_PASSWORD_LENGTH)
  .refine(isAcceptablePassword, 'is one of the passwords attacked first');

/** The password field for signing in. Any non empty string. */
export const passwordSchema = z.string().min(1).max(MAXIMUM_PASSWORD_LENGTH);

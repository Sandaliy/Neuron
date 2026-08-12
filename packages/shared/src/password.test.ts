import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_PASSWORD_LENGTH,
  MINIMUM_PASSWORD_LENGTH,
  isAcceptablePassword,
  newPasswordSchema,
  passwordProblem,
} from './password.js';

describe('the password policy', () => {
  it('refuses anything under ten characters', () => {
    expect(passwordProblem('123456789')).toBe('too_short');
    expect(passwordProblem('short')).toBe('too_short');
    expect(passwordProblem('')).toBe('too_short');
  });

  it('accepts exactly ten characters, when they are not on the list', () => {
    expect(passwordProblem('correct ho')).toBeUndefined();
    expect('correct ho'.length).toBe(MINIMUM_PASSWORD_LENGTH);
  });

  it('refuses a password long enough to make hashing the attack', () => {
    expect(passwordProblem('a'.repeat(MAXIMUM_PASSWORD_LENGTH + 1))).toBe('too_long');
    expect(passwordProblem('a'.repeat(MAXIMUM_PASSWORD_LENGTH))).not.toBe('too_long');
  });

  it('refuses the passwords a list attack starts with', () => {
    expect(passwordProblem('password123')).toBe('too_common');
    expect(passwordProblem('qwertyuiop')).toBe('too_common');
    expect(passwordProblem('1234567890')).toBe('too_common');
    expect(passwordProblem('пароль1234')).toBe('too_common');
  });

  it('sees through capitalising the first letter', () => {
    // The most common way of meeting a rule without changing the guess.
    expect(passwordProblem('Password123')).toBe('too_common');
    expect(passwordProblem('QwertyUIOP')).toBe('too_common');
  });

  it('imposes no character class rules', () => {
    // Fifteen lowercase letters and no digits, and that is fine. Demanding a
    // symbol is what produces Password1! and a sticky note.
    expect(isAcceptablePassword('correcthorsebattery')).toBe(true);
  });

  it('checks length before commonness, so a short weak password says short', () => {
    // 'password' is on the list and is also eight characters. Length is the
    // thing the person can act on first.
    expect(passwordProblem('password')).toBe('too_short');
  });

  describe('the schema built on it', () => {
    it('accepts an acceptable password', () => {
      expect(newPasswordSchema.safeParse('correcthorsebattery').success).toBe(true);
    });

    it('refuses a short one and a common one alike', () => {
      expect(newPasswordSchema.safeParse('short').success).toBe(false);
      expect(newPasswordSchema.safeParse('password123').success).toBe(false);
    });
  });
});

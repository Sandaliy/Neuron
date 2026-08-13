import { describe, expect, it } from 'vitest';

import {
  MINIMUM_PASSWORD_LENGTH,
  isAcceptablePassword,
  passwordProblem,
  passwordStrength,
} from './password.js';

describe('judging a password', () => {
  it('refuses anything under the floor', () => {
    expect(passwordProblem('a'.repeat(MINIMUM_PASSWORD_LENGTH - 1))).toBe('too_short');
  });

  it('accepts the floor exactly', () => {
    expect(passwordProblem('correcthorse')).toBeUndefined();
  });

  it('refuses one of the passwords attacked first, however it is capitalised', () => {
    expect(passwordProblem('Password123')).toBe('too_common');
  });

  it('asks for no capital, no digit and no symbol', () => {
    expect(isAcceptablePassword('the slow green kettle')).toBe(true);
  });
});

describe('how strong a password is', () => {
  it('says short below the floor, which is the only blocking answer', () => {
    expect(passwordStrength('short')).toBe('short');
  });

  it('says fair just past the floor', () => {
    expect(passwordStrength('a'.repeat(MINIMUM_PASSWORD_LENGTH))).toBe('fair');
  });

  it('says good at fourteen', () => {
    expect(passwordStrength('a'.repeat(14))).toBe('good');
  });

  it('says strong at twenty, where the advice stops', () => {
    expect(passwordStrength('a'.repeat(20))).toBe('strong');
  });

  it('never blocks anything that is already acceptable', () => {
    for (const password of ['ten charact', 'a'.repeat(14), 'a'.repeat(40)]) {
      expect(isAcceptablePassword(password)).toBe(true);
      expect(passwordStrength(password)).not.toBe('short');
    }
  });
});

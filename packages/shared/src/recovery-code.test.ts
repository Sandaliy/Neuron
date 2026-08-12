import { describe, expect, it } from 'vitest';

import {
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_LENGTH,
  formatRecoveryCode,
  looksLikeRecoveryCode,
  normaliseRecoveryCode,
} from './recovery-code.js';

describe('the recovery code format', () => {
  it('leaves out every character people confuse', () => {
    for (const confusable of ['0', 'O', '1', 'I', 'L']) {
      expect(RECOVERY_CODE_ALPHABET).not.toContain(confusable);
    }
  });

  it('carries more than the sixty four bits of entropy asked for', () => {
    const bits = RECOVERY_CODE_LENGTH * Math.log2(RECOVERY_CODE_ALPHABET.length);

    expect(bits).toBeGreaterThan(64);
  });

  it('shows a code in groups', () => {
    expect(formatRecoveryCode('A2B3CD4E5FG6H7J')).toBe('A2B3C-D4E5F-G6H7J');
  });

  describe('reading back what somebody typed', () => {
    const code = 'A2B3CD4E5FG6H7J';

    it('accepts it exactly as it was shown', () => {
      expect(normaliseRecoveryCode('A2B3C-D4E5F-G6H7J')).toBe(code);
    });

    it('accepts it lowercased, the way a phone keyboard produces it', () => {
      expect(normaliseRecoveryCode('a2b3c-d4e5f-g6h7j')).toBe(code);
    });

    it('accepts spaces where the hyphens were', () => {
      expect(normaliseRecoveryCode('A2B3C D4E5F G6H7J')).toBe(code);
    });

    it('accepts it with no separators at all', () => {
      expect(normaliseRecoveryCode('A2B3CD4E5FG6H7J')).toBe(code);
    });

    it('drops a character that could never have been in a code', () => {
      // A typed zero was a mistake: there is no zero in the alphabet, so there
      // is nothing to correct it to.
      expect(normaliseRecoveryCode('A2B3C-D4E5F-G6H7J0')).toBe(code);
    });
  });

  it('knows a full length code from a half typed one', () => {
    expect(looksLikeRecoveryCode('A2B3CD4E5FG6H7J')).toBe(true);
    expect(looksLikeRecoveryCode('A2B3CD4E5')).toBe(false);
  });
});

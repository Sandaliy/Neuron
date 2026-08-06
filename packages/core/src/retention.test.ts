import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TARGET_RETENTION,
  MAX_TARGET_RETENTION,
  MIN_TARGET_RETENTION,
  decayConstantToRetention,
  retentionToDecayConstant,
} from './retention.js';

describe('retentionToDecayConstant', () => {
  it('returns -ln(target) for the default target', () => {
    expect(retentionToDecayConstant(DEFAULT_TARGET_RETENTION)).toBeCloseTo(0.1053605, 7);
  });

  it('accepts the lower bound', () => {
    expect(retentionToDecayConstant(MIN_TARGET_RETENTION)).toBeCloseTo(0.2231436, 7);
  });

  it('accepts the upper bound', () => {
    expect(retentionToDecayConstant(MAX_TARGET_RETENTION)).toBeCloseTo(0.0304592, 7);
  });

  it('falls as the target rises', () => {
    const constants = [0.8, 0.85, 0.9, 0.95, 0.97].map(retentionToDecayConstant);
    const highestFirst = [...constants].sort((a, b) => b - a);

    expect(constants).toEqual(highestFirst);
  });

  it('stays above zero across the whole range', () => {
    for (let percent = 80; percent <= 97; percent += 1) {
      expect(retentionToDecayConstant(percent / 100)).toBeGreaterThan(0);
    }
  });

  it('rejects a target below the lower bound', () => {
    expect(() => retentionToDecayConstant(0.79)).toThrow(RangeError);
  });

  it('rejects a target above the upper bound', () => {
    expect(() => retentionToDecayConstant(0.98)).toThrow(RangeError);
  });

  it('rejects the degenerate targets 0 and 1', () => {
    expect(() => retentionToDecayConstant(0)).toThrow(RangeError);
    expect(() => retentionToDecayConstant(1)).toThrow(RangeError);
  });

  it('rejects values that are not finite numbers', () => {
    expect(() => retentionToDecayConstant(Number.NaN)).toThrow(RangeError);
    expect(() => retentionToDecayConstant(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('decayConstantToRetention', () => {
  it('returns the retention the constant came from', () => {
    for (const target of [MIN_TARGET_RETENTION, DEFAULT_TARGET_RETENTION, MAX_TARGET_RETENTION]) {
      expect(decayConstantToRetention(retentionToDecayConstant(target))).toBeCloseTo(target, 12);
    }
  });

  it('rejects a constant of zero or below', () => {
    expect(() => decayConstantToRetention(0)).toThrow(RangeError);
    expect(() => decayConstantToRetention(-0.5)).toThrow(RangeError);
  });

  it('rejects values that are not finite numbers', () => {
    expect(() => decayConstantToRetention(Number.NaN)).toThrow(RangeError);
    expect(() => decayConstantToRetention(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

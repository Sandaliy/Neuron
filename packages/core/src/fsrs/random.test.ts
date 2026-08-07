import { describe, expect, it } from 'vitest';

import { createSeededRandom } from './random.js';

describe('createSeededRandom', () => {
  it('gives the same sequence for the same seed', () => {
    const first = createSeededRandom(42);
    const second = createSeededRandom(42);

    for (let index = 0; index < 100; index += 1) {
      expect(first()).toBe(second());
    }
  });

  it('gives a different sequence for a different seed', () => {
    const first = createSeededRandom(1);
    const second = createSeededRandom(2);
    const differences = Array.from({ length: 50 }, () => first() !== second()).filter(Boolean);

    expect(differences).toHaveLength(50);
  });

  it('stays inside [0, 1)', () => {
    const random = createSeededRandom(7);

    for (let index = 0; index < 10_000; index += 1) {
      const value = random();

      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('spreads values across the range', () => {
    const random = createSeededRandom(99);
    const buckets = [0, 0, 0, 0];

    for (let index = 0; index < 40_000; index += 1) {
      const bucket = Math.min(Math.floor(random() * 4), 3);

      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }

    for (const count of buckets) {
      expect(count).toBeGreaterThan(9000);
      expect(count).toBeLessThan(11_000);
    }
  });

  it('truncates a fractional seed rather than failing', () => {
    expect(createSeededRandom(3.9)()).toBe(createSeededRandom(3)());
  });
});

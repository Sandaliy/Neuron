import { describe, expect, it } from 'vitest';

import { RATINGS, ratingSchema } from './rating.js';

describe('ratingSchema', () => {
  it('accepts every rating', () => {
    for (const rating of RATINGS) {
      expect(ratingSchema.parse(rating)).toBe(rating);
    }
  });

  it('rejects a word that is not a rating', () => {
    expect(ratingSchema.safeParse('maybe').success).toBe(false);
  });

  it('rejects a number', () => {
    expect(ratingSchema.safeParse(3).success).toBe(false);
  });
});

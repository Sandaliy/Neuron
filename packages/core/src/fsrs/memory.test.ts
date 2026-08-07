import { describe, expect, it } from 'vitest';

import {
  forgetStability,
  forgettingCurve,
  initialDifficulty,
  initialStability,
  intervalFromStability,
  intervalModifier,
  nextDifficulty,
  postLapseFloor,
  recallStability,
  shortTermStability,
} from './memory.js';
import {
  DEFAULT_FSRS_PARAMETERS,
  MAX_DIFFICULTY,
  MIN_DIFFICULTY,
  clampParameters,
  createSchedulerConfig,
} from './parameters.js';
import { RATING, RATINGS } from './types.js';

const w = DEFAULT_FSRS_PARAMETERS;

describe('forgettingCurve', () => {
  it('is certain at zero elapsed days', () => {
    expect(forgettingCurve(w, 0, 5)).toBe(1);
  });

  it('returns 90% after exactly one stability, which is what stability means', () => {
    for (const stability of [0.5, 1, 7, 60, 365, 3650]) {
      expect(forgettingCurve(w, stability, stability)).toBeCloseTo(0.9, 7);
    }
  });

  it('falls as more time passes', () => {
    let previous = 1;

    for (let days = 1; days <= 400; days += 1) {
      const recall = forgettingCurve(w, days, 30);

      expect(recall).toBeLessThan(previous);
      previous = recall;
    }
  });

  it('stays above zero even after a hundred years', () => {
    expect(forgettingCurve(w, 36_500, 1)).toBeGreaterThan(0);
  });

  // The long tail is the reason a break does not destroy progress, and the
  // reason the demo shows 0.88 rather than 0.4 after a two month absence.
  it('only reaches a coin flip after about ninety times the stability', () => {
    expect(forgettingCurve(w, 90 * 30, 30)).toBeCloseTo(0.5, 2);
    expect(forgettingCurve(w, 9 * 30, 30)).toBeCloseTo(0.7, 2);
  });

  it('falls more slowly for a more stable card', () => {
    expect(forgettingCurve(w, 30, 100)).toBeGreaterThan(forgettingCurve(w, 30, 10));
  });
});

describe('intervalModifier', () => {
  it('is one at the default target, so stability reads as an interval', () => {
    expect(intervalModifier(w, 0.9)).toBeCloseTo(1, 7);
  });

  it('shortens intervals as the target rises', () => {
    const modifiers = [0.8, 0.85, 0.9, 0.95, 0.97].map((target) => intervalModifier(w, target));
    const highestFirst = [...modifiers].sort((left, right) => right - left);

    expect(modifiers).toEqual(highestFirst);
  });

  it('rejects a target that is not a chance', () => {
    expect(() => intervalModifier(w, 0)).toThrow(RangeError);
    expect(() => intervalModifier(w, 1)).toThrow(RangeError);
    expect(() => intervalModifier(w, Number.NaN)).toThrow(RangeError);
  });

  // These are the numbers in the table in docs/algorithm.md. If they move, the
  // documentation is wrong and has to move with them.
  it('matches the trade off table in the documentation', () => {
    expect(intervalModifier(w, 0.8)).toBeCloseTo(3.316, 3);
    expect(intervalModifier(w, 0.85)).toBeCloseTo(1.906, 3);
    expect(intervalModifier(w, 0.9)).toBeCloseTo(1.0, 3);
    expect(intervalModifier(w, 0.95)).toBeCloseTo(0.403, 3);
    expect(intervalModifier(w, 0.97)).toBeCloseTo(0.223, 3);
  });
});

describe('intervalFromStability', () => {
  const config = createSchedulerConfig();

  it('returns the stability itself at the default target', () => {
    expect(intervalFromStability(42, 0.9, config)).toBeCloseTo(42, 5);
  });

  it('grows with stability in a straight line', () => {
    expect(intervalFromStability(20, 0.85, config)).toBeCloseTo(
      2 * intervalFromStability(10, 0.85, config),
      9,
    );
  });

  it('lands where the forgetting curve reaches the target', () => {
    const days = intervalFromStability(30, 0.85, config);

    expect(forgettingCurve(w, days, 30)).toBeCloseTo(0.85, 6);
  });
});

describe('initialStability', () => {
  it('reads the first four weights', () => {
    expect(initialStability(w, RATING.again)).toBeCloseTo(0.212, 8);
    expect(initialStability(w, RATING.hard)).toBeCloseTo(1.2931, 8);
    expect(initialStability(w, RATING.good)).toBeCloseTo(2.3065, 8);
    expect(initialStability(w, RATING.easy)).toBeCloseTo(8.2956, 8);
  });

  it('rises with the answer', () => {
    const values = RATINGS.map((rating) => initialStability(w, rating));

    expect(values).toEqual([...values].sort((left, right) => left - right));
  });

  it('never starts below a tenth of a day, however small the weight is', () => {
    const tiny = clampParameters(
      w.map((weight, index) => (index < 4 ? 0 : weight)),
      1,
    );

    for (const rating of RATINGS) {
      expect(initialStability(tiny, rating)).toBe(0.1);
    }
  });
});

describe('initialDifficulty', () => {
  it('starts at w[4] when the first answer is Again', () => {
    expect(initialDifficulty(w, RATING.again)).toBeCloseTo(6.4133, 8);
  });

  it('falls as the first answer gets better', () => {
    const values = RATINGS.map((rating) => initialDifficulty(w, rating));

    expect(values).toEqual([...values].sort((left, right) => right - left));
  });
});

describe('nextDifficulty', () => {
  it('rises on Again and falls on Easy', () => {
    expect(nextDifficulty(w, 5, RATING.again)).toBeGreaterThan(5);
    expect(nextDifficulty(w, 5, RATING.easy)).toBeLessThan(5);
  });

  it('barely moves on Good', () => {
    expect(nextDifficulty(w, 5, RATING.good)).toBeCloseTo(5, 1);
  });

  it('stays inside one to ten from any starting point', () => {
    for (let start = MIN_DIFFICULTY; start <= MAX_DIFFICULTY; start += 0.25) {
      for (const rating of RATINGS) {
        const result = nextDifficulty(w, start, rating);

        expect(result).toBeGreaterThanOrEqual(MIN_DIFFICULTY);
        expect(result).toBeLessThanOrEqual(MAX_DIFFICULTY);
      }
    }
  });

  it('cannot be driven to ten by repeated failures', () => {
    let difficulty = 5;

    for (let index = 0; index < 200; index += 1) {
      difficulty = nextDifficulty(w, difficulty, RATING.again);
    }

    expect(difficulty).toBeLessThanOrEqual(MAX_DIFFICULTY);
    expect(difficulty).toBeGreaterThan(9);
  });

  it('moves a hard card less than an easy one, which is the damping', () => {
    const fromEasy = nextDifficulty(w, 2, RATING.again) - 2;
    const fromHard = nextDifficulty(w, 9, RATING.again) - 9;

    expect(fromEasy).toBeGreaterThan(fromHard);
  });
});

describe('recallStability', () => {
  it('always grows stability', () => {
    for (const stability of [0.5, 5, 50, 500]) {
      for (const rating of [RATING.hard, RATING.good, RATING.easy]) {
        expect(recallStability(w, 5, stability, 0.9, rating)).toBeGreaterThan(stability);
      }
    }
  });

  it('grows more when the card was closer to being forgotten', () => {
    const nearlyForgotten = recallStability(w, 5, 10, 0.4, RATING.good);
    const freshInMind = recallStability(w, 5, 10, 0.95, RATING.good);

    expect(nearlyForgotten).toBeGreaterThan(freshInMind);
  });

  it('grows more for an easy card than a hard one', () => {
    const easy = recallStability(w, 5, 10, 0.9, RATING.easy);
    const good = recallStability(w, 5, 10, 0.9, RATING.good);
    const hard = recallStability(w, 5, 10, 0.9, RATING.hard);

    expect(easy).toBeGreaterThan(good);
    expect(good).toBeGreaterThan(hard);
  });

  it('grows less for a difficult card', () => {
    expect(recallStability(w, 9, 10, 0.9, RATING.good)).toBeLessThan(
      recallStability(w, 2, 10, 0.9, RATING.good),
    );
  });
});

describe('forgetStability', () => {
  it('leaves less than the card had', () => {
    for (const stability of [1, 10, 100, 1000]) {
      expect(forgetStability(w, 5, stability, 0.9)).toBeLessThan(stability);
    }
  });

  it('leaves more behind for a card that was known better', () => {
    expect(forgetStability(w, 5, 200, 0.5)).toBeGreaterThan(forgetStability(w, 5, 20, 0.5));
  });

  it('never falls to zero', () => {
    expect(forgetStability(w, 10, 0.001, 0.99)).toBeGreaterThan(0);
  });
});

describe('shortTermStability', () => {
  it('never lowers stability on a correct answer', () => {
    for (const stability of [0.1, 1, 10, 100]) {
      for (const rating of [RATING.hard, RATING.good, RATING.easy]) {
        expect(shortTermStability(w, stability, rating)).toBeGreaterThanOrEqual(stability);
      }
    }
  });

  it('lowers stability on Again', () => {
    expect(shortTermStability(w, 10, RATING.again)).toBeLessThan(10);
  });

  it('rewards a better answer more', () => {
    const values = RATINGS.map((rating) => shortTermStability(w, 5, rating));

    expect(values).toEqual([...values].sort((left, right) => left - right));
  });
});

describe('postLapseFloor', () => {
  it('never sits above the stability the card had', () => {
    for (const stability of [0.5, 5, 50, 500]) {
      expect(postLapseFloor(w, stability)).toBeLessThanOrEqual(stability);
    }
  });
});

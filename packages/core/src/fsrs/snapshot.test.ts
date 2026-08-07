/**
 * One history, pinned.
 *
 * The differential test proves the maths matches the reference and the property
 * tests prove the rules hold, but neither notices if a change quietly shifts
 * every schedule by a day. This does. The numbers below were produced by this
 * code and committed on purpose. If they move, the test fails, and someone has
 * to decide whether the move was wanted.
 */

import { describe, expect, it } from 'vitest';

import { MS_PER_DAY } from './math.js';
import { createSchedulerConfig } from './parameters.js';
import { createSeededRandom } from './random.js';
import { review } from './scheduler.js';
import { RATING, newCard, type Rating, type SchedulingState } from './types.js';

/** A run of answers with two stretches of trouble in it. */
const RATINGS: readonly Rating[] = [
  RATING.good,
  RATING.good,
  RATING.good,
  RATING.hard,
  RATING.good,
  RATING.again,
  RATING.good,
  RATING.good,
  RATING.easy,
  RATING.good,
  RATING.good,
  RATING.again,
  RATING.hard,
  RATING.good,
  RATING.good,
  RATING.good,
  RATING.easy,
  RATING.good,
  RATING.good,
  RATING.good,
];

const FUZZ_SEED = 424_242;
const START = new Date(Date.UTC(2026, 8, 1, 7, 0));

/** Answers the card every time it comes due and records what happened. */
function runHistory(): {
  intervalDays: number[];
  stability: number[];
  difficulty: number[];
} {
  const config = createSchedulerConfig({ enableFuzz: true });
  const fuzz = createSeededRandom(FUZZ_SEED);
  const intervalDays: number[] = [];
  const stability: number[] = [];
  const difficulty: number[] = [];

  let state: SchedulingState = newCard(START);
  let at = START;

  for (const rating of RATINGS) {
    const next: SchedulingState = review(state, rating, at, config, fuzz).next;

    if (next.state === 'new') {
      throw new Error('A card cannot still be new after being answered.');
    }

    intervalDays.push(
      Math.round(((next.due.getTime() - at.getTime()) / MS_PER_DAY) * 10_000) / 10_000,
    );
    stability.push(Math.round(next.stability * 10_000) / 10_000);
    difficulty.push(Math.round(next.difficulty * 10_000) / 10_000);

    state = next;
    at = new Date(next.due.getTime());
  }

  return { intervalDays, stability, difficulty };
}

describe('twenty answers on a fixed schedule with a fixed seed', () => {
  const history = runHistory();

  // 0.0069 of a day is ten minutes and 0.0104 is fifteen: the learning and
  // relearning steps. The two of them mark where the card was failed.
  it('produces exactly these intervals, in days', () => {
    expect(history.intervalDays).toEqual([
      0.0069, 2, 9, 30, 85, 0.0069, 3, 7, 25, 52, 98, 0.0069, 0.0104, 5, 6, 9, 19, 34, 49, 76,
    ]);
  });

  it('produces exactly these stabilities', () => {
    expect(history.stability).toEqual([
      2.3065, 2.3065, 10.971, 29.329, 86.5512, 3.5554, 3.5554, 7.335, 21.5677, 47.6745, 96.3231,
      3.6089, 3.6089, 3.6089, 6.6796, 10.5076, 20.6968, 32.1125, 50.4892, 75.8658,
    ]);
  });

  it('produces exactly these difficulties', () => {
    expect(history.difficulty).toEqual([
      2.1181, 2.1112, 2.1043, 4.7437, 4.7342, 8.2544, 8.2414, 8.2284, 7.6216, 7.6092, 7.5968,
      9.1953, 9.451, 9.4368, 9.4226, 9.4084, 9.196, 9.182, 9.168, 9.1541,
    ]);
  });

  it('shows the two failures as a collapse and a rebuild', () => {
    const stability = history.stability;

    expect(stability[4]).toBeGreaterThan(80);
    expect(stability[5]).toBeLessThan(5);
    expect(stability[10]).toBeGreaterThan(90);
    expect(stability[11]).toBeLessThan(5);
    expect(stability[19]).toBeGreaterThan(70);
  });
});

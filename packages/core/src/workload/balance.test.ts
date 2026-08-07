import { describe, expect, it } from 'vitest';

import { createSchedulerConfig } from '../fsrs/parameters.js';
import { createSeededRandom } from '../fsrs/random.js';
import { RATING } from '../fsrs/types.js';
import { MS_PER_DAY, dayIndexOf, dayStartOf } from '../time/day.js';

import { balanceDueDate, balanceReview } from './balance.js';
import { reviewCard } from './cards.js';
import { createWorkloadConfig } from './config.js';

import type { DailyLoad } from './types.js';

const NOW = new Date('2026-08-05T12:00:00Z');

const config = createWorkloadConfig({
  scheduler: createSchedulerConfig({ enableFuzz: false, timezone: 'UTC', dayCutoffHour: 4 }),
});

/** A forecast with the given minutes on each day, starting today. */
function loadOf(minutes: readonly number[]): DailyLoad[] {
  const today = dayIndexOf(NOW, config.scheduler);

  return minutes.map((value, offset) => ({
    dayIndex: today + offset,
    date: dayStartOf(today + offset, config.scheduler),
    reviewCount: value / 0.1,
    minutes: value,
    newCardCount: 0,
  }));
}

/** Sixty quiet days with one busy one in the middle. */
function withPeakAt(day: number, peak = 90): DailyLoad[] {
  return loadOf(Array.from({ length: 60 }, (_unused, offset) => (offset === day ? peak : 10)));
}

const rng = createSeededRandom(1);

describe('choosing the day', () => {
  it('leaves the interval alone when balancing is off', () => {
    const plain = createWorkloadConfig({ scheduler: config.scheduler, enableLoadBalancing: false });

    expect(balanceDueDate(12, withPeakAt(12), plain, rng)).toBe(12);
  });

  it('steps off a busy day onto a quiet one', () => {
    const chosen = balanceDueDate(12, withPeakAt(12), config, rng);

    expect(chosen).not.toBe(12);
    expect(Math.abs(chosen - 12)).toBeLessThanOrEqual(2);
  });

  it('stays where it is when every nearby day is the same', () => {
    expect(balanceDueDate(12, loadOf(Array.from({ length: 60 }, () => 10)), config, rng)).toBe(12);
  });

  it('never looks further than the window, however empty the day beyond it', () => {
    const load = loadOf(
      Array.from({ length: 60 }, (_unused, offset) => (offset >= 40 && offset <= 50 ? 0 : 50)),
    );

    // The ideal is 20, the window is two days either side, and the empty
    // stretch starts twenty days past that.
    expect(balanceDueDate(20, load, config, rng)).toBeGreaterThanOrEqual(18);
    expect(balanceDueDate(20, load, config, rng)).toBeLessThanOrEqual(22);
  });

  it('never schedules sooner than tomorrow', () => {
    const load = loadOf([0, 100, 100, 100, 100]);

    expect(balanceDueDate(1, load, config, rng)).toBeGreaterThanOrEqual(1);
  });

  it('never goes past the maximum interval', () => {
    const capped = createWorkloadConfig({
      scheduler: createSchedulerConfig({ maximumInterval: 30, enableFuzz: false }),
    });
    const load = loadOf(Array.from({ length: 60 }, (_unused, offset) => (offset <= 30 ? 90 : 0)));

    expect(balanceDueDate(30, load, capped, rng)).toBeLessThanOrEqual(30);
  });

  it('gives up when the whole window is past the end of the forecast', () => {
    expect(balanceDueDate(200, withPeakAt(5), config, rng)).toBe(200);
  });

  it('widens the window with the interval, but never below one day either side', () => {
    // Ten percent of five days rounds to nothing, so a short interval still
    // gets one day either side to work with.
    const near = loadOf(Array.from({ length: 60 }, (_unused, offset) => (offset === 5 ? 90 : 10)));

    expect(Math.abs(balanceDueDate(5, near, config, rng) - 5)).toBe(1);

    // Ten percent of forty days is four, so a card can move that far when
    // everything closer is busy.
    const far = loadOf(
      Array.from({ length: 60 }, (_unused, offset) => (offset >= 36 && offset <= 43 ? 90 : 10)),
    );

    expect(balanceDueDate(40, far, config, rng)).toBe(44);
  });

  it('gives the same answer for the same seed', () => {
    const first = balanceDueDate(12, withPeakAt(12), config, createSeededRandom(9));
    const second = balanceDueDate(12, withPeakAt(12), config, createSeededRandom(9));

    expect(first).toBe(second);
  });
});

describe('answering a card with balancing on', () => {
  it('moves the card off the peak and records where it went', () => {
    const card = reviewCard({ id: 'one' }, 12, NOW);
    const load = withPeakAt(12);
    const outcome = balanceReview(card.scheduling, RATING.good, NOW, load, config, rng);
    const interval = Math.round((outcome.next.due.getTime() - NOW.getTime()) / MS_PER_DAY);

    expect(interval).not.toBe(12);
    expect(outcome.log.placedDue.getTime()).toBe(outcome.next.due.getTime());
  });

  it('leaves a card in learning where the steps put it', () => {
    const fresh = reviewCard({ id: 'two' }, 3, NOW);
    const outcome = balanceReview(fresh.scheduling, RATING.again, NOW, withPeakAt(1), config, rng);

    // A lapse goes to a relearning step measured in minutes, and nothing in
    // this file may touch that.
    expect(outcome.next.due.getTime() - NOW.getTime()).toBeLessThan(MS_PER_DAY);
  });

  it('does not stack with fuzz, because the settings turn fuzz off', () => {
    const balanced = createWorkloadConfig({
      scheduler: createSchedulerConfig({ enableFuzz: true }),
      enableLoadBalancing: true,
    });

    expect(balanced.scheduler.enableFuzz).toBe(false);
  });

  it('leaves fuzz alone when balancing is off', () => {
    const scattered = createWorkloadConfig({
      scheduler: createSchedulerConfig({ enableFuzz: true }),
      enableLoadBalancing: false,
    });

    expect(scattered.scheduler.enableFuzz).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';

import { createSchedulerConfig } from '../fsrs/parameters.js';
import { createSeededRandom } from '../fsrs/random.js';
import { RATING, newCard } from '../fsrs/types.js';
import { MS_PER_DAY } from '../time/day.js';

import { createWorkloadConfig } from './config.js';
import {
  PRIOR_RATING_DISTRIBUTION,
  forecast,
  meanMinutes,
  ratingDistribution,
  totalMinutes,
} from './forecast.js';

import type { CardDirection, WorkloadCard, WorkloadReview } from './types.js';
import type { SchedulingState } from '../fsrs/types.js';

const NOW = new Date('2026-08-05T12:00:00Z');

const config = createWorkloadConfig({
  scheduler: createSchedulerConfig({ enableFuzz: false, timezone: 'UTC', dayCutoffHour: 4 }),
});

/** A card in the review state, due in a given number of days. */
function reviewCard(
  id: string,
  stability: number,
  dueInDays: number,
  direction: CardDirection = 'recall',
): WorkloadCard {
  const scheduling: SchedulingState = {
    state: 'review',
    stability,
    difficulty: 5,
    lastReview: new Date(NOW.getTime() - stability * MS_PER_DAY),
    due: new Date(NOW.getTime() + dueInDays * MS_PER_DAY),
    reps: 5,
    lapses: 0,
    learningStep: 0,
  };

  return { id, noteId: `note-${id}`, direction, scheduling };
}

/** A deck whose cards are spread over the next few weeks. */
function deck(size: number): WorkloadCard[] {
  return Array.from({ length: size }, (_unused, index) =>
    reviewCard(`card-${index}`, 4 + (index % 20), index % 25),
  );
}

/** A log row with a given rating on it. */
function answered(rating: WorkloadReview['rating'], count: number): WorkloadReview[] {
  return Array.from({ length: count }, () => ({
    cardId: 'card',
    direction: 'recall' as const,
    rating,
    reviewedAt: NOW,
    elapsedDays: 3,
    scheduledDays: 3,
    placedDue: NOW,
    stateBefore: 'review' as const,
    stabilityBefore: 5,
    difficultyBefore: 5,
    durationMs: 6000,
  }));
}

describe('what the forecast counts', () => {
  it('counts the reviews a card will spawn, not only the one already scheduled', async ({
    annotate,
  }) => {
    const cards = deck(200);
    const load = forecast({ cards, config, now: NOW, horizonDays: 60 });
    const alreadyScheduled = cards.filter(
      (card) => card.scheduling.due.getTime() < NOW.getTime() + 60 * MS_PER_DAY,
    ).length;
    const counted = load.reduce((total, day) => total + day.reviewCount, 0);

    await annotate(
      `${counted.toFixed(0)} reviews over 60 days against ${alreadyScheduled} already on the calendar: ${(((counted - alreadyScheduled) / counted) * 100).toFixed(0)}% of the work is not scheduled yet`,
    );

    expect(counted).toBeGreaterThan(alreadyScheduled * 1.5);
  });

  it('says nothing about a card whose next review is past the horizon', () => {
    const load = forecast({ cards: [reviewCard('far', 400, 120)], config, now: NOW });

    expect(totalMinutes(load)).toBe(0);
  });

  it('puts an overdue card on today rather than in the past', () => {
    const load = forecast({ cards: [reviewCard('late', 10, -30)], config, now: NOW });

    // One review, plus the small share of it that is failed and comes back the
    // same evening.
    expect(load[0]?.reviewCount).toBeGreaterThanOrEqual(1);
    expect(load[0]?.reviewCount).toBeLessThan(1.2);
  });

  it('leaves untouched cards out, because nothing has decided to introduce them', () => {
    const brandNew: WorkloadCard = {
      id: 'fresh',
      noteId: 'note',
      direction: 'recall',
      scheduling: newCard(NOW),
    };
    const load = forecast({ cards: [brandNew], config, now: NOW });

    expect(totalMinutes(load)).toBe(0);
  });

  it('counts a card that is handed over as introduced today', () => {
    const brandNew: WorkloadCard = {
      id: 'fresh',
      noteId: 'note',
      direction: 'recall',
      scheduling: newCard(NOW),
    };
    const load = forecast({ cards: [], newCards: [brandNew], config, now: NOW });

    expect(load[0]?.newCardCount).toBe(1);
    expect(load[0]?.reviewCount).toBeGreaterThan(0);
    expect(totalMinutes(load)).toBeGreaterThan(0);
  });

  it('starts on the study day the moment falls in', () => {
    const load = forecast({ cards: deck(10), config, now: NOW, horizonDays: 5 });

    expect(load).toHaveLength(5);
    expect(load[0]?.date.getTime()).toBeLessThanOrEqual(NOW.getTime());
    expect(load[1]?.dayIndex).toBe((load[0]?.dayIndex ?? 0) + 1);
  });

  it('scales with how long the answers take', () => {
    const slow = createWorkloadConfig({
      scheduler: config.scheduler,
      answerSeconds: { recognition: 8, recall: 12, production: 24, cloze: 20, listening: 12 },
    });
    const normal = forecast({ cards: deck(50), config, now: NOW });
    const doubled = forecast({ cards: deck(50), config: slow, now: NOW });

    expect(totalMinutes(doubled)).toBeCloseTo(totalMinutes(normal) * 2, 6);
  });

  it('gives the same answer every time it is asked', () => {
    const first = forecast({ cards: deck(100), config, now: NOW });
    const second = forecast({ cards: deck(100), config, now: NOW });

    expect(second.map((day) => day.minutes)).toEqual(first.map((day) => day.minutes));
  });
});

describe('expected value against Monte Carlo', () => {
  it('agrees on the total within five percent', () => {
    const cards = deck(300);
    const expected = forecast({ cards, config, now: NOW, horizonDays: 60 });
    const sampled = forecast({
      cards,
      config,
      now: NOW,
      horizonDays: 60,
      mode: 'monteCarlo',
      samples: 60,
      rng: createSeededRandom(7),
    });

    const cheap = totalMinutes(expected);
    const honest = totalMinutes(sampled);

    expect(Math.abs(cheap - honest) / honest).toBeLessThan(0.05);
  });

  it('agrees on the mean day of the first fortnight within ten percent', () => {
    const cards = deck(300);
    const expected = meanMinutes(forecast({ cards, config, now: NOW }), 14);
    const sampled = meanMinutes(
      forecast({
        cards,
        config,
        now: NOW,
        mode: 'monteCarlo',
        samples: 60,
        rng: createSeededRandom(11),
      }),
      14,
    );

    expect(Math.abs(expected - sampled) / sampled).toBeLessThan(0.1);
  });

  it('refuses to run Monte Carlo without a generator', () => {
    expect(() => forecast({ cards: deck(5), config, now: NOW, mode: 'monteCarlo' })).toThrow(
      RangeError,
    );
  });
});

describe('the rating distribution', () => {
  it('is the prior when there is no history', () => {
    expect(ratingDistribution([])).toEqual(PRIOR_RATING_DISTRIBUTION);
  });

  it('moves towards what the person actually presses', () => {
    const measured = ratingDistribution(answered(RATING.again, 200));

    expect(measured[RATING.again]).toBeGreaterThan(0.8);
    expect(measured[RATING.good]).toBeLessThan(0.1);
  });

  it('always adds up to one', () => {
    for (const logs of [[], answered(RATING.hard, 3), answered(RATING.easy, 500)]) {
      const measured = ratingDistribution(logs);
      const total =
        measured[RATING.again] +
        measured[RATING.hard] +
        measured[RATING.good] +
        measured[RATING.easy];

      expect(total).toBeCloseTo(1, 10);
    }
  });

  it('makes a worse learner more expensive', () => {
    const cards = deck(100);
    const careful = forecast({ cards, config, now: NOW, logs: answered(RATING.good, 500) });
    const struggling = forecast({ cards, config, now: NOW, logs: answered(RATING.again, 500) });

    expect(totalMinutes(struggling)).toBeGreaterThan(totalMinutes(careful) * 1.5);
  });
});

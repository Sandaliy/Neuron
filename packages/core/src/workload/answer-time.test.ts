import { describe, expect, it } from 'vitest';

import { RATING } from '../fsrs/types.js';

import {
  ANSWER_TIME_SAMPLE,
  DEFAULT_ANSWER_SECONDS,
  estimateAnswerTime,
  estimateAnswerTimes,
} from './answer-time.js';

import type { CardDirection, WorkloadReview } from './types.js';
import type { CardState } from '../fsrs/types.js';

/** A log row that only says what kind of answer it was and how long it took. */
function timed(
  direction: CardDirection,
  state: CardState,
  seconds: number,
  count = 1,
): WorkloadReview[] {
  return Array.from({ length: count }, () => ({
    cardId: 'card',
    direction,
    rating: RATING.good,
    reviewedAt: new Date('2026-08-01T10:00:00Z'),
    elapsedDays: 3,
    scheduledDays: 3,
    placedDue: new Date('2026-08-08T10:00:00Z'),
    stateBefore: state,
    stabilityBefore: 5,
    difficultyBefore: 5,
    durationMs: seconds * 1000,
  }));
}

describe('with nothing measured yet', () => {
  it('uses the default for the direction', () => {
    expect(estimateAnswerTime([], 'production', 'review')).toBe(DEFAULT_ANSWER_SECONDS.production);
    expect(estimateAnswerTime([], 'recognition', 'review')).toBe(
      DEFAULT_ANSWER_SECONDS.recognition,
    );
  });

  it('ignores answers of another direction or another state', () => {
    const logs = [
      ...timed('recognition', 'review', 30, 50),
      ...timed('recall', 'learning', 30, 50),
    ];

    expect(estimateAnswerTime(logs, 'recall', 'review')).toBe(DEFAULT_ANSWER_SECONDS.recall);
  });
});

describe('once there is a history', () => {
  it('moves from the default to the measurement over the first twenty answers', () => {
    const half = estimateAnswerTime(
      timed('recall', 'review', 10, ANSWER_TIME_SAMPLE / 2),
      'recall',
      'review',
    );
    const full = estimateAnswerTime(
      timed('recall', 'review', 10, ANSWER_TIME_SAMPLE),
      'recall',
      'review',
    );

    // Ten measured against a default of six: halfway there after ten answers.
    expect(half).toBeCloseTo(8, 6);
    expect(full).toBeCloseTo(10, 6);
  });

  it('does not jump when the twentieth answer arrives', () => {
    const before = estimateAnswerTime(timed('recall', 'review', 10, 19), 'recall', 'review');
    const after = estimateAnswerTime(timed('recall', 'review', 10, 20), 'recall', 'review');

    expect(Math.abs(after - before)).toBeLessThan(0.3);
  });

  it('takes the median rather than the mean, so one long answer is not the story', () => {
    const logs = [...timed('recall', 'review', 5, 40), ...timed('recall', 'review', 600, 1)];

    expect(estimateAnswerTime(logs, 'recall', 'review')).toBeCloseTo(5, 6);
  });

  it('drops the slowest twentieth, because those are interruptions', () => {
    // Nineteen answers of five seconds and one of an hour. The trim throws the
    // hour away, so what is left is nineteen fives and the estimate is five.
    const withBreak = [...timed('recall', 'review', 5, 19), ...timed('recall', 'review', 3600, 1)];

    expect(estimateAnswerTime(withBreak, 'recall', 'review')).toBeCloseTo(5, 6);
  });

  it('ignores rows with no duration on them', () => {
    const logs = [...timed('recall', 'review', 8, 30), ...timed('recall', 'review', 0, 30)];

    expect(estimateAnswerTime(logs, 'recall', 'review')).toBeCloseTo(8, 6);
  });
});

describe('the whole table at once', () => {
  it('agrees with asking one cell at a time', () => {
    const logs = [
      ...timed('recognition', 'review', 3, 25),
      ...timed('recognition', 'learning', 7, 25),
      ...timed('production', 'review', 20, 25),
    ];
    const table = estimateAnswerTimes(logs);

    expect(table.recognition.review).toBeCloseTo(
      estimateAnswerTime(logs, 'recognition', 'review'),
      10,
    );
    expect(table.recognition.learning).toBeCloseTo(
      estimateAnswerTime(logs, 'recognition', 'learning'),
      10,
    );
    expect(table.production.review).toBeCloseTo(
      estimateAnswerTime(logs, 'production', 'review'),
      10,
    );
    expect(table.cloze.review).toBe(DEFAULT_ANSWER_SECONDS.cloze);
  });

  it('holds every direction and every state', () => {
    const table = estimateAnswerTimes([]);

    expect(Object.keys(table)).toHaveLength(5);
    expect(Object.keys(table.listening)).toHaveLength(4);
  });
});

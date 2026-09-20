import { describe, expect, it } from 'vitest';

import { projectReviewEvents, reviewProjectionOrigin, reviewSeed } from './events.js';
import { createSchedulerConfig } from './parameters.js';
import { createSeededRandom } from './random.js';
import { review } from './scheduler.js';
import { newCard, RATING } from './types.js';

describe('canonical cancellation replay', () => {
  const config = createSchedulerConfig({ timezone: 'UTC' });
  const initial = newCard(new Date('2026-01-01'));
  const a = review(
    initial,
    RATING.good,
    new Date('2026-01-02'),
    config,
    createSeededRandom(reviewSeed('a')),
  );
  const b = review(
    a.next,
    RATING.easy,
    new Date('2026-01-04'),
    config,
    createSeededRandom(reviewSeed('b')),
  );
  const A = { id: 'a', log: a.log, priorState: initial };
  const B = { id: 'b', log: b.log, priorState: a.next };
  const undo = { id: 'undo-a', log: a.log, cancelsReviewId: 'a' };

  it('removes A while recomputing B as the surviving answer', () => {
    const expected = review(
      initial,
      RATING.easy,
      b.log.reviewedAt,
      config,
      createSeededRandom(reviewSeed('b')),
    ).next;
    for (const events of [
      [A, B, undo],
      [undo, B, A],
      [B, A, undo],
      [undo, A, B, undo],
    ]) {
      expect(projectReviewEvents(events, initial, config)).toEqual(expected);
    }
  });

  it('preserves later answers even when cancellation arrives last', () => {
    const c = review(
      b.next,
      RATING.hard,
      new Date('2026-01-07'),
      config,
      createSeededRandom(reviewSeed('c')),
    );
    const C = { id: 'c', log: c.log, priorState: b.next };
    const afterB = review(
      initial,
      RATING.easy,
      b.log.reviewedAt,
      config,
      createSeededRandom(reviewSeed('b')),
    ).next;
    const expected = review(
      afterB,
      RATING.hard,
      c.log.reviewedAt,
      config,
      createSeededRandom(reviewSeed('c')),
    ).next;
    expect(projectReviewEvents([C, undo, B, A], initial, config)).toEqual(expected);
    expect(expected.reps).toBe(2);
  });

  it('finds the original predecessor when an older answer arrived later', () => {
    const merged = [
      { ...A, priorState: b.next },
      { ...B, priorState: initial },
    ];
    expect(reviewProjectionOrigin(merged, b.next)).toEqual(initial);
  });
});

describe('immutable learning restart replay', () => {
  it('converges across arrival order, retries and cancellation on either side of reset', () => {
    const config = createSchedulerConfig({ timezone: 'UTC' });
    const initial = newCard(new Date('2026-01-01'));
    const a = review(
      initial,
      RATING.easy,
      new Date('2026-01-02'),
      config,
      createSeededRandom(reviewSeed('a')),
    );
    const at = new Date('2026-02-01');
    const reset = {
      id: 'reset',
      resetsLearning: true,
      log: { ...a.log, reviewedAt: at },
      priorState: a.next,
    };
    const fresh = newCard(at);
    const b = review(
      fresh,
      RATING.good,
      new Date('2026-02-02'),
      config,
      createSeededRandom(reviewSeed('b')),
    );
    const A = { id: 'a', log: a.log, priorState: initial };
    const B = { id: 'b', log: b.log, priorState: fresh };
    const undoA = { id: 'undo-a', log: a.log, cancelsReviewId: 'a' };
    for (const events of [
      [A, reset, B],
      [B, reset, A, reset],
      [undoA, B, reset, A],
    ]) {
      expect(projectReviewEvents(events, initial, config)).toEqual(b.next);
      expect(
        projectReviewEvents(
          [...events, { id: 'undo-b', log: b.log, cancelsReviewId: 'b' }],
          initial,
          config,
        ),
      ).toEqual(fresh);
    }
    expect(projectReviewEvents([A, reset], initial, config)).toEqual(fresh);
  });
});

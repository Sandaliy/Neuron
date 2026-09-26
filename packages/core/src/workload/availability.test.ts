import { describe, expect, it } from 'vitest';

import { createSchedulerConfig } from '../fsrs/parameters.js';

import {
  availableForDailyStudy,
  availableForStudy,
  dailyStudyAvailableAt,
  studyAvailableAt,
  studyDayAnswers,
} from './availability.js';
import { freshCard, reviewCard } from './cards.js';

import type { WorkloadReview } from './types.js';

describe('Study availability', () => {
  it.each(['UTC', 'Europe/Berlin', 'America/New_York'])(
    'reports the admission boundary in %s, including DST',
    (timezone) => {
      const config = createSchedulerConfig({ timezone, dayCutoffHour: 4 });
      for (const state of ['learning', 'relearning', 'review'] as const) {
        const card = { state, due: new Date('2026-03-29T18:30:00Z') };
        const at = studyAvailableAt(card, config);
        expect(availableForStudy(card, at, config)).toBe(true);
        expect(availableForStudy(card, new Date(at.getTime() - 1), config)).toBe(false);
      }
    },
  );
  const now = new Date('2026-09-21T12:00:00Z');
  const config = createSchedulerConfig({ timezone: 'UTC', dayCutoffHour: 4 });
  it.each(['learning', 'relearning'] as const)('waits for the exact %s step time', (state) => {
    expect(availableForStudy({ state, due: new Date('2026-09-21T12:01:00Z') }, now, config)).toBe(
      false,
    );
    expect(availableForStudy({ state, due: now }, now, config)).toBe(true);
  });
  it('keeps review days and fresh material available', () => {
    expect(
      availableForStudy({ state: 'review', due: new Date('2026-09-21T18:00:00Z') }, now, config),
    ).toBe(true);
    expect(availableForStudy({ state: 'new', due: now }, now, config)).toBe(true);
  });

  it('separates sibling directions across plans and restores them at the local cutoff', () => {
    const scheduler = createSchedulerConfig({ timezone: 'Europe/Berlin', dayCutoffHour: 4 });
    const answered = reviewCard(
      { id: 'answered', noteId: 'one' },
      1,
      new Date('2026-09-22T23:00:00Z'),
    );
    const sibling = freshCard({ id: 'sibling', noteId: 'one' }, now);
    const other = freshCard({ id: 'other', noteId: 'two' }, now);
    const log: WorkloadReview = {
      cardId: answered.id,
      noteId: answered.noteId,
      direction: answered.direction,
      rating: 1,
      reviewedAt: new Date('2026-09-21T23:00:00Z'),
      placedDue: new Date('2026-09-21T23:10:00Z'),
      stateBefore: 'new',
      elapsedDays: 0,
      scheduledDays: 0,
      stabilityBefore: undefined,
      difficultyBefore: undefined,
      durationMs: 1000,
    };
    const sameDay = new Date('2026-09-22T01:59:59.999Z');
    const answers = studyDayAnswers([answered, sibling, other], [log], sameDay, scheduler);
    expect(availableForDailyStudy(sibling, answers, sameDay, scheduler)).toBe(false);
    expect(availableForDailyStudy(other, answers, sameDay, scheduler)).toBe(true);
    expect(dailyStudyAvailableAt(sibling, answers, sameDay, scheduler)).toEqual(
      new Date('2026-09-22T02:00:00Z'),
    );
    const tomorrow = new Date('2026-09-22T02:00:00Z');
    const nextAnswers = studyDayAnswers([answered, sibling], [log], tomorrow, scheduler);
    expect(availableForDailyStudy(sibling, nextAnswers, tomorrow, scheduler)).toBe(true);
  });

  it('admits the answered Card at its precise learning retry, without admitting its sibling', () => {
    const answered = reviewCard(
      { id: 'answered', noteId: 'one' },
      1,
      new Date(now.getTime() + 60_000),
    );
    const learning = {
      ...answered,
      scheduling: {
        state: 'relearning' as const,
        due: answered.scheduling.due,
        stability: 1,
        difficulty: 5,
        lastReview: now,
        reps: 1,
        lapses: 1,
        learningStep: 1,
      },
    };
    const sibling = freshCard({ id: 'sibling', noteId: 'one' }, now);
    const answers = { notes: new Set(['one']), cards: new Set(['answered']) };
    expect(availableForDailyStudy(learning, answers, now, config)).toBe(false);
    expect(availableForDailyStudy(learning, answers, learning.scheduling.due, config)).toBe(true);
    expect(availableForDailyStudy(sibling, answers, learning.scheduling.due, config)).toBe(false);
  });

  it('never reopens a just answered review inside its own study day', () => {
    const review = {
      state: 'review' as const,
      due: new Date(now.getTime() + 60_000),
      lastReview: now,
    };
    expect(availableForStudy(review, now, config)).toBe(false);
    expect(studyAvailableAt(review, config)).toEqual(new Date('2026-09-22T04:00:00Z'));
  });
});

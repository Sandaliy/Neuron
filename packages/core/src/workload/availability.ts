import { dayIndexOf, dayStartOf } from '../time/day.js';

import type { WorkloadCard, WorkloadReview } from './types.js';
import type { SchedulerConfig } from '../fsrs/parameters.js';
import type { SchedulingState } from '../fsrs/types.js';

/** Earliest eligibility instant, using the same study-day boundary as admission. */
export function studyAvailableAt(
  state: Pick<SchedulingState, 'state' | 'due'> & { lastReview?: Date | undefined },
  config: SchedulerConfig,
): Date {
  if (state.state !== 'review') return state.due;
  const dueDay = dayIndexOf(state.due, config);
  // A review interval may land on the answer's study day around a daylight-saving
  // change. Answering never makes that same review immediately due again.
  const nextAnswerDay = state.lastReview ? dayIndexOf(state.lastReview, config) + 1 : dueDay;
  return dayStartOf(Math.max(dueDay, nextAnswerDay), config);
}

/** Learning steps wait for their instant; reviews belong to a study day. */
export function availableForStudy(
  state: Pick<SchedulingState, 'state' | 'due'> & { lastReview?: Date | undefined },
  now: Date,
  config: SchedulerConfig,
): boolean {
  if (state.state === 'new') return true;
  if (state.state !== 'review') return state.due.getTime() <= now.getTime();
  return (
    Math.max(
      dayIndexOf(state.due, config),
      state.lastReview ? dayIndexOf(state.lastReview, config) + 1 : -Infinity,
    ) <= dayIndexOf(now, config)
  );
}

/** Answered cards may retry on schedule; unseen directions of their Note wait a study day. */
export interface StudyDayAnswers {
  readonly notes: ReadonlySet<string>;
  readonly cards: ReadonlySet<string>;
}

export function studyDayAnswers(
  cards: readonly WorkloadCard[],
  logs: readonly WorkloadReview[],
  now: Date,
  config: SchedulerConfig,
): StudyDayAnswers {
  const cardOf = new Map(cards.map((card) => [card.id, card]));
  const notes = new Set<string>();
  const answeredCards = new Set<string>();
  const today = dayIndexOf(now, config);
  for (const log of logs) {
    if (dayIndexOf(log.reviewedAt, config) !== today) continue;
    const current = cardOf.get(log.cardId);
    // Restart and Undo preserve history but can return the Card to New.
    if (current?.scheduling.state === 'new') continue;
    const noteId = log.noteId ?? current?.noteId;
    if (noteId) notes.add(noteId);
    answeredCards.add(log.cardId);
  }
  return { notes, cards: answeredCards };
}

export function dailyStudyAvailableAt(
  card: WorkloadCard,
  answers: StudyDayAnswers,
  now: Date,
  config: SchedulerConfig,
): Date {
  const scheduled = studyAvailableAt(card.scheduling, config);
  if (!answers.notes.has(card.noteId) || answers.cards.has(card.id)) return scheduled;
  return new Date(
    Math.max(scheduled.getTime(), dayStartOf(dayIndexOf(now, config) + 1, config).getTime()),
  );
}

export function availableForDailyStudy(
  card: WorkloadCard,
  answers: StudyDayAnswers,
  now: Date,
  config: SchedulerConfig,
): boolean {
  return (
    availableForStudy(card.scheduling, now, config) &&
    (!answers.notes.has(card.noteId) || answers.cards.has(card.id))
  );
}

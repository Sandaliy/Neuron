import { dayIndexOf, dayStartOf } from '../time/day.js';

import type { SchedulerConfig } from '../fsrs/parameters.js';
import type { SchedulingState } from '../fsrs/types.js';

/** Earliest eligibility instant, using the same study-day boundary as admission. */
export function studyAvailableAt(
  state: Pick<SchedulingState, 'state' | 'due'>,
  config: SchedulerConfig,
): Date {
  return state.state === 'review' ? dayStartOf(dayIndexOf(state.due, config), config) : state.due;
}

/** Learning steps wait for their instant; reviews belong to a study day. */
export function availableForStudy(
  state: Pick<SchedulingState, 'state' | 'due'>,
  now: Date,
  config: SchedulerConfig,
): boolean {
  if (state.state === 'new') return true;
  return state.state === 'review'
    ? dayIndexOf(state.due, config) <= dayIndexOf(now, config)
    : state.due.getTime() <= now.getTime();
}

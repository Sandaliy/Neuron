import { dayIndexOf } from '../time/day.js';

import type { SchedulerConfig } from '../fsrs/parameters.js';
import type { SchedulingState } from '../fsrs/types.js';

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

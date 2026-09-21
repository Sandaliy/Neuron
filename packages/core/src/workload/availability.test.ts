import { describe, expect, it } from 'vitest';

import { createSchedulerConfig } from '../fsrs/parameters.js';

import { availableForStudy, studyAvailableAt } from './availability.js';

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
});

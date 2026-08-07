import { describe, expect, it } from 'vitest';

import { createSchedulerConfig } from '../fsrs/parameters.js';
import { retrievability } from '../fsrs/scheduler.js';
import { MS_PER_DAY } from '../time/day.js';

import { buildRecoveryPlan, detectBacklog, orderBacklog, salvageValue } from './backlog.js';
import { createBudget } from './budget.js';
import { reviewCard } from './cards.js';
import { createWorkloadConfig } from './config.js';

import type { WorkloadCard } from './types.js';

const NOW = new Date('2026-08-05T12:00:00Z');

const config = createWorkloadConfig({
  scheduler: createSchedulerConfig({ enableFuzz: false, timezone: 'UTC', dayCutoffHour: 4 }),
});

/** Twenty minutes every day, so the trigger sits at an hour of overdue work. */
const budget = createBudget({ minutesByWeekday: [20, 20, 20, 20, 20, 20, 20] });

/** Cards that came due a given number of days ago. */
function overdueDeck(size: number, daysLate = 10): WorkloadCard[] {
  return Array.from({ length: size }, (_unused, index) =>
    reviewCard(
      { id: `late-${String(index).padStart(4, '0')}` },
      5 + (index % 30),
      new Date(NOW.getTime() - (daysLate + (index % 5)) * MS_PER_DAY),
    ),
  );
}

describe('noticing a backlog', () => {
  it('says nothing is wrong when there is nothing overdue', () => {
    const cards = [reviewCard({ id: 'a' }, 10, new Date(NOW.getTime() + MS_PER_DAY))];
    const state = detectBacklog(cards, budget, config, NOW);

    expect(state.active).toBe(false);
    expect(state.overdueCount).toBe(0);
    expect(state.overdueMinutes).toBe(0);
  });

  it('does not call a normal busy day a backlog', () => {
    // Ten overdue cards at six seconds each is one minute, against a trigger
    // of three times twenty.
    const state = detectBacklog(overdueDeck(10), budget, config, NOW);

    expect(state.active).toBe(false);
    expect(state.overdueCount).toBe(10);
  });

  it('calls it a backlog once the overdue work is worth three days of budget', () => {
    const state = detectBacklog(overdueDeck(800), budget, config, NOW);

    expect(state.active).toBe(true);
    expect(state.overdueMinutes).toBeGreaterThan(3 * 20);
    expect(state.budgetMinutes).toBe(20);
  });

  it('counts a card due today as work, not as a backlog', () => {
    const cards = Array.from({ length: 500 }, (_unused, index) =>
      reviewCard({ id: `today-${index}` }, 10, NOW),
    );

    expect(detectBacklog(cards, budget, config, NOW).active).toBe(false);
  });
});

describe('the plan out of it', () => {
  it('spreads the work over as many days as it takes', () => {
    const plan = buildRecoveryPlan(overdueDeck(800), budget, config, NOW);

    // Eighty minutes of work against twenty minutes a day.
    expect(plan.days).toBe(4);
    expect(plan.minutesPerDay).toBeCloseTo(20, 6);
    expect(plan.order).toHaveLength(800);
  });

  it('never asks for more than a fortnight', () => {
    const plan = buildRecoveryPlan(overdueDeck(20_000), budget, config, NOW);

    expect(plan.days).toBe(config.backlogMaximumDays);
    expect(plan.minutesPerDay).toBeGreaterThan(20);
  });

  it('gives an empty plan when there is nothing to recover', () => {
    const plan = buildRecoveryPlan([], budget, config, NOW);

    expect(plan).toEqual({ days: 0, minutesPerDay: 0, order: [] });
  });

  it('still produces a plan on a day with no budget at all', () => {
    const sundayOff = createBudget({ minutesByWeekday: [0, 20, 20, 20, 20, 20, 20] });
    const sunday = new Date('2026-08-09T12:00:00Z');
    const plan = buildRecoveryPlan(overdueDeck(800), sundayOff, config, sunday);

    expect(plan.days).toBe(config.backlogMaximumDays);
  });
});

describe('the three orderings', () => {
  const cards = overdueDeck(200);

  it('byDueDate puts the oldest first', () => {
    const ordered = orderBacklog(cards, 'byDueDate', config, NOW);
    const dueTimes = ordered.map((card) => card.scheduling.due.getTime());

    expect(dueTimes).toEqual([...dueTimes].sort((left, right) => left - right));
  });

  it('byRetrievability puts the closest to forgotten first', () => {
    const ordered = orderBacklog(cards, 'byRetrievability', config, NOW);
    const recall = ordered.map((card) => retrievability(card.scheduling, NOW, config.scheduler));

    expect(recall).toEqual([...recall].sort((left, right) => left - right));
  });

  it('bySalvageValue prefers the middle band over the safe and the lost', () => {
    // A card held for a year and a day overdue is still nearly certain.
    const safe = reviewCard({ id: 'safe' }, 365, new Date(NOW.getTime() - MS_PER_DAY));
    // The same card two months late is where reviewing pays most.
    const atRisk = reviewCard({ id: 'risk' }, 365, new Date(NOW.getTime() - 60 * MS_PER_DAY));
    // A card that never took hold, left for most of a year, is mostly gone.
    const lost = reviewCard({ id: 'lost' }, 0.5, new Date(NOW.getTime() - 200 * MS_PER_DAY));

    expect(salvageValue(atRisk, config, NOW)).toBeGreaterThan(salvageValue(safe, config, NOW));
    expect(salvageValue(atRisk, config, NOW)).toBeGreaterThan(salvageValue(lost, config, NOW));

    const ordered = orderBacklog([safe, lost, atRisk], 'bySalvageValue', config, NOW);

    expect(ordered[0]?.id).toBe('risk');
  });

  it('gives the same order on any device', () => {
    const shuffled = [...cards].reverse();

    for (const order of ['byDueDate', 'byRetrievability', 'bySalvageValue'] as const) {
      expect(orderBacklog(shuffled, order, config, NOW).map((card) => card.id)).toEqual(
        orderBacklog(cards, order, config, NOW).map((card) => card.id),
      );
    }
  });

  it('gives a new card no salvage value, because there is nothing to salvage', () => {
    const fresh: WorkloadCard = {
      id: 'fresh',
      noteId: 'note',
      direction: 'recall',
      scheduling: {
        state: 'new',
        stability: undefined,
        difficulty: undefined,
        lastReview: undefined,
        due: NOW,
        reps: 0,
        lapses: 0,
        learningStep: 0,
      },
    };

    expect(salvageValue(fresh, config, NOW)).toBe(0);
  });
});

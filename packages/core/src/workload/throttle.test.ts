import { describe, expect, it } from 'vitest';

import { createSchedulerConfig } from '../fsrs/parameters.js';
import { MS_PER_DAY } from '../time/day.js';

import { createBudget } from './budget.js';
import { reviewCard } from './cards.js';
import { createWorkloadConfig } from './config.js';
import { forecast } from './forecast.js';
import { marginalCostOfNewCard, newCardAllowance } from './throttle.js';

import type { BacklogState } from './backlog.js';
import type { WorkloadCard } from './types.js';

const NOW = new Date('2026-08-05T12:00:00Z');

const config = createWorkloadConfig({
  scheduler: createSchedulerConfig({ enableFuzz: false, timezone: 'UTC', dayCutoffHour: 4 }),
});

/** A flat budget, so the arithmetic in the tests is easy to follow. */
const budget = createBudget({ minutesByWeekday: [20, 20, 20, 20, 20, 20, 20] });

/** A deck of cards all due within the next fortnight. */
function busyDeck(size: number): WorkloadCard[] {
  return Array.from({ length: size }, (_unused, index) =>
    reviewCard(
      { id: `card-${index}` },
      3 + (index % 6),
      new Date(NOW.getTime() + (index % 14) * MS_PER_DAY),
    ),
  );
}

describe('what one new card costs', () => {
  it('is a real number of minutes a day', () => {
    const cost = marginalCostOfNewCard(config, [], NOW);

    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(1);
  });

  it('costs more for a card that takes longer to answer', () => {
    const cheap = marginalCostOfNewCard(config, [], NOW, 'recognition');
    const dear = marginalCostOfNewCard(config, [], NOW, 'production');

    expect(dear).toBeGreaterThan(cheap * 2);
  });

  it('costs more the shorter the horizon, because the learning steps are today', () => {
    const overTwoWeeks = marginalCostOfNewCard(config, [], NOW, 'recall', 14);
    const overTwoMonths = marginalCostOfNewCard(config, [], NOW, 'recall', 60);

    expect(overTwoWeeks).toBeGreaterThan(overTwoMonths);
  });
});

describe('how many new cards are allowed', () => {
  it('lets cards in when the fortnight ahead is empty', () => {
    // Twenty minutes a day, four fifths of which is sixteen. At two minutes a
    // day each, eight cards fit.
    const decision = newCardAllowance([], budget, 2, config, NOW);

    expect(decision.allowed).toBe(8);
    expect(decision.reason).toBe('withinBudget');
    expect(decision.headroomMinutes).toBeCloseTo(16, 6);
  });

  it('stops at the daily cap however much room there is', () => {
    const decision = newCardAllowance([], budget, 0.001, config, NOW);

    expect(decision.allowed).toBe(config.maximumNewCardsPerDay);
    expect(decision.reason).toBe('dailyCapReached');
  });

  it('stops completely once the forecast is at four fifths of the budget', () => {
    const tight = createBudget({ minutesByWeekday: [10, 10, 10, 10, 10, 10, 10] });
    const load = forecast({ cards: busyDeck(1500), config, now: NOW, horizonDays: 60 });
    const decision = newCardAllowance(load, tight, 0.3, config, NOW);

    expect(decision.allowed).toBe(0);
    expect(decision.reason).toBe('forecastOverBudget');
    expect(decision.headroomMinutes).toBeLessThan(0);
  });

  it('stops while a backlog is being worked through', () => {
    const backlog: BacklogState = {
      active: true,
      overdueCount: 200,
      overdueMinutes: 120,
      budgetMinutes: 20,
    };
    const decision = newCardAllowance([], budget, 0.3, config, NOW, backlog);

    expect(decision.allowed).toBe(0);
    expect(decision.reason).toBe('backlogActive');
  });

  it('lets fewer in as the collection fills up', () => {
    const light = newCardAllowance(
      forecast({ cards: busyDeck(50), config, now: NOW }),
      budget,
      2,
      config,
      NOW,
    );
    const heavy = newCardAllowance(
      forecast({ cards: busyDeck(400), config, now: NOW }),
      budget,
      2,
      config,
      NOW,
    );

    expect(heavy.allowed).toBeLessThan(light.allowed);
    expect(heavy.headroomMinutes).toBeLessThan(light.headroomMinutes);
  });

  it('reports the price it used, so the interface can explain the decision', () => {
    const decision = newCardAllowance([], budget, 0.42, config, NOW);

    expect(decision.marginalCost).toBe(0.42);
  });
});

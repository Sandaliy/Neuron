/**
 * How many new cards to let in today.
 *
 * Every other application asks the user for this number, which is a guess
 * about work that has not arrived yet. Twenty new cards a day sounds modest.
 * Six weeks later it is two hours an evening, and by then the cause and the
 * effect are too far apart for anybody to connect them.
 *
 * Here the number is derived instead. One new card is priced by running it
 * through the forecast on its own and asking what it adds to an average day.
 * That price is personal: it uses this person's answer speed and this person's
 * habit of pressing Again. Then the throttle asks how much room is left under
 * the budget and divides.
 *
 * The decision comes back with a reason on it rather than as a bare number,
 * because "no new cards today" needs an explanation the interface can show in
 * either language.
 */

import { newCard } from '../fsrs/types.js';
import { dayIndexOf } from '../time/day.js';

import { meanBudget, type Budget } from './budget.js';
import { forecast, meanMinutes, totalMinutes } from './forecast.js';

import type { BacklogState } from './backlog.js';
import type { WorkloadConfig } from './config.js';
import type { CardDirection, DailyLoad, WorkloadCard, WorkloadReview } from './types.js';

/** Why the throttle decided what it decided. */
export type NewCardReason =
  'withinBudget' | 'forecastOverBudget' | 'backlogActive' | 'dailyCapReached';

/** The throttle's answer, with its reasoning attached. */
export interface NewCardDecision {
  /** How many new cards may be introduced today. */
  readonly allowed: number;
  /** Minutes a day still free under the budget. Negative means over it. */
  readonly headroomMinutes: number;
  /** What one new card was priced at, in minutes a day. */
  readonly marginalCost: number;
  /** Why, as something the interface can translate. */
  readonly reason: NewCardReason;
}

/**
 * What one more new card costs, in minutes a day.
 *
 * The honest answer to "what does one more word actually cost me". A single
 * new card is walked through the forecast and everything it will cause over
 * the horizon, the learning steps today and every review it spawns after, is
 * added up and spread across the horizon.
 *
 * @param config the settings
 * @param logs the review log, read for answer speed and rating habits
 * @param now the moment being asked about
 * @param direction which kind of card is being priced
 * @param horizonDays how far ahead to count, defaulting to the settings
 * @returns minutes a day that one new card adds
 */
export function marginalCostOfNewCard(
  config: WorkloadConfig,
  logs: readonly WorkloadReview[],
  now: Date,
  direction: CardDirection = 'recall',
  horizonDays: number = config.horizonDays,
): number {
  const candidate: WorkloadCard = {
    id: 'marginal',
    noteId: 'marginal',
    direction,
    scheduling: newCard(now),
  };
  const load = forecast({
    cards: [],
    newCards: [candidate],
    config,
    now,
    horizonDays,
    logs,
  });

  return horizonDays > 0 ? totalMinutes(load) / horizonDays : 0;
}

/**
 * How many new cards fit under the budget today.
 *
 * The forecast is averaged over a fortnight rather than read off today,
 * because today is the one day whose load is already decided. What matters is
 * whether the fortnight ahead has room.
 *
 * @param load the forecast, starting today
 * @param budget the user's weekly budget
 * @param marginalCost what one new card costs, from
 *   {@link marginalCostOfNewCard}
 * @param config the settings
 * @param now the moment being asked about
 * @param backlog the backlog state, if it has been worked out already
 * @returns how many new cards to allow, and why
 */
export function newCardAllowance(
  load: readonly DailyLoad[],
  budget: Budget,
  marginalCost: number,
  config: WorkloadConfig,
  now: Date,
  backlog?: BacklogState,
): NewCardDecision {
  const window = config.throttleWindowDays;
  const meanLoad = meanMinutes(load, window);
  const ceiling =
    config.throttleThreshold * meanBudget(dayIndexOf(now, config.scheduler), window, budget);
  const headroomMinutes = ceiling - meanLoad;

  if (backlog?.active === true) {
    return { allowed: 0, headroomMinutes, marginalCost, reason: 'backlogActive' };
  }

  if (headroomMinutes <= 0) {
    return { allowed: 0, headroomMinutes, marginalCost, reason: 'forecastOverBudget' };
  }

  const affordable =
    marginalCost > 0 ? Math.floor(headroomMinutes / marginalCost) : config.maximumNewCardsPerDay;
  const allowed = Math.min(affordable, config.maximumNewCardsPerDay);

  return {
    allowed,
    headroomMinutes,
    marginalCost,
    reason: allowed < affordable ? 'dailyCapReached' : 'withinBudget',
  };
}

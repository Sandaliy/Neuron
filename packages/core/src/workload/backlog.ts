/**
 * Coming back after a month away.
 *
 * This is where most people quit. The app opens, it says 847 cards are due,
 * and that number is not a plan, it is a verdict. Nothing about it says which
 * of those 847 still matter or how long it would take to get straight.
 *
 * So a backlog is treated as its own state. Overdue work worth more than a few
 * days of budget stops being a to do list and becomes a recovery plan: how
 * many days it will take, how many minutes a day, and in what order. New cards
 * stop while it lasts, because adding to a pile you are already behind on is
 * the one thing that cannot help.
 */

import { retrievability } from '../fsrs/scheduler.js';
import { dayIndexOf } from '../time/day.js';

import { defaultAnswerTimes, type AnswerTimes } from './answer-time.js';
import { budgetFor, type Budget } from './budget.js';
import { answerSeconds } from './forecast.js';

import type { BacklogOrder, WorkloadConfig } from './config.js';
import type { CardId, WorkloadCard } from './types.js';

/** Seconds in a minute. */
const SECONDS_PER_MINUTE = 60;

/** Whether there is a backlog, and how big it is. */
export interface BacklogState {
  /** True once the overdue work is worth more than the trigger allows. */
  readonly active: boolean;
  /** How many cards are overdue. */
  readonly overdueCount: number;
  /** What they are worth in minutes, at this person's answer speed. */
  readonly overdueMinutes: number;
  /** Today's budget, which is what the overdue work is measured against. */
  readonly budgetMinutes: number;
}

/** A way out of a backlog. */
export interface RecoveryPlan {
  /** How many days it will take. */
  readonly days: number;
  /** How many minutes a day that works out at. */
  readonly minutesPerDay: number;
  /** The cards, in the order they should be worked through. */
  readonly order: readonly CardId[];
}

/** Every card that was due before today, in the order it was given. */
export function overdueCards(
  cards: readonly WorkloadCard[],
  config: WorkloadConfig,
  now: Date,
): WorkloadCard[] {
  const today = dayIndexOf(now, config.scheduler);

  return cards.filter(
    (card) =>
      card.scheduling.state !== 'new' && dayIndexOf(card.scheduling.due, config.scheduler) < today,
  );
}

/** What a pile of cards is worth in minutes at this person's answer speed. */
export function minutesForCards(cards: readonly WorkloadCard[], times: AnswerTimes): number {
  let seconds = 0;

  for (const card of cards) {
    seconds += answerSeconds(times, card.direction, card.scheduling.state);
  }

  return seconds / SECONDS_PER_MINUTE;
}

/**
 * Decides whether the overdue work counts as a backlog.
 *
 * @param cards the collection
 * @param budget the user's weekly budget
 * @param config the settings
 * @param now the moment being asked about
 * @param times measured answer times, defaulting to the untrained ones
 * @returns what is overdue and whether it has crossed the line
 */
export function detectBacklog(
  cards: readonly WorkloadCard[],
  budget: Budget,
  config: WorkloadConfig,
  now: Date,
  times: AnswerTimes = defaultAnswerTimes(config.answerSeconds),
): BacklogState {
  const overdue = overdueCards(cards, config, now);
  const overdueMinutes = minutesForCards(overdue, times);
  const budgetMinutes = budgetFor(now, budget, config.scheduler);

  return {
    active: overdueMinutes > config.backlogTrigger * budgetMinutes,
    overdueCount: overdue.length,
    overdueMinutes,
    budgetMinutes,
  };
}

/**
 * How much of a card's future is saved by reviewing it now.
 *
 * The heuristic behind the bySalvageValue ordering. Three ideas in one number.
 *
 * A card whose chance of recall is still near certain is safe. Leaving it a
 * few more days costs almost nothing, so it should not be at the front.
 *
 * A card that has fallen very low is mostly gone already. Reviewing it will
 * probably be a failure and a relearn either way, so pulling it forward buys
 * little.
 *
 * In between is where the work pays. Recall is still likely, so the answer
 * will probably be correct, and it is genuinely at risk, so being correct is
 * worth a lot. `R^2 * (1 - R)` peaks at two thirds, which is that band.
 *
 * The whole thing is scaled by the log of stability, because a card you have
 * held for a year has more invested in it than one you learned last week, but
 * not a hundred times more.
 *
 * Worth knowing: the third case is rarer than it sounds. The FSRS-6 curve has
 * such a long tail that a card worth a year is still around 0.86 after two
 * months of silence, and it takes something like ninety times its stability to
 * fall to a coin flip. In a real backlog the cards below two thirds are the
 * ones that never took hold in the first place, and this heuristic pushes
 * those to the back, which is the intended behaviour and not a rounding error.
 *
 * @param card the card
 * @param config the settings
 * @param now the moment being asked about
 * @returns a score, higher meaning review it sooner
 */
export function salvageValue(card: WorkloadCard, config: WorkloadConfig, now: Date): number {
  if (card.scheduling.state === 'new') {
    return 0;
  }

  const recall = retrievability(card.scheduling, now, config.scheduler);

  return Math.log1p(card.scheduling.stability) * recall * recall * (1 - recall);
}

/**
 * Puts cards in the order they should be worked through.
 *
 * Three strategies behind one interface. Which one is the default was settled
 * by running all three through the simulator against the same absence, not by
 * deciding which sounded cleverest.
 *
 * @param cards the cards to order
 * @param order which strategy to use
 * @param config the settings
 * @param now the moment being asked about
 * @returns the cards, in order
 */
export function orderBacklog(
  cards: readonly WorkloadCard[],
  order: BacklogOrder,
  config: WorkloadConfig,
  now: Date,
): WorkloadCard[] {
  const scored = cards.map((card) => ({ card, score: scoreFor(card, order, config, now) }));

  // The identifier breaks ties, so the order never depends on the order the
  // cards arrived in. Two devices given the same backlog produce the same plan.
  scored.sort((left, right) =>
    left.score === right.score
      ? left.card.id.localeCompare(right.card.id)
      : left.score - right.score,
  );

  return scored.map((entry) => entry.card);
}

/** The number a strategy sorts on, smallest first. */
function scoreFor(
  card: WorkloadCard,
  order: BacklogOrder,
  config: WorkloadConfig,
  now: Date,
): number {
  switch (order) {
    case 'byDueDate':
      return card.scheduling.due.getTime();

    case 'byRetrievability':
      return retrievability(card.scheduling, now, config.scheduler);

    case 'bySalvageValue':
      return -salvageValue(card, config, now);
  }
}

/**
 * Turns a backlog into a plan.
 *
 * @param cards the collection
 * @param budget the user's weekly budget
 * @param config the settings
 * @param now the moment being asked about
 * @param times measured answer times, defaulting to the untrained ones
 * @returns how long the recovery takes, and in what order
 */
export function buildRecoveryPlan(
  cards: readonly WorkloadCard[],
  budget: Budget,
  config: WorkloadConfig,
  now: Date,
  times: AnswerTimes = defaultAnswerTimes(config.answerSeconds),
): RecoveryPlan {
  const overdue = overdueCards(cards, config, now);
  const totalMinutes = minutesForCards(overdue, times);
  const daily = budgetFor(now, budget, config.scheduler);

  if (overdue.length === 0 || totalMinutes <= 0) {
    return { days: 0, minutesPerDay: 0, order: [] };
  }

  // A budget of zero would ask for an infinite number of days, so the cap
  // stands in for it. Somebody with no minutes today still gets a plan.
  const days =
    daily > 0
      ? Math.min(Math.ceil(totalMinutes / daily), config.backlogMaximumDays)
      : config.backlogMaximumDays;

  return {
    days,
    minutesPerDay: totalMinutes / days,
    order: orderBacklog(overdue, config.backlogOrder, config, now).map((card) => card.id),
  };
}

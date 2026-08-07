/**
 * The settings the workload manager runs on.
 *
 * The scheduler settings sit inside these rather than beside them: which day a
 * review belongs to has to be the same question for both, and there is no
 * sensible state of the world where the two disagree.
 */

import { createSchedulerConfig, type SchedulerConfig } from '../fsrs/parameters.js';

import { DEFAULT_ANSWER_SECONDS, type AnswerTimeDefaults } from './answer-time.js';
import { DEFAULT_BUDGET, createBudget, type Budget } from './budget.js';

/**
 * How the cards left in a backlog are put in order. Which one is the default
 * was decided by measurement, in the simulator, not by argument.
 */
export type BacklogOrder = 'byDueDate' | 'byRetrievability' | 'bySalvageValue';

/** Every ordering, for code that has to cover all of them. */
export const BACKLOG_ORDERS: readonly BacklogOrder[] = [
  'byDueDate',
  'byRetrievability',
  'bySalvageValue',
];

/** How far ahead the forecast looks by default. */
export const DEFAULT_HORIZON_DAYS = 60;

/** The window the throttle averages over when deciding about new cards. */
export const DEFAULT_THROTTLE_WINDOW_DAYS = 14;

/** The share of the budget at which new cards stop. */
export const DEFAULT_THROTTLE_THRESHOLD = 0.8;

/** New cards a day, whatever the arithmetic says. */
export const DEFAULT_MAXIMUM_NEW_CARDS_PER_DAY = 30;

/** How far either side of the ideal interval balancing may look. */
export const DEFAULT_LOAD_BALANCE_WINDOW = 0.1;

/** Overdue work worth more than this many days of budget is a backlog. */
export const DEFAULT_BACKLOG_TRIGGER = 3;

/** The longest a recovery plan may take. */
export const DEFAULT_BACKLOG_MAXIMUM_DAYS = 14;

/** Everything the workload manager needs besides the cards and the log. */
export interface WorkloadConfig {
  /** The scheduler settings, which also carry the timezone and day cutoff. */
  readonly scheduler: SchedulerConfig;
  /** Minutes of study offered, by weekday. */
  readonly budget: Budget;
  /** Seconds per answer to assume until enough answers have been measured. */
  readonly answerSeconds: AnswerTimeDefaults;
  /** How far ahead the forecast looks. */
  readonly horizonDays: number;
  /** How many days the throttle averages over. */
  readonly throttleWindowDays: number;
  /** The share of the budget at which new cards stop, 0 to 1. */
  readonly throttleThreshold: number;
  /** The most new cards a day, whatever the headroom says. */
  readonly maximumNewCardsPerDay: number;
  /**
   * Whether a due date may be moved to a less busy nearby day.
   *
   * Balancing replaces fuzz, it does not stack with it. Two independent
   * sources of jitter would fight each other and neither would land where it
   * meant to, so turning this on turns the scheduler's own fuzz off.
   */
  readonly enableLoadBalancing: boolean;
  /** How far either side of the ideal interval balancing may look, as a share. */
  readonly loadBalanceWindow: number;
  /** Overdue work worth this many days of budget counts as a backlog. */
  readonly backlogTrigger: number;
  /** The longest a recovery plan may take, in days. */
  readonly backlogMaximumDays: number;
  /** How the cards in a backlog are put in order. */
  readonly backlogOrder: BacklogOrder;
}

/** The settings as they arrive from storage or from a form. */
export interface WorkloadConfigInput extends Partial<Omit<WorkloadConfig, 'scheduler' | 'budget'>> {
  readonly scheduler?: SchedulerConfig;
  readonly budget?: Partial<Budget>;
}

/**
 * Builds the workload settings, checking every field.
 *
 * @param overrides the fields to change
 * @returns a frozen settings object
 * @throws RangeError if a field is outside the range it makes sense in
 */
export function createWorkloadConfig(overrides: WorkloadConfigInput = {}): WorkloadConfig {
  const enableLoadBalancing = overrides.enableLoadBalancing ?? true;
  const requested = overrides.scheduler ?? createSchedulerConfig();
  const scheduler =
    enableLoadBalancing && requested.enableFuzz
      ? createSchedulerConfig({ ...requested, enableFuzz: false })
      : requested;

  const horizonDays = overrides.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const throttleWindowDays = overrides.throttleWindowDays ?? DEFAULT_THROTTLE_WINDOW_DAYS;
  const throttleThreshold = overrides.throttleThreshold ?? DEFAULT_THROTTLE_THRESHOLD;
  const maximumNewCardsPerDay =
    overrides.maximumNewCardsPerDay ?? DEFAULT_MAXIMUM_NEW_CARDS_PER_DAY;
  const loadBalanceWindow = overrides.loadBalanceWindow ?? DEFAULT_LOAD_BALANCE_WINDOW;
  const backlogTrigger = overrides.backlogTrigger ?? DEFAULT_BACKLOG_TRIGGER;
  const backlogMaximumDays = overrides.backlogMaximumDays ?? DEFAULT_BACKLOG_MAXIMUM_DAYS;

  requireWholeNumberAbove('horizonDays', horizonDays, 1);
  requireWholeNumberAbove('throttleWindowDays', throttleWindowDays, 1);
  requireWholeNumberAbove('maximumNewCardsPerDay', maximumNewCardsPerDay, 0);
  requireWholeNumberAbove('backlogMaximumDays', backlogMaximumDays, 1);

  if (!Number.isFinite(throttleThreshold) || throttleThreshold <= 0 || throttleThreshold > 1) {
    throw new RangeError(`throttleThreshold must be between 0 and 1, got ${throttleThreshold}.`);
  }

  if (!Number.isFinite(loadBalanceWindow) || loadBalanceWindow < 0 || loadBalanceWindow > 0.5) {
    throw new RangeError(`loadBalanceWindow must be between 0 and 0.5, got ${loadBalanceWindow}.`);
  }

  if (!Number.isFinite(backlogTrigger) || backlogTrigger <= 0) {
    throw new RangeError(`backlogTrigger must be above zero, got ${backlogTrigger}.`);
  }

  return Object.freeze({
    scheduler,
    budget: createBudget(overrides.budget ?? DEFAULT_BUDGET),
    answerSeconds: overrides.answerSeconds ?? DEFAULT_ANSWER_SECONDS,
    horizonDays,
    throttleWindowDays,
    throttleThreshold,
    maximumNewCardsPerDay,
    enableLoadBalancing,
    loadBalanceWindow,
    backlogTrigger,
    backlogMaximumDays,
    backlogOrder: overrides.backlogOrder ?? 'byDueDate',
  });
}

/**
 * Checks that a setting is a whole number at or above a floor.
 *
 * @param label the field name, for the error message
 * @param value the value given
 * @param least the smallest value allowed
 * @throws RangeError if the value is not a whole number at or above the floor
 */
function requireWholeNumberAbove(label: string, value: number, least: number): void {
  if (!Number.isInteger(value) || value < least) {
    throw new RangeError(`${label} must be a whole number of at least ${least}, got ${value}.`);
  }
}

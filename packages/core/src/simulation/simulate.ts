/**
 * A year of study, run in a second.
 *
 * This is what makes the rest of the package checkable. A scheduling policy
 * cannot be judged by reading it: the whole trouble with a fixed daily limit
 * is that its consequences arrive two months later, which is exactly the
 * distance a person cannot see across and a simulation can.
 *
 * The learner is the same under every policy, down to the seed, so a
 * difference in the tables is the policy and nothing else. Read ./learner.ts
 * for who that learner is and, more importantly, for what this cannot tell
 * you.
 */

import { MS_PER_HOUR, dayIndexOf, dayStartOf } from '../time/day.js';
import { estimateAnswerTimes, type AnswerTimes } from '../workload/answer-time.js';
import { overdueCards } from '../workload/backlog.js';
import { balanceReview } from '../workload/balance.js';
import { budgetFor, type Budget } from '../workload/budget.js';
import { forecast, scheduledLoad } from '../workload/forecast.js';
import { buildSession } from '../workload/session.js';
import { marginalCostOfNewCard } from '../workload/throttle.js';

import { answerCard, studiesToday, type LearnerProfile } from './learner.js';

import type { RandomSource } from '../fsrs/random.js';
import type { WorkloadConfig } from '../workload/config.js';
import type { DailyLoad, WorkloadCard, WorkloadReview } from '../workload/types.js';

/** Stability above this counts as knowing the card. */
export const KNOWN_STABILITY_DAYS = 21;

/** How many reviews the estimator is allowed to remember. */
const RECENT_LOG_SIZE = 2000;

/** How often the answer time table is measured again. */
const REMEASURE_EVERY_DAYS = 7;

/** How far ahead the balancer looks at what is already booked. */
const BALANCE_HORIZON_DAYS = 90;

/** Milliseconds in a minute. */
const MS_PER_MINUTE = 60_000;

/**
 * How the run decides on new cards.
 *
 * `fixed` is how every other application works, and how this one would work if
 * it asked for a number of cards: a set number of new cards a day, and every
 * review that is due gets done however long that takes.
 *
 * `adaptive` is the policy this package exists to test: a session that stops
 * at the budget, and new cards only while the forecast says there is room.
 */
export type NewCardPolicy =
  { readonly kind: 'fixed'; readonly perDay: number } | { readonly kind: 'adaptive' };

/** A stretch of days the learner is away. */
export interface Absence {
  readonly startDay: number;
  readonly days: number;
}

/** Everything a run needs. */
export interface SimulationOptions {
  /** A name for the tables and the charts. */
  readonly label: string;
  /** How many cards are waiting to be learned. */
  readonly deckSize: number;
  /** How many days to run. */
  readonly days: number;
  /** When the run starts. */
  readonly start: Date;
  /** The settings. */
  readonly config: WorkloadConfig;
  /** The minutes the learner has offered. */
  readonly budget: Budget;
  /** Who is studying. */
  readonly learner: LearnerProfile;
  /** How new cards are let in. */
  readonly policy: NewCardPolicy;
  /** A holiday, an illness, a month of not opening the application. */
  readonly absence?: Absence;
}

/** What happened on one day. */
export interface SimulationDay {
  readonly day: number;
  readonly date: Date;
  readonly minutes: number;
  readonly reviews: number;
  readonly newCards: number;
  /** Cards whose stability is above three weeks. */
  readonly known: number;
  /** Cards that were due before today and have not been answered. */
  readonly backlog: number;
  /** The share of review cards recalled today, or null if none were asked. */
  readonly retention: number | null;
  /** The budget that day, so a chart can draw the line it is meant to stay under. */
  readonly budgetMinutes: number;
}

/** The whole run in a handful of numbers. */
export interface SimulationSummary {
  readonly label: string;
  readonly totalMinutes: number;
  readonly totalReviews: number;
  readonly newCardsIntroduced: number;
  readonly knownAtEnd: number;
  readonly meanMinutes: number;
  readonly medianMinutes: number;
  readonly peakMinutes: number;
  readonly minutesAroundDay90: number;
  readonly minutesAtEnd: number;
  readonly retention: number;
  readonly backlogAtEnd: number;
  readonly daysStudied: number;
  readonly daysOverBudget: number;
  /** Averaged over every day of the run, how far past the budget it went. */
  readonly meanOvershootMinutes: number;
}

/** A finished run. */
export interface SimulationResult {
  readonly label: string;
  readonly days: readonly SimulationDay[];
  readonly summary: SimulationSummary;
}

/**
 * The three cards a vocabulary note turns into.
 *
 * A word is not one thing to know. Recognising it when you see it, producing
 * it when you want it, and typing it correctly are three different memories
 * that decay at their own rates, and they take four, seven and fourteen
 * seconds to answer. A simulation built on one average card would flatter
 * every policy in it.
 */
const DECK_DIRECTIONS = ['recognition', 'recall', 'production'] as const;

/** Builds a deck of untouched cards, three directions to each note. */
function buildDeck(size: number, createdAt: Date): WorkloadCard[] {
  return Array.from({ length: size }, (_unused, index) => ({
    id: `card-${String(index).padStart(5, '0')}`,
    noteId: `note-${String(Math.floor(index / DECK_DIRECTIONS.length)).padStart(5, '0')}`,
    direction: DECK_DIRECTIONS[index % DECK_DIRECTIONS.length] ?? 'recall',
    scheduling: {
      state: 'new' as const,
      stability: undefined,
      difficulty: undefined,
      lastReview: undefined,
      due: createdAt,
      reps: 0,
      lapses: 0,
      learningStep: 0,
    },
  }));
}

/** The middle value of a list of numbers. */
function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** The mean of the days in a window around a given day of the run. */
function meanAround(days: readonly SimulationDay[], day: number, reach = 7): number {
  const window = days.filter((entry) => Math.abs(entry.day - day) <= reach);

  if (window.length === 0) {
    return 0;
  }

  return window.reduce((total, entry) => total + entry.minutes, 0) / window.length;
}

/**
 * Decides what today's session holds.
 *
 * The two policies part company here and nowhere else. Everything after this
 * point, the answering, the memory model, the log, is identical.
 */
function sessionFor(
  cards: readonly WorkloadCard[],
  options: SimulationOptions,
  times: AnswerTimes,
  logs: readonly WorkloadReview[],
  now: Date,
  rng: RandomSource,
): readonly WorkloadCard[] {
  const { config, budget, policy } = options;

  if (policy.kind === 'fixed') {
    const today = dayIndexOf(now, config.scheduler);
    const due = cards
      .filter(
        (card) =>
          card.scheduling.state !== 'new' &&
          dayIndexOf(card.scheduling.due, config.scheduler) <= today,
      )
      .sort((left, right) => left.scheduling.due.getTime() - right.scheduling.due.getTime());
    const fresh = cards.filter((card) => card.scheduling.state === 'new').slice(0, policy.perDay);

    return [...due, ...fresh];
  }

  const load = forecast({
    cards,
    config,
    now,
    horizonDays: config.throttleWindowDays,
    times,
    logs,
  });

  return buildSession({
    cards,
    budget,
    config,
    now,
    rng,
    load,
    logs,
    times,
    marginalCost: marginalCostOfNewCard(config, logs, now),
  }).cards;
}

/**
 * Runs one virtual year.
 *
 * @param options the deck, the policy, the learner and the settings
 * @param rng the seeded generator, which everything random draws from
 * @returns every day of the run and the summary of it
 */
export function simulate(options: SimulationOptions, rng: RandomSource): SimulationResult {
  const { config, budget, learner } = options;
  const cards = buildDeck(options.deckSize, options.start);
  const positionOf = new Map<string, number>(cards.map((card, index) => [card.id, index]));
  const recent: WorkloadReview[] = [];
  const days: SimulationDay[] = [];
  const firstDay = dayIndexOf(options.start, config.scheduler);

  let times: AnswerTimes = estimateAnswerTimes(recent, config.answerSeconds);
  let totalRecalled = 0;
  let totalTested = 0;
  let newCardsIntroduced = 0;

  for (let day = 0; day < options.days; day += 1) {
    // Midday, so that nothing in the run sits on a day boundary.
    const now = new Date(dayStartOf(firstDay + day, config.scheduler).getTime() + 12 * MS_PER_HOUR);
    const away =
      options.absence !== undefined &&
      day >= options.absence.startDay &&
      day < options.absence.startDay + options.absence.days;
    const studies = !away && studiesToday(learner, rng);

    if (day % REMEASURE_EVERY_DAYS === 0 && recent.length > 0) {
      times = estimateAnswerTimes(recent, config.answerSeconds);
    }

    let minutes = 0;
    let reviews = 0;
    let introduced = 0;
    let recalledToday = 0;
    let testedToday = 0;

    if (studies) {
      // What is already booked on the days ahead, read once for the session
      // rather than once for every card, which is what the application does
      // too.
      const bookings: DailyLoad[] = scheduledLoad(cards, config, now, BALANCE_HORIZON_DAYS, times);

      for (const chosen of sessionFor(cards, options, times, recent, now, rng)) {
        const position = positionOf.get(chosen.id);
        const card = position === undefined ? undefined : cards[position];

        if (position === undefined || card === undefined) {
          continue;
        }

        const answer = answerCard(
          card.scheduling,
          card.direction,
          now,
          learner,
          config.scheduler,
          rng,
        );

        if (card.scheduling.state === 'new') {
          introduced += 1;
          newCardsIntroduced += 1;
        } else if (card.scheduling.state === 'review') {
          testedToday += 1;
          recalledToday += answer.recalled ? 1 : 0;
        }

        const outcome = balanceReview(
          card.scheduling,
          answer.rating,
          now,
          bookings,
          config,
          rng,
          answer.durationMs,
        );

        cards[position] = { ...card, scheduling: outcome.next };
        recent.push({ ...outcome.log, cardId: card.id, direction: card.direction });

        if (recent.length > RECENT_LOG_SIZE) {
          recent.splice(0, recent.length - RECENT_LOG_SIZE);
        }

        minutes += answer.durationMs / MS_PER_MINUTE;
        reviews += 1;
      }
    }

    totalRecalled += recalledToday;
    totalTested += testedToday;

    days.push({
      day,
      date: now,
      minutes,
      reviews,
      newCards: introduced,
      known: countKnown(cards),
      backlog: overdueCards(cards, config, now).length,
      retention: testedToday === 0 ? null : recalledToday / testedToday,
      budgetMinutes: budgetFor(now, budget, config.scheduler),
    });
  }

  return {
    label: options.label,
    days,
    summary: summarise(options.label, days, {
      newCardsIntroduced,
      retention: totalTested === 0 ? 0 : totalRecalled / totalTested,
    }),
  };
}

/** How many cards have crossed the three week mark. */
function countKnown(cards: readonly WorkloadCard[]): number {
  let known = 0;

  for (const card of cards) {
    if (card.scheduling.state !== 'new' && card.scheduling.stability > KNOWN_STABILITY_DAYS) {
      known += 1;
    }
  }

  return known;
}

/** Rolls a finished run up into the numbers the tables print. */
function summarise(
  label: string,
  days: readonly SimulationDay[],
  totals: { newCardsIntroduced: number; retention: number },
): SimulationSummary {
  const minutesPerDay = days.map((entry) => entry.minutes);
  const totalMinutes = minutesPerDay.reduce((total, value) => total + value, 0);
  const last = days[days.length - 1];

  return {
    label,
    totalMinutes,
    totalReviews: days.reduce((total, entry) => total + entry.reviews, 0),
    newCardsIntroduced: totals.newCardsIntroduced,
    knownAtEnd: last?.known ?? 0,
    meanMinutes: totalMinutes / (days.length || 1),
    medianMinutes: median(minutesPerDay),
    peakMinutes: minutesPerDay.length === 0 ? 0 : Math.max(...minutesPerDay),
    minutesAroundDay90: meanAround(days, 90),
    minutesAtEnd: meanAround(days, last?.day ?? 0),
    retention: totals.retention,
    backlogAtEnd: last?.backlog ?? 0,
    daysStudied: days.filter((entry) => entry.reviews > 0).length,
    daysOverBudget: days.filter((entry) => entry.minutes > entry.budgetMinutes).length,
    meanOvershootMinutes:
      days.reduce((total, entry) => total + Math.max(entry.minutes - entry.budgetMinutes, 0), 0) /
      (days.length || 1),
  };
}

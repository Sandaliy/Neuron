/**
 * A year of study, run in a few seconds.
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
 *
 * What is measured deserves a note of its own. Words learned per minute is a
 * property of the memory model rather than of the policy that rations it, and
 * the runs bear that out: the two policies come out level on it. Where they
 * differ is the shape of the load. The worst day, the worst week, how far past
 * the promise an ordinary day goes, how long a return from three weeks away
 * takes. Those are the numbers in {@link SimulationSummary}, and they are the
 * ones a person actually lives through.
 */

import { MS_PER_HOUR, dayIndexOf, dayStartOf } from '../time/day.js';
import { estimateAnswerTimes, type AnswerTimes } from '../workload/answer-time.js';
import { overdueCards } from '../workload/backlog.js';
import { balanceReview } from '../workload/balance.js';
import { budgetFor, type Budget } from '../workload/budget.js';
import { THROTTLE_PRUNE_WEIGHT, forecast, scheduledLoad } from '../workload/forecast.js';
import { buildSession } from '../workload/session.js';
import { marginalCostOfNewCard } from '../workload/throttle.js';

import {
  DEFAULT_DROPOUT,
  answerCard,
  studiesToday,
  type DropoutModel,
  type LearnerProfile,
} from './learner.js';

import type { RandomSource } from '../fsrs/random.js';
import type { WorkloadConfig } from '../workload/config.js';
import type { CardDirection, DailyLoad, WorkloadCard, WorkloadReview } from '../workload/types.js';

/** Stability above this counts as knowing the card. */
export const KNOWN_STABILITY_DAYS = 21;

/** How many reviews the estimator is allowed to remember. */
const RECENT_LOG_SIZE = 2000;

/** How often the answer times and the price of a new card are worked out again. */
const REMEASURE_EVERY_DAYS = 7;

/** How far ahead the balancer looks at what is already booked. */
const BALANCE_HORIZON_DAYS = 90;

/** The window a recovery is judged over, so one day off does not count as one. */
const RECOVERY_WINDOW_DAYS = 7;

/** Milliseconds in a minute. */
const MS_PER_MINUTE = 60_000;

/** Seconds in a minute. */
const SECONDS_PER_MINUTE = 60;

/**
 * How the run decides on new cards.
 *
 * `fixed` is how every other application works: each deck hands out its own
 * number of new cards a day, and every review that comes due gets done however
 * long that takes.
 *
 * `adaptive` is the policy this package exists to test: a session that stops at
 * the budget, and new cards only while the forecast says there is room.
 */
export type NewCardPolicy = { readonly kind: 'fixed' } | { readonly kind: 'adaptive' };

/** A stretch of days the learner is away. */
export interface Absence {
  readonly startDay: number;
  readonly days: number;
}

/** One deck in the collection. */
export interface DeckSpec {
  /** A short name, used in card identifiers and in the tables. */
  readonly id: string;
  /** How many notes it holds. */
  readonly notes: number;
  /** Which cards each note turns into. */
  readonly directions: readonly CardDirection[];
  /** New cards a day from this deck, in the fixed arm only. */
  readonly newPerDay: number;
}

/** Everything a run needs. */
export interface SimulationOptions {
  /** A name for the tables and the charts. */
  readonly label: string;
  /** The collection, one entry per deck. */
  readonly decks: readonly DeckSpec[];
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
  /** Holidays, illnesses, months of not opening the application. */
  readonly absences?: readonly Absence[];
  /** The attendance assumption. Defaults to one where overload changes nothing. */
  readonly dropout?: DropoutModel;
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
  /** What the day looked like at the moment the application was opened. */
  readonly offeredMinutes: number;
  /** True when the policy would allow no new cards while new cards remain. */
  readonly newCardsStalled: boolean;
  /** True when nothing was studied, whether by choice or by absence. */
  readonly skipped: boolean;
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
  readonly retention: number;
  readonly backlogAtEnd: number;
  readonly daysStudied: number;

  /** The worst single day of the run. */
  readonly peakDailyMinutes: number;
  /** The day only one in twenty is worse than. */
  readonly p95DailyMinutes: number;
  /** How much the daily load moves about. */
  readonly dailyMinutesStdDev: number;
  /** Days that went past the budget at all. */
  readonly daysOverBudget: number;
  /** Days that went past twice the budget. */
  readonly daysOverDoubleBudget: number;
  /** The heaviest seven days in a row. */
  readonly worstWeekMinutes: number;
  /** Averaged over every day of the run, how far past the budget it went. */
  readonly meanOvershootMinutes: number;
  /** Per absence, days until the load came back inside the budget. */
  readonly daysToRecover: readonly (number | null)[];
  /** Days the policy held new cards back while there were still new cards. */
  readonly newCardsStalledDays: number;
  /** The day the collection was abandoned, or null if it never was. */
  readonly abandonedOnDay: number | null;
}

/** A finished run. */
export interface SimulationResult {
  readonly label: string;
  readonly days: readonly SimulationDay[];
  readonly summary: SimulationSummary;
}

/** What one day's session came to, before any of it is answered. */
interface PlannedSession {
  readonly cards: readonly WorkloadCard[];
  /** How many new cards the policy allowed, or null when it does not ration them. */
  readonly newCardsAllowed: number | null;
}

/** Builds the collection: one card per direction per note, deck by deck. */
function buildDeck(decks: readonly DeckSpec[], createdAt: Date): WorkloadCard[] {
  const cards: WorkloadCard[] = [];

  for (const deck of decks) {
    for (let note = 0; note < deck.notes; note += 1) {
      const noteId = `${deck.id}-${String(note).padStart(5, '0')}`;

      for (const direction of deck.directions) {
        cards.push({
          id: `${noteId}-${direction}`,
          noteId,
          direction,
          scheduling: {
            state: 'new',
            stability: undefined,
            difficulty: undefined,
            lastReview: undefined,
            due: createdAt,
            reps: 0,
            lapses: 0,
            learningStep: 0,
          },
        });
      }
    }
  }

  return cards;
}

/** Which deck a card belongs to, read back off its identifier. */
function deckOf(card: WorkloadCard): string {
  const cut = card.id.indexOf('-');

  return cut < 0 ? card.id : card.id.slice(0, cut);
}

/** The value a given share of the list is at or below. */
function percentile(values: readonly number[], share: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.min(Math.max(Math.ceil(share * sorted.length) - 1, 0), sorted.length - 1);

  return sorted[rank] ?? 0;
}

/** How far the daily load moves about, in minutes. */
function standardDeviation(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const variance =
    values.reduce((total, value) => total + (value - mean) * (value - mean), 0) / values.length;

  return Math.sqrt(variance);
}

/** The heaviest run of seven days anywhere in the year. */
function worstWeek(values: readonly number[]): number {
  let running = 0;
  let worst = 0;

  for (const [index, value] of values.entries()) {
    running += value;

    if (index >= RECOVERY_WINDOW_DAYS) {
      running -= values[index - RECOVERY_WINDOW_DAYS] ?? 0;
    }

    worst = Math.max(worst, running);
  }

  return worst;
}

/**
 * How long it took to get back inside the budget after an absence.
 *
 * Judged on a trailing week rather than on a single day, because one day off
 * would otherwise read as a recovery and one heavy Saturday as a relapse.
 *
 * @param days every day of the run
 * @param absence the absence being asked about
 * @returns days from the return until the week's work fits the week's budget,
 *   or null if the run ended still behind
 */
function daysToRecover(days: readonly SimulationDay[], absence: Absence): number | null {
  const back = absence.startDay + absence.days;

  for (let day = back; day < days.length; day += 1) {
    const window = days.slice(Math.max(back, day - RECOVERY_WINDOW_DAYS + 1), day + 1);
    const load = window.reduce((total, entry) => total + entry.minutes, 0);
    const budget = window.reduce((total, entry) => total + entry.budgetMinutes, 0);

    if (window.length >= Math.min(RECOVERY_WINDOW_DAYS, days.length - back) && load <= budget) {
      return day - back;
    }
  }

  return null;
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
  marginalCost: number,
  now: Date,
  rng: RandomSource,
): PlannedSession {
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

    // Every deck hands out its own allowance, which is the failure the three
    // deck scenario exists to show: each one is reasonable and the total is not.
    const takenFrom = new Map<string, number>();
    const fresh: WorkloadCard[] = [];

    for (const card of cards) {
      if (card.scheduling.state !== 'new') {
        continue;
      }

      const deck = deckOf(card);
      const limit = options.decks.find((entry) => entry.id === deck)?.newPerDay ?? 0;
      const taken = takenFrom.get(deck) ?? 0;

      if (taken < limit) {
        takenFrom.set(deck, taken + 1);
        fresh.push(card);
      }
    }

    return { cards: [...due, ...fresh], newCardsAllowed: null };
  }

  const load = forecast({
    cards,
    config,
    now,
    horizonDays: config.throttleWindowDays,
    times,
    logs,
    pruneWeight: THROTTLE_PRUNE_WEIGHT,
  });
  const session = buildSession({
    cards,
    budget,
    config,
    now,
    rng,
    load,
    logs,
    times,
    marginalCost,
  });

  return { cards: session.cards, newCardsAllowed: session.newCards.allowed };
}

/** What the day looks like at the moment the application is opened. */
function offeredMinutes(
  cards: readonly WorkloadCard[],
  options: SimulationOptions,
  times: AnswerTimes,
  budgetMinutes: number,
  now: Date,
): number {
  const today = dayIndexOf(now, options.config.scheduler);
  let seconds = 0;

  for (const card of cards) {
    if (
      card.scheduling.state !== 'new' &&
      dayIndexOf(card.scheduling.due, options.config.scheduler) <= today
    ) {
      seconds += times[card.direction][card.scheduling.state];
    }
  }

  const due = seconds / SECONDS_PER_MINUTE;

  // Under the adaptive policy what is offered is a session rather than a pile,
  // so that is what the learner sees and reacts to.
  return options.policy.kind === 'adaptive' ? Math.min(due, budgetMinutes) : due;
}

/**
 * Runs one virtual year.
 *
 * @param options the collection, the policy, the learner and the settings
 * @param rng the seeded generator, which everything random draws from
 * @returns every day of the run and the summary of it
 */
export function simulate(options: SimulationOptions, rng: RandomSource): SimulationResult {
  const { config, budget, learner } = options;
  const dropout = options.dropout ?? DEFAULT_DROPOUT;
  const absences = options.absences ?? [];
  const cards = buildDeck(options.decks, options.start);
  const positionOf = new Map<string, number>(cards.map((card, index) => [card.id, index]));
  const recent: WorkloadReview[] = [];
  const days: SimulationDay[] = [];
  const firstDay = dayIndexOf(options.start, config.scheduler);

  let times: AnswerTimes = estimateAnswerTimes(recent, config.answerSeconds);
  let marginalCost = marginalCostOfNewCard(config, recent, options.start);
  let totalRecalled = 0;
  let totalTested = 0;
  let newCardsIntroduced = 0;
  let skippedInARow = 0;
  let abandonedOnDay: number | null = null;

  for (let day = 0; day < options.days; day += 1) {
    // Midday, so that nothing in the run sits on a day boundary.
    const now = new Date(dayStartOf(firstDay + day, config.scheduler).getTime() + 12 * MS_PER_HOUR);
    const budgetMinutes = budgetFor(now, budget, config.scheduler);
    const away = absences.some(
      (absence) => day >= absence.startDay && day < absence.startDay + absence.days,
    );

    if (day % REMEASURE_EVERY_DAYS === 0 && recent.length > 0) {
      times = estimateAnswerTimes(recent, config.answerSeconds);
      marginalCost = marginalCostOfNewCard(config, recent, now);
    }

    const offered = offeredMinutes(cards, options, times, budgetMinutes, now);
    const studies =
      !away && abandonedOnDay === null && studiesToday(dropout, offered, budgetMinutes, rng);

    // A holiday is a fact of the scenario, not evidence of having given up, so
    // days away neither count towards abandonment nor clear the count. Only
    // days somebody could have studied and did not say anything about whether
    // they are still doing this.
    if (!away) {
      if (studies) {
        skippedInARow = 0;
      } else {
        skippedInARow += 1;

        if (abandonedOnDay === null && skippedInARow >= dropout.abandonAfterSkippedDays) {
          abandonedOnDay = day;
        }
      }
    }

    let minutes = 0;
    let reviews = 0;
    let introduced = 0;
    let recalledToday = 0;
    let testedToday = 0;
    let stalled = false;

    if (studies) {
      // What is already booked on the days ahead, read once for the session
      // rather than once for every card, which is what the application does
      // too.
      const bookings: DailyLoad[] = scheduledLoad(cards, config, now, BALANCE_HORIZON_DAYS, times);
      const planned = sessionFor(cards, options, times, recent, marginalCost, now, rng);

      stalled =
        planned.newCardsAllowed === 0 && cards.some((card) => card.scheduling.state === 'new');

      for (const chosen of planned.cards) {
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
      budgetMinutes,
      offeredMinutes: offered,
      newCardsStalled: stalled,
      skipped: !studies,
    });
  }

  return {
    label: options.label,
    days,
    summary: summarise(options.label, days, absences, {
      newCardsIntroduced,
      retention: totalTested === 0 ? 0 : totalRecalled / totalTested,
      abandonedOnDay,
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
  absences: readonly Absence[],
  totals: { newCardsIntroduced: number; retention: number; abandonedOnDay: number | null },
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
    medianMinutes: percentile(minutesPerDay, 0.5),
    retention: totals.retention,
    backlogAtEnd: last?.backlog ?? 0,
    daysStudied: days.filter((entry) => !entry.skipped).length,

    peakDailyMinutes: minutesPerDay.length === 0 ? 0 : Math.max(...minutesPerDay),
    p95DailyMinutes: percentile(minutesPerDay, 0.95),
    dailyMinutesStdDev: standardDeviation(minutesPerDay),
    daysOverBudget: days.filter((entry) => entry.minutes > entry.budgetMinutes).length,
    daysOverDoubleBudget: days.filter((entry) => entry.minutes > entry.budgetMinutes * 2).length,
    worstWeekMinutes: worstWeek(minutesPerDay),
    meanOvershootMinutes:
      days.reduce((total, entry) => total + Math.max(entry.minutes - entry.budgetMinutes, 0), 0) /
      (days.length || 1),
    daysToRecover: absences.map((absence) => daysToRecover(days, absence)),
    newCardsStalledDays: days.filter((entry) => entry.newCardsStalled).length,
    abandonedOnDay: totals.abandonedOnDay,
  };
}

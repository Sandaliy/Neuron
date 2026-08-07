/**
 * What you are actually shown when you press Study.
 *
 * Everything else in this package decides how much work there should be. This
 * decides which cards, in which order, and it is the only part the person ever
 * sees directly.
 *
 * The rules it follows are all about the shape of a session rather than the
 * memory model.
 *
 * Reviews come first and new cards fill what is left. Work already owed beats
 * work volunteered for.
 *
 * New cards are spread through the first two thirds instead of sitting at the
 * front. A block of unfamiliar cards at the start is where sessions get
 * abandoned, and the last third is where attention is thinnest, which is the
 * worst place to meet something new.
 *
 * Two cards of the same note never appear together. The second would be a hint
 * rather than a test: you have just seen the answer.
 *
 * Three hard cards in a row are broken up. Difficulty above 8 means a card
 * this person keeps failing, and a run of them reads as a wall.
 *
 * Overdue cards are mixed in rather than piled at the front, so a session
 * after a week away does not start with the worst of it.
 *
 * The session ends on a whole card. Stopping halfway through one to respect a
 * budget to the second would be worse than going twenty seconds over.
 */

import { retrievability } from '../fsrs/scheduler.js';
import { dayIndexOf } from '../time/day.js';

import { defaultAnswerTimes, type AnswerTimes } from './answer-time.js';
import { detectBacklog, orderBacklog, type BacklogState } from './backlog.js';
import { budgetFor, carryOverMinutes, type Budget } from './budget.js';
import { answerSeconds } from './forecast.js';
import { marginalCostOfNewCard, newCardAllowance, type NewCardDecision } from './throttle.js';

import type { WorkloadConfig } from './config.js';
import type { DailyLoad, WorkloadCard, WorkloadReview } from './types.js';
import type { RandomSource } from '../fsrs/random.js';

/** Seconds in a minute. */
const SECONDS_PER_MINUTE = 60;

/** Difficulty above this counts as a hard card for the purpose of runs. */
const HARD_DIFFICULTY = 8;

/** How many hard cards may sit next to each other. */
const MAX_HARD_RUN = 2;

/** The share of the session new cards are spread across. */
const NEW_CARD_SPREAD = 2 / 3;

/** How long a session should be, and whether it may introduce anything. */
export interface SessionPreset {
  /** Minutes to aim for, or null to use whatever the day's budget allows. */
  readonly minutes: number | null;
  /** Whether new cards may be introduced in this session. */
  readonly allowNewCards: boolean;
}

/** A normal session: the day's budget, new cards welcome. */
export const DEFAULT_SESSION_PRESET: SessionPreset = Object.freeze({
  minutes: null,
  allowNewCards: true,
});

/** Everything the session builder needs. */
export interface SessionRequest {
  /** The collection. */
  readonly cards: readonly WorkloadCard[];
  /** The user's weekly budget. */
  readonly budget: Budget;
  /** The settings. */
  readonly config: WorkloadConfig;
  /** The moment the session starts. */
  readonly now: Date;
  /** A seeded generator, used to break ties. */
  readonly rng: RandomSource;
  /** How long the session should be. Defaults to the day's budget. */
  readonly preset?: SessionPreset;
  /** The forecast, so the throttle can see whether there is room. */
  readonly load?: readonly DailyLoad[];
  /** The review log, read for answer speed and for carry over. */
  readonly logs?: readonly WorkloadReview[];
  /** Measured answer times, if they have been worked out already. */
  readonly times?: AnswerTimes;
  /** What one new card costs, if it has been worked out already. */
  readonly marginalCost?: number;
  /** The backlog state, if it has been worked out already. */
  readonly backlog?: BacklogState;
}

/** A session, ready to be shown. */
export interface Session {
  /** The cards, in the order they should be asked. */
  readonly cards: readonly WorkloadCard[];
  /** How long it is expected to take, so the interface can say so up front. */
  readonly estimatedMinutes: number;
  /** How many minutes were available. */
  readonly budgetMinutes: number;
  /** How many of the cards are reviews. */
  readonly reviewCount: number;
  /** How many of the cards are new. */
  readonly newCount: number;
  /** Whether a backlog is being worked through. */
  readonly backlog: BacklogState;
  /** What the throttle decided about new cards, and why. */
  readonly newCards: NewCardDecision;
}

/** A card with the two numbers the builder sorts and fills on. */
interface Candidate {
  readonly card: WorkloadCard;
  readonly minutes: number;
  readonly overdue: boolean;
  readonly difficulty: number;
}

/** A copy of a list in a seeded random order. */
function shuffle(cards: readonly WorkloadCard[], rng: RandomSource): WorkloadCard[] {
  const copy = [...cards];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    const here = copy[index];
    const there = copy[swap];

    if (here !== undefined && there !== undefined) {
      copy[index] = there;
      copy[swap] = here;
    }
  }

  return copy;
}

/** Turns a card into a candidate. */
function candidateFor(
  card: WorkloadCard,
  times: AnswerTimes,
  today: number,
  config: WorkloadConfig,
): Candidate {
  return {
    card,
    minutes: answerSeconds(times, card.direction, card.scheduling.state) / SECONDS_PER_MINUTE,
    overdue:
      card.scheduling.state !== 'new' && dayIndexOf(card.scheduling.due, config.scheduler) < today,
    difficulty: card.scheduling.state === 'new' ? 5 : card.scheduling.difficulty,
  };
}

/**
 * Takes cards until the minutes run out, and one more.
 *
 * The card that crosses the line is kept. A session that stops just short of
 * the budget every day loses a card a day to rounding.
 */
function fill(candidates: readonly Candidate[], minutes: number): Candidate[] {
  const taken: Candidate[] = [];
  const seenNotes = new Set<string>();
  let spent = 0;

  for (const candidate of candidates) {
    if (spent >= minutes) {
      break;
    }

    if (seenNotes.has(candidate.card.noteId)) {
      continue;
    }

    seenNotes.add(candidate.card.noteId);
    taken.push(candidate);
    spent += candidate.minutes;
  }

  return taken;
}

/**
 * Spreads the cards owed from earlier days through the session.
 *
 * Sorting by due date would put every overdue card at the front, which is the
 * order that makes a return after a week away feel like a punishment. This
 * deals them out in proportion instead, so the old and the new alternate.
 */
function mixOverdue(candidates: readonly Candidate[]): Candidate[] {
  const overdue = candidates.filter((entry) => entry.overdue);
  const today = candidates.filter((entry) => !entry.overdue);

  if (overdue.length === 0 || today.length === 0) {
    return [...candidates];
  }

  const mixed: Candidate[] = [];
  const total = overdue.length + today.length;
  let fromOverdue = 0;
  let fromToday = 0;

  for (let index = 0; index < total; index += 1) {
    // Whichever queue is furthest behind where it should be by now goes next.
    const overdueShare = (fromOverdue + 0.5) / overdue.length;
    const todayShare = (fromToday + 0.5) / today.length;
    const next =
      fromOverdue < overdue.length && (fromToday >= today.length || overdueShare <= todayShare)
        ? overdue[fromOverdue++]
        : today[fromToday++];

    if (next !== undefined) {
      mixed.push(next);
    }
  }

  return mixed;
}

/**
 * Places the new cards through the first two thirds of the session.
 */
function weaveNewCards(reviews: readonly Candidate[], fresh: readonly Candidate[]): Candidate[] {
  if (fresh.length === 0) {
    return [...reviews];
  }

  if (reviews.length === 0) {
    return [...fresh];
  }

  const woven: Candidate[] = [];
  const total = reviews.length + fresh.length;
  const spread = Math.max(Math.round(total * NEW_CARD_SPREAD), fresh.length);
  const gap = spread / fresh.length;
  let placed = 0;

  for (const [index, review] of reviews.entries()) {
    // One new card every `gap` slots, starting half a gap in so the session
    // does not open on one.
    while (placed < fresh.length && Math.floor(placed * gap + gap / 2) <= woven.length) {
      const card = fresh[placed++];

      if (card !== undefined) {
        woven.push(card);
      }
    }

    woven.push(review);

    if (index === reviews.length - 1) {
      while (placed < fresh.length) {
        const card = fresh[placed++];

        if (card !== undefined) {
          woven.push(card);
        }
      }
    }
  }

  return woven;
}

/**
 * Breaks up runs of hard cards by pulling an easier one forward.
 *
 * Only swaps within the session, so nothing is added or lost, and it gives up
 * rather than shuffling forever when a session is nothing but hard cards.
 */
function breakUpHardRuns(order: readonly Candidate[]): Candidate[] {
  const result = [...order];

  for (let index = MAX_HARD_RUN; index < result.length; index += 1) {
    const run = result.slice(index - MAX_HARD_RUN, index + 1);

    if (!run.every((entry) => entry !== undefined && entry.difficulty > HARD_DIFFICULTY)) {
      continue;
    }

    const relief = result.findIndex(
      (entry, at) => at > index && entry.difficulty <= HARD_DIFFICULTY,
    );

    if (relief < 0) {
      break;
    }

    const here = result[index];
    const there = result[relief];

    if (here !== undefined && there !== undefined) {
      result[index] = there;
      result[relief] = here;
    }
  }

  return result;
}

/**
 * Builds the session.
 *
 * @param request the collection, the budget, the settings and the moment
 * @returns the cards to ask, in order, with what they are expected to cost
 */
export function buildSession(request: SessionRequest): Session {
  const { cards, budget, config, now, rng } = request;
  const preset = request.preset ?? DEFAULT_SESSION_PRESET;
  const times = request.times ?? defaultAnswerTimes(config.answerSeconds);
  const logs = request.logs ?? [];
  const today = dayIndexOf(now, config.scheduler);
  const backlog = request.backlog ?? detectBacklog(cards, budget, config, now, times);

  const budgetMinutes =
    preset.minutes ??
    budgetFor(now, budget, config.scheduler) +
      carryOverMinutes(logs, budget, config.scheduler, now);

  const due = cards.filter(
    (card) =>
      card.scheduling.state !== 'new' && dayIndexOf(card.scheduling.due, config.scheduler) <= today,
  );

  // During a backlog the recovery ordering decides what gets seen, and it is
  // the same on every device. Otherwise the cards closest to being forgotten
  // come first, since those are the ones where another day costs something.
  //
  // The shuffle underneath the sort is what settles ties. Sorting alone would
  // fall back on whatever order the collection arrived in, and the same cards
  // would be the ones that fit under the budget every single day.
  const ordered = backlog.active
    ? orderBacklog(due, config.backlogOrder, config, now)
    : shuffle(due, rng).sort(
        (left, right) =>
          retrievability(left.scheduling, now, config.scheduler) -
          retrievability(right.scheduling, now, config.scheduler),
      );

  const reviews = mixOverdue(
    fill(
      ordered.map((card) => candidateFor(card, times, today, config)),
      budgetMinutes,
    ),
  );
  const reviewMinutes = reviews.reduce((total, entry) => total + entry.minutes, 0);

  const marginalCost =
    request.marginalCost ?? marginalCostOfNewCard(config, logs, now, 'recall', config.horizonDays);
  const decision = newCardAllowance(request.load ?? [], budget, marginalCost, config, now, backlog);

  const roomLeft = Math.max(budgetMinutes - reviewMinutes, 0);
  const fresh = preset.allowNewCards
    ? fill(
        cards
          .filter((card) => card.scheduling.state === 'new')
          .map((card) => candidateFor(card, times, today, config))
          .slice(0, decision.allowed),
        roomLeft,
      )
    : [];

  const session = breakUpHardRuns(weaveNewCards(reviews, fresh));

  // Two cards of one note can still meet here if a review and a new card share
  // it, so the last word on that rule is said once, over the finished session.
  const seenNotes = new Set<string>();
  const finalOrder: Candidate[] = [];

  for (const entry of session) {
    if (!seenNotes.has(entry.card.noteId)) {
      seenNotes.add(entry.card.noteId);
      finalOrder.push(entry);
    }
  }

  return {
    cards: finalOrder.map((entry) => entry.card),
    estimatedMinutes: finalOrder.reduce((total, entry) => total + entry.minutes, 0),
    budgetMinutes,
    reviewCount: finalOrder.filter((entry) => entry.card.scheduling.state !== 'new').length,
    newCount: finalOrder.filter((entry) => entry.card.scheduling.state === 'new').length,
    backlog,
    newCards: decision,
  };
}

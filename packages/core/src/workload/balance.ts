/**
 * Moving a card to a quieter day.
 *
 * FSRS says twelve days. It does not mean twelve rather than eleven or
 * thirteen: the forgetting curve is nearly flat over that range, and the
 * difference in recall between the three is well under a percentage point.
 * What is not flat is the calendar. Cards learned on the same evening come
 * back on the same evening forever, and a Sunday can end up with four times
 * the work of the Monday either side of it.
 *
 * So the scheduler proposes and the calendar disposes. Within a narrow window
 * around the ideal interval, the least loaded day wins. Peaks flatten, and
 * what it costs in recall is smaller than the measurement error on the model.
 *
 * This replaces fuzz rather than joining it. Both exist to stop cards piling
 * onto one day, and running both would mean one of them scattering the card
 * off the day the other had just chosen for it.
 */

import { review } from '../fsrs/scheduler.js';
import { MS_PER_DAY } from '../time/day.js';

import type { WorkloadConfig } from './config.js';
import type { DailyLoad } from './types.js';
import type { RandomSource } from '../fsrs/random.js';
import type { ReviewOutcome } from '../fsrs/scheduler.js';
import type { Rating, SchedulingState } from '../fsrs/types.js';

/** Two loads closer than this are treated as the same, then the day nearest the ideal wins. */
const SAME_LOAD_MINUTES = 0.01;

/**
 * Picks the day a card should actually land on.
 *
 * @param idealInterval what the scheduler asked for, in whole days
 * @param load the forecast, starting with today
 * @param config the settings
 * @param rng a seeded generator, used only to break a tie
 * @returns the interval to use, in whole days
 */
export function balanceDueDate(
  idealInterval: number,
  load: readonly DailyLoad[],
  config: WorkloadConfig,
  rng: RandomSource,
): number {
  if (!config.enableLoadBalancing || idealInterval < 1) {
    return idealInterval;
  }

  // A tenth of a day is nothing on a five day interval, so the window is never
  // narrower than one day either side. On a year it would be five weeks, which
  // is more than the calendar can be trusted that far out, but the horizon cuts
  // that off long before it matters.
  const reach = Math.max(1, Math.round(idealInterval * config.loadBalanceWindow));
  const lowest = Math.max(1, idealInterval - reach);
  const highest = Math.min(
    idealInterval + reach,
    config.scheduler.maximumInterval,
    load.length - 1,
  );

  if (lowest > highest) {
    return idealInterval;
  }

  let best = idealInterval;
  let bestMinutes = Number.POSITIVE_INFINITY;
  let bestDistance = Number.POSITIVE_INFINITY;
  let ties = 0;

  for (let candidate = lowest; candidate <= highest; candidate += 1) {
    const minutes = load[candidate]?.minutes ?? 0;
    const distance = Math.abs(candidate - idealInterval);

    if (minutes < bestMinutes - SAME_LOAD_MINUTES) {
      best = candidate;
      bestMinutes = minutes;
      bestDistance = distance;
      ties = 1;

      continue;
    }

    if (minutes > bestMinutes + SAME_LOAD_MINUTES) {
      continue;
    }

    // Same load. The day nearest what the scheduler asked for wins, and if two
    // are equally near, the generator decides, which keeps cards from piling
    // up on whichever end of the window is scanned first.
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
      ties = 1;
    } else if (distance === bestDistance) {
      ties += 1;

      if (rng() < 1 / ties) {
        best = candidate;
      }
    }
  }

  return best;
}

/**
 * Answers a card and puts it on the least loaded nearby day.
 *
 * This is the entry point the application and the simulator both use, so the
 * card and the row written about it can never disagree about where it landed.
 *
 * @param state the card being answered
 * @param rating the answer given
 * @param now the moment of the answer
 * @param load the forecast, starting with today
 * @param config the settings
 * @param rng a seeded generator
 * @param durationMs how long the answer took
 * @returns the card's new state and the row to append to the review log
 */
export function balanceReview(
  state: SchedulingState,
  rating: Rating,
  now: Date,
  load: readonly DailyLoad[],
  config: WorkloadConfig,
  rng: RandomSource,
  durationMs = 0,
): ReviewOutcome {
  const outcome = review(state, rating, now, config.scheduler, rng, durationMs);

  if (!config.enableLoadBalancing || outcome.next.state !== 'review') {
    return outcome;
  }

  const ideal = Math.round((outcome.next.due.getTime() - now.getTime()) / MS_PER_DAY);

  if (ideal < 1) {
    return outcome;
  }

  const chosen = balanceDueDate(ideal, load, config, rng);

  if (chosen === ideal) {
    return outcome;
  }

  const due = new Date(now.getTime() + chosen * MS_PER_DAY);

  return {
    next: { ...outcome.next, due },
    log: { ...outcome.log, placedDue: due },
  };
}

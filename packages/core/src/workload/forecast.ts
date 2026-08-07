/**
 * What the next two months of study will actually cost.
 *
 * The obvious way to build this is to bucket the due dates that already exist
 * and add up the minutes. That is what makes every other app's forecast graph
 * wrong, and wrong in one direction: a card reviewed tomorrow produces another
 * review a few days later, and that one produces another. Over sixty days the
 * reviews that do not exist yet are about half the total. A throttle built on
 * the buckets alone would let in twice as much work as it meant to.
 *
 * So the forecast simulates forward. Every card is carried through the horizon
 * with the real scheduler, and the reviews it will spawn are counted.
 *
 * Two modes.
 *
 * Expected value is the default and the one the application runs. Each answer
 * splits into the four ratings at once, each branch carrying a fraction of the
 * card, and the fractions are added up per day. It is deterministic, which
 * matters: a forecast that moved every time you opened the app would be
 * useless, and two devices must agree.
 *
 * Monte Carlo is the honest but slow version. Cards take one path each, drawn
 * from a seeded generator, and many runs are averaged. It exists to check the
 * cheap mode, and the two are held to agree in a test.
 *
 * Cost. A card may leave at most four branches on any one day of the horizon,
 * because the fifth to arrive is merged into the nearest one it finds, and
 * each branch expands into at most four more. So the pass is linear in cards
 * times horizon, and a mature collection costs far less than that bound: a
 * card whose interval is longer than the horizon contributes nothing at all.
 * Measured on this machine, fourteen days of a 2000 card collection takes
 * about 25 ms and sixty days about 400 ms.
 */

import { preview, review } from '../fsrs/scheduler.js';
import {
  RATING,
  RATINGS,
  type CardState,
  type Rating,
  type SchedulingState,
} from '../fsrs/types.js';
import { dayIndexOf, dayStartOf } from '../time/day.js';

import { defaultAnswerTimes, estimateAnswerTimes, type AnswerTimes } from './answer-time.js';

import type { WorkloadConfig } from './config.js';
import type { CardDirection, DailyLoad, WorkloadCard, WorkloadReview } from './types.js';
import type { RandomSource } from '../fsrs/random.js';

/** How often each button gets pressed. The four add up to one. */
export type RatingDistribution = Readonly<Record<Rating, number>>;

/**
 * What to assume about somebody with no history.
 *
 * Roughly what the published FSRS datasets show for a collection in normal
 * use: most answers are Good, failures are uncommon, and Easy is rare because
 * people who use it press Good instead.
 */
export const PRIOR_RATING_DISTRIBUTION: RatingDistribution = Object.freeze({
  [RATING.again]: 0.08,
  [RATING.hard]: 0.1,
  [RATING.good]: 0.75,
  [RATING.easy]: 0.07,
});

/**
 * How many answers the prior is worth. Twenty is the same threshold the answer
 * time estimate uses, and for the same reason: below it, one bad evening would
 * swing the whole forecast.
 */
export const RATING_PRIOR_STRENGTH = 20;

/**
 * Branches lighter than this are dropped, and their weight is handed to the
 * branches that survive.
 *
 * The number is a trade between accuracy and time, and it was measured rather
 * than chosen. Against a Monte Carlo run of the same collection, over sixty
 * days:
 *
 *   0.001    within 4%, 105 ms for 2000 cards
 *   0.0003   within 2%, 305 ms
 *   0.0001   within 1.5%, 412 ms
 *   0.00001  within 0.5%, 1525 ms
 *
 * A ten thousandth of a review is two hundredths of a second of predicted
 * work, far inside the error of the answer time estimate it feeds. The
 * fourteen day forecast the throttle actually runs on every app open costs
 * around 25 ms at this setting, which is why accuracy won.
 */
export const FORECAST_PRUNE_WEIGHT = 0.0001;

/**
 * The threshold the throttle runs at, over its fourteen day window.
 *
 * The error from a coarse threshold compounds with the length of the horizon,
 * so a fortnight tolerates one that two months does not. Measured against
 * Monte Carlo on the same collection:
 *
 *   over 14 days   0.001 is 1.4% low and takes 16 ms, 0.0001 is 0.3% low and
 *                  takes 53 ms
 *   over 60 days   0.001 is 4% low, which is why it is not the default
 *
 * The throttle is deciding how many whole cards fit in the room that is left.
 * A percent and a half of a minute does not change that answer, and this runs
 * on a phone every time the application is opened.
 */
export const THROTTLE_PRUNE_WEIGHT = 0.001;

/** How many times one card may come back inside a single day. */
const MAX_SAME_DAY_REVIEWS = 64;

/**
 * How many branches of one card may sit on one day before two of them are
 * merged. Four is where the agreement with Monte Carlo stops improving.
 */
const MAX_PARTICLES_PER_CARD_DAY = 4;

/** Seconds in a minute. */
const SECONDS_PER_MINUTE = 60;

/** Which mode the forecast runs in. */
export type ForecastMode = 'expected' | 'monteCarlo';

/**
 * Everything the forecast needs.
 *
 * This is an object rather than a list of arguments because half of it is
 * optional and the shape of a call should say what it means.
 */
export interface ForecastRequest {
  /** The collection. Cards in the new state are ignored, see `newCards`. */
  readonly cards: readonly WorkloadCard[];
  /** The settings. */
  readonly config: WorkloadConfig;
  /** The moment the forecast is made. Day zero is the study day it falls in. */
  readonly now: Date;
  /** How far ahead to look. Defaults to the horizon in the settings. */
  readonly horizonDays?: number;
  /** The review log, read for answer times and for the rating distribution. */
  readonly logs?: readonly WorkloadReview[];
  /** Answer times, if they have already been measured from the log. */
  readonly times?: AnswerTimes;
  /** The rating distribution, if it has already been measured from the log. */
  readonly ratings?: RatingDistribution;
  /** New cards to introduce today, which the throttle uses to price one. */
  readonly newCards?: readonly WorkloadCard[];
  /** Expected value by default, Monte Carlo for tests and the simulator. */
  readonly mode?: ForecastMode;
  /** How light a branch has to be before it is dropped, for tuning. */
  readonly pruneWeight?: number;
  /** How many runs to average in Monte Carlo mode. */
  readonly samples?: number;
  /** The generator Monte Carlo mode draws from. */
  readonly rng?: RandomSource;
}

/** A day being filled in, before it is frozen into a {@link DailyLoad}. */
interface DayTotals {
  reviewCount: number;
  minutes: number;
  newCardCount: number;
}

/** A share of one card, sitting on the day it is expected to come up. */
interface Particle {
  /** How much of the card this branch accounts for, from 0 to 1. */
  weight: number;
  /** The card as it would be on that day. */
  state: SchedulingState;
}

/**
 * How often this person presses each button.
 *
 * @param logs the review log, in any order
 * @param prior what to assume before the log says otherwise
 * @returns the four probabilities, adding up to one
 */
export function ratingDistribution(
  logs: readonly WorkloadReview[],
  prior: RatingDistribution = PRIOR_RATING_DISTRIBUTION,
): RatingDistribution {
  const counts: Record<Rating, number> = {
    [RATING.again]: 0,
    [RATING.hard]: 0,
    [RATING.good]: 0,
    [RATING.easy]: 0,
  };

  for (const log of logs) {
    counts[log.rating] += 1;
  }

  const total = logs.length + RATING_PRIOR_STRENGTH;
  const share = (rating: Rating): number =>
    (counts[rating] + prior[rating] * RATING_PRIOR_STRENGTH) / total;

  return {
    [RATING.again]: share(RATING.again),
    [RATING.hard]: share(RATING.hard),
    [RATING.good]: share(RATING.good),
    [RATING.easy]: share(RATING.easy),
  };
}

/**
 * Seconds one answer of this kind is expected to take.
 *
 * @param times the measured table
 * @param direction which way round the card asks
 * @param state the state the card is in when it is asked
 * @returns seconds per answer
 */
export function answerSeconds(
  times: AnswerTimes,
  direction: CardDirection,
  state: CardState,
): number {
  return times[direction][state];
}

/** Builds an empty run of days starting at a given study day. */
function emptyDays(count: number): DayTotals[] {
  return Array.from({ length: count }, () => ({ reviewCount: 0, minutes: 0, newCardCount: 0 }));
}

/**
 * Merges two branches of the same card into one.
 *
 * Stability is merged by its harmonic mean, not its arithmetic mean, and the
 * difference is not a detail. What the forecast counts is reviews per day, and
 * that is proportional to one over the interval, which is proportional to one
 * over stability. Averaging a branch worth two days and a branch worth twenty
 * would produce one worth eleven, which does about half the work of the two it
 * replaced. Averaging the rates instead keeps the amount of future work the
 * same.
 *
 * Difficulty is averaged the ordinary way, since it moves the schedule far
 * more gently. Everything discrete, the state and the step, comes from
 * whichever branch carries more of the card.
 */
function mergeParticles(first: Particle, second: Particle): Particle {
  const weight = first.weight + second.weight;
  const heavier = second.weight > first.weight ? second : first;

  if (first.state.state === 'new' || second.state.state === 'new') {
    return { weight, state: heavier.state };
  }

  const rate = first.weight / first.state.stability + second.weight / second.state.stability;

  return {
    weight,
    state: {
      ...(heavier.state.state === 'new' ? first.state : heavier.state),
      stability: weight / rate,
      difficulty:
        (first.state.difficulty * first.weight + second.state.difficulty * second.weight) / weight,
    },
  };
}

/**
 * Files a branch under the day it comes back on.
 *
 * A card may keep several branches alive on the same day, up to
 * {@link MAX_PARTICLES_PER_CARD_DAY}. Past that the two closest in stability
 * are merged, so a card whose fortunes have genuinely split, half of it worth
 * two days and half of it worth two months, is not flattened into one card
 * worth a month. The cap is what keeps the pass linear.
 */
function addParticle(bucket: Map<number, Particle[]>, cardIndex: number, arriving: Particle): void {
  const waiting = bucket.get(cardIndex);

  if (waiting === undefined) {
    bucket.set(cardIndex, [arriving]);

    return;
  }

  waiting.push(arriving);

  if (waiting.length <= MAX_PARTICLES_PER_CARD_DAY) {
    return;
  }

  // Sorting by stability puts the candidates for merging next to each other,
  // and makes the choice a function of the branches alone rather than of the
  // order they happened to arrive in.
  waiting.sort((left, right) => stabilityOf(left) - stabilityOf(right));

  let closest = 0;
  let smallestGap = Number.POSITIVE_INFINITY;

  for (let index = 0; index + 1 < waiting.length; index += 1) {
    const lower = waiting[index];
    const upper = waiting[index + 1];

    if (lower === undefined || upper === undefined) {
      continue;
    }

    const gap = Math.log(stabilityOf(upper) / stabilityOf(lower));

    if (gap < smallestGap) {
      smallestGap = gap;
      closest = index;
    }
  }

  const left = waiting[closest];
  const right = waiting[closest + 1];

  if (left !== undefined && right !== undefined) {
    waiting.splice(closest, 2, mergeParticles(left, right));
  }
}

/** A branch's stability, with a new card counted as its first interval. */
function stabilityOf(particle: Particle): number {
  return particle.state.state === 'new' ? 1 : particle.state.stability;
}

/**
 * Walks the whole collection forward, splitting every answer four ways.
 *
 * @returns the totals per day, still mutable
 */
function runExpected(
  cards: readonly WorkloadCard[],
  seeded: readonly Particle[],
  seedOffsets: readonly number[],
  times: AnswerTimes,
  ratings: RatingDistribution,
  config: WorkloadConfig,
  now: Date,
  horizonDays: number,
  dayStarts: readonly number[],
  pruneWeight: number,
): DayTotals[] {
  const boundary = config.scheduler;
  const today = dayIndexOf(now, boundary);
  const days = emptyDays(horizonDays);
  const pending: Map<number, Particle[]>[] = Array.from({ length: horizonDays }, () => new Map());
  const likeliest = likeliestRating(ratings);
  // Fuzz is off inside the forecast: two devices have to agree on it, and a
  // scattered due date would only blur a number that is already an average.
  const scheduler = config.scheduler.enableFuzz
    ? { ...config.scheduler, enableFuzz: false }
    : config.scheduler;

  for (const [index, particle] of seeded.entries()) {
    const bucket = pending[seedOffsets[index] ?? 0];

    if (bucket !== undefined) {
      addParticle(bucket, index, particle);
    }
  }

  for (let offset = 0; offset < horizonDays; offset += 1) {
    const bucket = pending[offset];
    const day = days[offset];

    if (bucket === undefined || day === undefined) {
      continue;
    }

    for (const [cardIndex, waiting] of bucket) {
      const card = cards[cardIndex];

      if (card === undefined) {
        continue;
      }

      // Everything this card still has to do inside this one day. A lapse
      // sends it back in ten minutes, which is the same day, so the day is not
      // finished until the chain runs out of weight.
      const chain: Particle[] = [...waiting];
      const sameDayLimit = MAX_SAME_DAY_REVIEWS * waiting.length;

      for (let step = 0; step < sameDayLimit && chain.length > 0; step += 1) {
        const current = chain.pop();

        if (current === undefined) {
          break;
        }

        const at = new Date(
          Math.max(current.state.due.getTime(), earliestReview(offset, dayStarts, now)),
        );

        day.reviewCount += current.weight;
        day.minutes +=
          (current.weight * answerSeconds(times, card.direction, current.state.state)) /
          SECONDS_PER_MINUTE;

        // One call, four answers. Asking the scheduler four separate times
        // would make it work out all four outcomes on each of them.
        const outcomes = preview(current.state, at, scheduler);
        const branches: Particle[] = [];
        let carried = 0;

        for (const rating of RATINGS) {
          const weight = current.weight * ratings[rating];

          // The likeliest answer is always followed, however thin the branch
          // has become. Something has to carry the card forward, and dropping
          // every branch would quietly delete part of the collection from the
          // forecast.
          if (weight < pruneWeight && rating !== likeliest) {
            continue;
          }

          branches.push({ weight, state: outcomes[rating].next });
          carried += weight;
        }

        // What was dropped is handed to what was kept, in proportion. The card
        // is worth as much after the answer as before it, which is what makes
        // the totals comparable with a run that follows one path at a time.
        const scale = carried > 0 ? current.weight / carried : 0;

        for (const branch of branches) {
          const nextOffset = dayIndexOf(branch.state.due, boundary) - today;
          const later = pending[nextOffset];
          const spread = { weight: branch.weight * scale, state: branch.state };

          if (nextOffset <= offset) {
            chain.push(spread);
          } else if (later !== undefined) {
            addParticle(later, cardIndex, spread);
          }
        }
      }
    }
  }

  return days;
}

/** Fuzz is off inside the forecast, so the generator is never asked. */
const zeroRandom: RandomSource = () => 0;

/** The button this person presses most often. */
function likeliestRating(ratings: RatingDistribution): Rating {
  let best: Rating = RATING.good;

  for (const rating of RATINGS) {
    if (ratings[rating] > ratings[best]) {
      best = rating;
    }
  }

  return best;
}

/**
 * The earliest a card can be answered on a given day of the forecast.
 *
 * Today it is the moment the forecast is being made, since the morning has
 * already happened. Later days start at their cutoff hour.
 */
function earliestReview(offset: number, dayStarts: readonly number[], now: Date): number {
  const start = dayStarts[offset] ?? 0;

  return offset === 0 ? Math.max(start, now.getTime()) : start;
}

/** Picks one rating from the distribution. */
function pickRating(ratings: RatingDistribution, rng: RandomSource): Rating {
  let roll = rng();

  for (const rating of RATINGS) {
    roll -= ratings[rating];

    if (roll <= 0) {
      return rating;
    }
  }

  return RATING.good;
}

/**
 * Walks the collection forward one path at a time and averages the runs.
 */
function runMonteCarlo(
  cards: readonly WorkloadCard[],
  seeded: readonly Particle[],
  seedOffsets: readonly number[],
  times: AnswerTimes,
  ratings: RatingDistribution,
  config: WorkloadConfig,
  now: Date,
  horizonDays: number,
  dayStarts: readonly number[],
  samples: number,
  rng: RandomSource,
): DayTotals[] {
  const boundary = config.scheduler;
  const today = dayIndexOf(now, boundary);
  const days = emptyDays(horizonDays);

  for (let sample = 0; sample < samples; sample += 1) {
    for (const [index, particle] of seeded.entries()) {
      const card = cards[index];
      let offset = seedOffsets[index] ?? 0;
      let state = particle.state;
      let sameDay = 0;

      while (offset < horizonDays && card !== undefined) {
        const day = days[offset];

        if (day === undefined) {
          break;
        }

        const at = new Date(Math.max(state.due.getTime(), earliestReview(offset, dayStarts, now)));

        day.reviewCount += 1;
        day.minutes += answerSeconds(times, card.direction, state.state) / SECONDS_PER_MINUTE;

        state = review(state, pickRating(ratings, rng), at, config.scheduler, zeroRandom).next;

        const nextOffset = dayIndexOf(state.due, boundary) - today;

        if (nextOffset <= offset) {
          sameDay += 1;

          if (sameDay >= MAX_SAME_DAY_REVIEWS) {
            break;
          }
        } else {
          sameDay = 0;
          offset = nextOffset;
        }
      }
    }
  }

  for (const day of days) {
    day.reviewCount /= samples;
    day.minutes /= samples;
    day.newCardCount /= samples;
  }

  return days;
}

/**
 * What the next stretch of days is expected to cost.
 *
 * @param request the collection, the settings, the moment, and the options
 * @returns one entry per day, starting with the study day `now` falls in
 */
export function forecast(request: ForecastRequest): DailyLoad[] {
  const { cards, config, now } = request;
  const boundary = config.scheduler;
  const horizonDays = request.horizonDays ?? config.horizonDays;
  const today = dayIndexOf(now, boundary);
  const times =
    request.times ??
    (request.logs === undefined
      ? defaultAnswerTimes(config.answerSeconds)
      : estimateAnswerTimes(request.logs, config.answerSeconds));
  const ratings = request.ratings ?? ratingDistribution(request.logs ?? []);

  const dayStarts: number[] = [];

  for (let offset = 0; offset < horizonDays; offset += 1) {
    dayStarts.push(dayStartOf(today + offset, boundary).getTime());
  }

  // New cards are introduced by the session builder, not by the schedule, so a
  // pile of untouched cards is not future work until somebody decides it is.
  // The ones handed over explicitly are introduced today, which is how the
  // throttle prices a new card before letting one in.
  const scheduled = cards.filter((card) => card.scheduling.state !== 'new');
  const introduced = request.newCards ?? [];
  const walked = [...scheduled, ...introduced];
  const seeded: Particle[] = walked.map((card) => ({ weight: 1, state: card.scheduling }));
  const seedOffsets = walked.map((card, index) =>
    index < scheduled.length ? Math.max(dayIndexOf(card.scheduling.due, boundary) - today, 0) : 0,
  );

  if (request.mode === 'monteCarlo' && request.rng === undefined) {
    throw new RangeError('The Monte Carlo forecast needs a seeded generator to draw from.');
  }

  const days =
    request.mode === 'monteCarlo'
      ? runMonteCarlo(
          walked,
          seeded,
          seedOffsets,
          times,
          ratings,
          config,
          now,
          horizonDays,
          dayStarts,
          Math.max(request.samples ?? 200, 1),
          request.rng ?? zeroRandom,
        )
      : runExpected(
          walked,
          seeded,
          seedOffsets,
          times,
          ratings,
          config,
          now,
          horizonDays,
          dayStarts,
          request.pruneWeight ?? FORECAST_PRUNE_WEIGHT,
        );

  const first = days[0];

  if (first !== undefined) {
    first.newCardCount += introduced.length;
  }

  return days.map((day, offset) => ({
    dayIndex: today + offset,
    date: new Date(dayStarts[offset] ?? 0),
    reviewCount: day.reviewCount,
    minutes: day.minutes,
    newCardCount: day.newCardCount,
  }));
}

/**
 * The work already booked on each of the next few days.
 *
 * This is the cheap sibling of {@link forecast}: it buckets the due dates that
 * exist right now and stops there. It is not a prediction and must not be used
 * as one, because it misses every review those cards will spawn, which is
 * about half the real load over two months.
 *
 * What it is good for is load balancing, which asks a narrower question: of
 * the days around the one this card was going to land on, which already has
 * the most cards booked on it. That is a question about bookings, and it is
 * answered exactly here in one pass over the collection.
 *
 * @param cards the collection
 * @param config the settings
 * @param now the moment being asked about
 * @param horizonDays how many days to cover
 * @param times measured answer times, defaulting to the untrained ones
 * @returns one entry per day, starting with the study day `now` falls in
 */
export function scheduledLoad(
  cards: readonly WorkloadCard[],
  config: WorkloadConfig,
  now: Date,
  horizonDays: number,
  times: AnswerTimes = defaultAnswerTimes(config.answerSeconds),
): DailyLoad[] {
  const boundary = config.scheduler;
  const today = dayIndexOf(now, boundary);
  const days = emptyDays(horizonDays);

  for (const card of cards) {
    if (card.scheduling.state === 'new') {
      continue;
    }

    const offset = Math.max(dayIndexOf(card.scheduling.due, boundary) - today, 0);
    const day = days[offset];

    if (day !== undefined) {
      day.reviewCount += 1;
      day.minutes +=
        answerSeconds(times, card.direction, card.scheduling.state) / SECONDS_PER_MINUTE;
    }
  }

  return days.map((day, offset) => ({
    dayIndex: today + offset,
    date: dayStartOf(today + offset, boundary),
    reviewCount: day.reviewCount,
    minutes: day.minutes,
    newCardCount: 0,
  }));
}

/**
 * The mean minutes a day over the first stretch of a forecast.
 *
 * @param load the forecast
 * @param days how many days to average over
 * @returns mean minutes a day, or zero for an empty window
 */
export function meanMinutes(load: readonly DailyLoad[], days: number): number {
  const window = Math.min(days, load.length);

  if (window <= 0) {
    return 0;
  }

  let total = 0;

  for (let offset = 0; offset < window; offset += 1) {
    total += load[offset]?.minutes ?? 0;
  }

  return total / window;
}

/** Every minute in a forecast added up. */
export function totalMinutes(load: readonly DailyLoad[]): number {
  let total = 0;

  for (const day of load) {
    total += day.minutes;
  }

  return total;
}

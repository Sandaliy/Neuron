/**
 * The check that decides whether this implementation is right.
 *
 * Our scheduler and ts-fsrs, the reference implementation from the group that
 * publishes FSRS, are run over the same generated review histories and must
 * agree on every field of the result. Twenty thousand histories, each up to
 * sixty answers, cover far more shapes than hand written cases would: same day
 * answers, lapses, absences of a year, retention targets across the range, and
 * weights jittered off their defaults.
 *
 * ts-fsrs is a devDependency and is imported only here. It never reaches the
 * application. If this test disagrees, the code under it is what is wrong.
 */

import { createEmptyCard, fsrs, type Card, type Grade, type State } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FSRS_PARAMETERS,
  createSchedulerConfig,
  type SchedulerConfig,
} from './parameters.js';
import { createSeededRandom, type RandomSource } from './random.js';
import { review } from './scheduler.js';
import {
  RATING,
  RATINGS,
  newCard,
  type CardState,
  type Rating,
  type SchedulingState,
} from './types.js';

/** How many generated histories to compare. */
const SEQUENCE_COUNT = 20_000;

/** The longest history to generate. */
const MAX_REVIEWS = 60;

/** How far two memory values may drift before we call it a disagreement. */
const TOLERANCE = 1e-9;

const REFERENCE_STATES: readonly CardState[] = ['new', 'learning', 'review', 'relearning'];

/** One generated answer. */
interface GeneratedReview {
  readonly rating: Rating;
  readonly at: Date;
}

/** One generated history: the settings it runs under and the answers. */
interface GeneratedHistory {
  readonly config: SchedulerConfig;
  readonly learningSteps: readonly number[];
  readonly relearningSteps: readonly number[];
  readonly reviews: readonly GeneratedReview[];
}

/** Turns our step lengths into the "10m" strings the reference takes. */
function asReferenceSteps(steps: readonly number[]): `${number}m`[] {
  return steps.map((minutes): `${number}m` => `${minutes}m`);
}

/** Turns the reference state number into the name we use. */
function referenceStateName(state: State): CardState {
  return REFERENCE_STATES[state] ?? 'new';
}

/** Picks a whole number in [min, max]. */
function pick(random: RandomSource, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

/**
 * Picks a gap in days. Most answers land within a month of the last one, a
 * quarter of them on the same day, and a few after an absence of up to a year.
 */
function pickGapDays(random: RandomSource): number {
  const roll = random();

  if (roll < 0.25) {
    return 0;
  }

  if (roll < 0.85) {
    return pick(random, 1, 30);
  }

  if (roll < 0.97) {
    return pick(random, 31, 120);
  }

  return pick(random, 121, 400);
}

/** Builds one history: settings, answers and the moments they happen. */
function generateHistory(random: RandomSource): GeneratedHistory {
  const learningSteps = [[1, 10], [1, 10, 60], [15], [25]][pick(random, 0, 3)] ?? [1, 10];
  const relearningSteps = [[10], [10, 20], [5]][pick(random, 0, 2)] ?? [10];
  const jitteredWeights = DEFAULT_FSRS_PARAMETERS.map((weight) =>
    random() < 0.5 ? weight : weight * (0.7 + random() * 0.6),
  );

  const config = createSchedulerConfig({
    parameters: jitteredWeights,
    desiredRetention: pick(random, 80, 97) / 100,
    learningSteps,
    relearningSteps,
    maximumInterval: [36_500, 3650, 365][pick(random, 0, 2)] ?? 36_500,
    enableFuzz: false,
  });

  const reviewCount = pick(random, 1, MAX_REVIEWS);
  const reviews: GeneratedReview[] = [];
  let at = new Date(Date.UTC(2026, 0, 5, 9, 17));

  for (let index = 0; index < reviewCount; index += 1) {
    at = new Date(at.getTime() + pickGapDays(random) * 86_400_000 + pick(random, 0, 1439) * 60_000);
    reviews.push({ rating: RATINGS[pick(random, 0, 3)] ?? RATING.good, at });
  }

  return { config, learningSteps, relearningSteps, reviews };
}

/** True when two memory values agree to within floating point noise. */
function agrees(ours: number, reference: number): boolean {
  return Math.abs(ours - reference) <= TOLERANCE * Math.max(1, Math.abs(reference));
}

/**
 * Compares one step of a history.
 *
 * @returns a description of the first field that disagrees, or null
 */
function firstDifference(ours: SchedulingState, reference: Card): string | null {
  if (ours.state === 'new') {
    return 'our card is still new after a review';
  }

  if (ours.state !== referenceStateName(reference.state)) {
    return `state ${ours.state} against ${referenceStateName(reference.state)}`;
  }

  if (!agrees(ours.stability, reference.stability)) {
    return `stability ${ours.stability} against ${reference.stability}`;
  }

  if (!agrees(ours.difficulty, reference.difficulty)) {
    return `difficulty ${ours.difficulty} against ${reference.difficulty}`;
  }

  if (ours.due.getTime() !== reference.due.getTime()) {
    return `due ${ours.due.toISOString()} against ${reference.due.toISOString()}`;
  }

  if (ours.reps !== reference.reps) {
    return `reps ${ours.reps} against ${reference.reps}`;
  }

  if (ours.lapses !== reference.lapses) {
    return `lapses ${ours.lapses} against ${reference.lapses}`;
  }

  if (ours.learningStep !== reference.learning_steps) {
    return `learning step ${ours.learningStep} against ${reference.learning_steps}`;
  }

  return null;
}

describe('the scheduler against ts-fsrs', () => {
  it(
    `agrees on ${SEQUENCE_COUNT} generated review histories`,
    { timeout: 600_000 },
    async ({ annotate }) => {
      const random = createSeededRandom(20_260_807);
      const unusedFuzz: RandomSource = () => 0;
      const disagreements: string[] = [];
      let comparedReviews = 0;

      for (let sequence = 0; sequence < SEQUENCE_COUNT; sequence += 1) {
        const history = generateHistory(random);
        const scheduler = fsrs({
          w: [...history.config.parameters],
          request_retention: history.config.desiredRetention,
          maximum_interval: history.config.maximumInterval,
          enable_fuzz: false,
          enable_short_term: true,
          learning_steps: asReferenceSteps(history.learningSteps),
          relearning_steps: asReferenceSteps(history.relearningSteps),
        });

        let ours: SchedulingState = newCard(history.reviews[0]?.at ?? new Date());
        let reference: Card = createEmptyCard(history.reviews[0]?.at ?? new Date());

        for (const [index, answer] of history.reviews.entries()) {
          const ourResult = review(ours, answer.rating, answer.at, history.config, unusedFuzz);
          const referenceResult = scheduler.next(reference, answer.at, answer.rating as Grade);

          ours = ourResult.next;
          reference = referenceResult.card;
          comparedReviews += 1;

          const difference = firstDifference(ours, reference);

          if (difference !== null) {
            disagreements.push(`history ${sequence}, review ${index}: ${difference}`);
            break;
          }

          if (ourResult.log.elapsedDays !== referenceResult.log.elapsed_days) {
            disagreements.push(
              `history ${sequence}, review ${index}: elapsed days ${ourResult.log.elapsedDays} against ${referenceResult.log.elapsed_days}`,
            );
            break;
          }

          if (ourResult.log.scheduledDays !== referenceResult.log.scheduled_days) {
            disagreements.push(
              `history ${sequence}, review ${index}: scheduled days ${ourResult.log.scheduledDays} against ${referenceResult.log.scheduled_days}`,
            );
            break;
          }
        }

        if (disagreements.length > 0) {
          break;
        }
      }

      await annotate(
        `${SEQUENCE_COUNT} generated histories, ${comparedReviews} reviews compared against ts-fsrs`,
      );

      expect(disagreements).toEqual([]);
    },
  );

  it('agrees on the four button preview of a card in the review state', () => {
    const config = createSchedulerConfig({ enableFuzz: false });
    const scheduler = fsrs({
      w: [...config.parameters],
      request_retention: config.desiredRetention,
      maximum_interval: config.maximumInterval,
      enable_fuzz: false,
      enable_short_term: true,
      learning_steps: asReferenceSteps(config.learningSteps),
      relearning_steps: asReferenceSteps(config.relearningSteps),
    });
    const unusedFuzz: RandomSource = () => 0;

    const start = new Date(Date.UTC(2026, 2, 1, 8, 0));
    let ours: SchedulingState = newCard(start);
    let reference: Card = createEmptyCard(start);

    // Three answers to get the card out of learning and onto a real interval.
    for (const [index, rating] of [RATING.good, RATING.good, RATING.good].entries()) {
      const at = new Date(start.getTime() + index * 2 * 86_400_000);
      ours = review(ours, rating, at, config, unusedFuzz).next;
      reference = scheduler.next(reference, at, rating as Grade).card;
    }

    const at = new Date(start.getTime() + 9 * 86_400_000);
    const referencePreview = scheduler.repeat(reference, at);

    for (const rating of [RATING.again, RATING.hard, RATING.good, RATING.easy]) {
      const ourNext = review(ours, rating, at, config, unusedFuzz).next;

      expect(firstDifference(ourNext, referencePreview[rating as Grade].card)).toBeNull();
    }
  });
});

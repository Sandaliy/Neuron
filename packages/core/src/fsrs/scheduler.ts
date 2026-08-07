/**
 * The scheduler: what happens to a card when someone answers it.
 *
 * The memory model in memory.ts says how stability and difficulty move. This
 * file says where the card lands afterwards, which is a separate question. A
 * card on its first day walks through the learning steps in minutes and ignores
 * its stability. A card in the review state is placed by its stability. A card
 * answered Again drops into the relearning steps.
 *
 * Nothing here reads a clock or calls Math.random. The time arrives as `now`
 * and the randomness arrives as a generator.
 */

import { MINUTES_PER_DAY, MS_PER_DAY, MS_PER_MINUTE, calendarDaysBetween, clamp } from './math.js';
import {
  forgetStability,
  forgettingCurve,
  initialDifficulty,
  initialStability,
  intervalFromStability,
  nextDifficulty,
  postLapseFloor,
  recallStability,
  shortTermStability,
} from './memory.js';
import {
  MAX_DIFFICULTY,
  MIN_DIFFICULTY,
  MIN_STABILITY,
  type SchedulerConfig,
} from './parameters.js';
import {
  RATING,
  newCard,
  type CardState,
  type Rating,
  type ReviewLog,
  type SchedulingState,
} from './types.js';

import type { RandomSource } from './random.js';

/** What one of the four buttons would do to a card. */
export interface ScheduledOutcome {
  /** The state the card would be left in. */
  readonly next: SchedulingState;
  /**
   * Days until the card would come back. Fractional while the card is walking
   * its steps, so ten minutes reads as roughly 0.0069 rather than as zero.
   */
  readonly intervalDays: number;
}

/** What all four buttons would do, for labelling them in the interface. */
export type PreviewByRating = Record<Rating, ScheduledOutcome>;

/** The result of an answer: the card's new state and the row to append. */
export interface ReviewOutcome {
  readonly next: SchedulingState;
  readonly log: ReviewLog;
}

/** The memory values an answer produces, before the card is placed anywhere. */
interface MemoryUpdate {
  readonly stability: number;
  readonly difficulty: number;
}

/** Where a learning step puts a card, in minutes from now. */
interface StepPlacement {
  /** Minutes until the card comes back. Zero means the steps are finished. */
  readonly scheduledMinutes: number;
  /** The step the card would sit on next. */
  readonly nextStep: number;
}

/** Not on a step: the card graduates and is placed by its stability. */
const STEPS_FINISHED: StepPlacement = { scheduledMinutes: 0, nextStep: 0 };

/**
 * How far an interval may be scattered, as a share of its length. Short
 * intervals get a wider share because a day either way matters less to them.
 */
const FUZZ_RANGES: readonly { start: number; end: number; share: number }[] = [
  { start: 2.5, end: 7, share: 0.15 },
  { start: 7, end: 20, share: 0.1 },
  { start: 20, end: Number.POSITIVE_INFINITY, share: 0.05 },
];

/**
 * Days between the previous answer and this one, never negative.
 *
 * Merged offline logs can carry a timestamp a little behind the one before it,
 * from a phone with a skewed clock. Rather than refusing to schedule, that is
 * read as another answer on the same day, which is what it almost always is.
 */
function elapsedDaysFor(state: SchedulingState, now: Date): number {
  if (state.state === 'new') {
    return 0;
  }

  return Math.max(calendarDaysBetween(state.lastReview, now), 0);
}

/** Whole days the card had been waiting when it was answered. */
function scheduledDaysFor(state: SchedulingState): number {
  if (state.state === 'new') {
    return 0;
  }

  const waited = state.due.getTime() - state.lastReview.getTime();

  return Math.max(Math.floor(waited / MS_PER_DAY), 0);
}

/**
 * Runs the memory model for one answer.
 *
 * @param state the card as it was before the answer
 * @param rating the answer given
 * @param elapsedDays whole days since the previous answer
 * @param config the settings
 * @returns the new stability and difficulty
 */
function nextMemory(
  state: SchedulingState,
  rating: Rating,
  elapsedDays: number,
  config: SchedulerConfig,
): MemoryUpdate {
  const parameters = config.parameters;

  if (state.state === 'new') {
    return {
      stability: initialStability(parameters, rating),
      difficulty: clamp(initialDifficulty(parameters, rating), MIN_DIFFICULTY, MAX_DIFFICULTY),
    };
  }

  const difficulty = nextDifficulty(parameters, state.difficulty, rating);

  if (elapsedDays === 0) {
    return { stability: shortTermStability(parameters, state.stability, rating), difficulty };
  }

  const recalled = forgettingCurve(parameters, elapsedDays, state.stability);

  if (rating === RATING.again) {
    const afterLapse = forgetStability(parameters, state.difficulty, state.stability, recalled);

    return {
      stability: clamp(postLapseFloor(parameters, state.stability), MIN_STABILITY, afterLapse),
      difficulty,
    };
  }

  return {
    stability: recallStability(parameters, state.difficulty, state.stability, recalled, rating),
    difficulty,
  };
}

/**
 * Picks the step an answer moves the card to.
 *
 * Again restarts the steps. Hard repeats the current step, at the average of
 * the first two step lengths. Good advances, and falls off the end of the list
 * when there is no next step, which is how a card graduates. Easy always
 * graduates.
 *
 * @param config the settings, read for the two step lists
 * @param from the state the card was in when the question was asked
 * @param currentStep the step the card was sitting on
 * @param rating the answer given
 * @returns minutes until the card comes back, or zero if it graduates
 */
function stepFor(
  config: SchedulerConfig,
  from: CardState,
  currentStep: number,
  rating: Rating,
): StepPlacement {
  const steps =
    from === 'review' || from === 'relearning' ? config.relearningSteps : config.learningSteps;

  if (steps.length === 0 || currentStep >= steps.length) {
    return STEPS_FINISHED;
  }

  const first = steps[0];
  const current = steps[Math.max(0, currentStep)];

  if (first === undefined || current === undefined) {
    return STEPS_FINISHED;
  }

  // A card in the review state has finished its steps. Only a lapse puts it
  // back on one, at the head of the relearning list.
  if (from === 'review') {
    return rating === RATING.again ? { scheduledMinutes: current, nextStep: 0 } : STEPS_FINISHED;
  }

  switch (rating) {
    case RATING.again:
      return { scheduledMinutes: first, nextStep: 0 };

    case RATING.hard: {
      const second = steps[1];
      const minutes =
        second === undefined ? Math.round(first * 1.5) : Math.round((first + second) / 2);

      return { scheduledMinutes: minutes, nextStep: currentStep };
    }

    case RATING.good: {
      const next = steps[currentStep + 1];

      return next === undefined
        ? STEPS_FINISHED
        : { scheduledMinutes: Math.round(next), nextStep: currentStep + 1 };
    }

    case RATING.easy:
      return STEPS_FINISHED;
  }
}

/**
 * Scatters an interval so that cards learned on the same day do not all come
 * back on the same day forever after.
 *
 * @param interval the interval in whole days
 * @param elapsedDays days since the previous answer
 * @param config the settings
 * @param fuzzFactor one number in [0, 1) from the injected generator
 * @returns the scattered interval, never below two days and never above the cap
 */
function applyFuzz(
  interval: number,
  elapsedDays: number,
  config: SchedulerConfig,
  fuzzFactor: number,
): number {
  // Nothing below two and a half days is scattered. A one day interval has
  // nowhere to go, and moving a two day interval would be a large change.
  if (!config.enableFuzz || interval < 2.5) {
    return Math.round(interval);
  }

  let spread = 1;

  for (const range of FUZZ_RANGES) {
    spread += range.share * Math.max(Math.min(interval, range.end) - range.start, 0);
  }

  const capped = Math.min(interval, config.maximumInterval);
  const highest = Math.min(Math.round(capped + spread), config.maximumInterval);
  let lowest = Math.max(2, Math.round(capped - spread));

  // Never schedule a card sooner than it was already waiting. Pulling an
  // overdue card further forward would undo the wait it has already earned.
  if (capped > elapsedDays) {
    lowest = Math.max(lowest, elapsedDays + 1);
  }

  lowest = Math.min(lowest, highest);

  return Math.floor(fuzzFactor * (highest - lowest + 1) + lowest);
}

/**
 * Turns a stability into the interval a card is actually given: whole days, at
 * least one, at most the configured cap, then scattered.
 */
function nextInterval(
  stability: number,
  elapsedDays: number,
  config: SchedulerConfig,
  fuzzFactor: number,
): number {
  const exact = intervalFromStability(stability, config.desiredRetention, config);
  const whole = clamp(Math.round(exact), 1, config.maximumInterval);

  return applyFuzz(whole, elapsedDays, config, fuzzFactor);
}

/** Builds an outcome for a card that lands on a step, or graduates off one. */
function placeOnStep(
  state: SchedulingState,
  rating: Rating,
  memory: MemoryUpdate,
  stayingState: 'learning' | 'relearning',
  now: Date,
  elapsedDays: number,
  config: SchedulerConfig,
  fuzzFactor: number,
): ScheduledOutcome {
  const { scheduledMinutes, nextStep } = stepFor(config, state.state, state.learningStep, rating);
  const lapsed = state.state === 'review' && rating === RATING.again;
  const shared = {
    stability: memory.stability,
    difficulty: memory.difficulty,
    lastReview: now,
    reps: state.reps + 1,
    lapses: state.lapses + (lapsed ? 1 : 0),
  };

  if (scheduledMinutes > 0) {
    const due = new Date(now.getTime() + Math.round(scheduledMinutes) * MS_PER_MINUTE);

    // A step of a day or more is long enough to be an interval, so the card is
    // treated as a review card that happens to come back at that time.
    return {
      next: {
        ...shared,
        state: scheduledMinutes < MINUTES_PER_DAY ? stayingState : 'review',
        learningStep: nextStep,
        due,
      },
      intervalDays: (due.getTime() - now.getTime()) / MS_PER_DAY,
    };
  }

  const interval = nextInterval(memory.stability, elapsedDays, config, fuzzFactor);

  return {
    next: {
      ...shared,
      state: 'review',
      learningStep: 0,
      due: new Date(now.getTime() + interval * MS_PER_DAY),
    },
    intervalDays: interval,
  };
}

/** Builds an outcome for a card placed by its stability, in whole days. */
function placeOnInterval(
  state: SchedulingState,
  memory: MemoryUpdate,
  interval: number,
  now: Date,
): ScheduledOutcome {
  return {
    next: {
      state: 'review',
      stability: memory.stability,
      difficulty: memory.difficulty,
      lastReview: now,
      due: new Date(now.getTime() + interval * MS_PER_DAY),
      reps: state.reps + 1,
      lapses: state.lapses,
      learningStep: 0,
    },
    intervalDays: interval,
  };
}

/** What the four buttons do to a card that is new or walking its steps. */
function scheduleFromSteps(
  state: SchedulingState,
  now: Date,
  elapsedDays: number,
  config: SchedulerConfig,
  fuzzFactor: number,
): PreviewByRating {
  const stayingState = state.state === 'relearning' ? 'relearning' : 'learning';
  const place = (rating: Rating): ScheduledOutcome =>
    placeOnStep(
      state,
      rating,
      nextMemory(state, rating, elapsedDays, config),
      stayingState,
      now,
      elapsedDays,
      config,
      fuzzFactor,
    );

  return {
    [RATING.again]: place(RATING.again),
    [RATING.hard]: place(RATING.hard),
    [RATING.good]: place(RATING.good),
    [RATING.easy]: place(RATING.easy),
  };
}

/**
 * What the four buttons do to a card in the review state.
 *
 * The three passing answers are computed together because they have to stay in
 * order. Rounding to whole days can make Hard and Good land on the same number,
 * and a person who presses Hard and gets the same interval as Good will stop
 * trusting the buttons, so each is pushed at least a day past the one below it.
 */
function scheduleFromReview(
  state: SchedulingState,
  now: Date,
  elapsedDays: number,
  config: SchedulerConfig,
  fuzzFactor: number,
): PreviewByRating {
  const memoryHard = nextMemory(state, RATING.hard, elapsedDays, config);
  const memoryGood = nextMemory(state, RATING.good, elapsedDays, config);
  const memoryEasy = nextMemory(state, RATING.easy, elapsedDays, config);

  const hardInterval = Math.min(
    nextInterval(memoryHard.stability, elapsedDays, config, fuzzFactor),
    nextInterval(memoryGood.stability, elapsedDays, config, fuzzFactor),
  );
  // Separating the buttons happens after the cap, not before it, so a card
  // whose intervals have all reached the cap comes out one day past it on Good
  // and two on Easy. That is what the reference implementation does, and the
  // alternative is worse: three buttons that all promise the same date.
  const goodInterval = Math.max(
    nextInterval(memoryGood.stability, elapsedDays, config, fuzzFactor),
    hardInterval + 1,
  );
  const easyInterval = Math.max(
    nextInterval(memoryEasy.stability, elapsedDays, config, fuzzFactor),
    goodInterval + 1,
  );

  return {
    [RATING.again]: placeOnStep(
      state,
      RATING.again,
      nextMemory(state, RATING.again, elapsedDays, config),
      'relearning',
      now,
      elapsedDays,
      config,
      fuzzFactor,
    ),
    [RATING.hard]: placeOnInterval(state, memoryHard, hardInterval, now),
    [RATING.good]: placeOnInterval(state, memoryGood, goodInterval, now),
    [RATING.easy]: placeOnInterval(state, memoryEasy, easyInterval, now),
  };
}

/** What all four buttons would do, with a fuzz factor already drawn. */
function scheduleAll(
  state: SchedulingState,
  now: Date,
  config: SchedulerConfig,
  fuzzFactor: number,
): PreviewByRating {
  if (Number.isNaN(now.getTime())) {
    throw new RangeError('The review time is not a valid date.');
  }

  const elapsedDays = elapsedDaysFor(state, now);

  return state.state === 'review'
    ? scheduleFromReview(state, now, elapsedDays, config, fuzzFactor)
    : scheduleFromSteps(state, now, elapsedDays, config, fuzzFactor);
}

/**
 * The chance of recalling a card right now.
 *
 * A card that has never been answered returns zero: there is nothing to recall
 * yet. Elapsed time is counted in whole days, so a card answered earlier today
 * still reads as certain.
 *
 * @param state the card
 * @param now the moment to ask about
 * @param config the settings, read for the weight vector
 * @returns the chance of recall, from 0 to 1
 */
export function retrievability(state: SchedulingState, now: Date, config: SchedulerConfig): number {
  if (state.state === 'new') {
    return 0;
  }

  const elapsedDays = Math.max(calendarDaysBetween(state.lastReview, now), 0);

  return forgettingCurve(config.parameters, elapsedDays, state.stability);
}

/**
 * What each of the four buttons would do, so the interface can label them.
 *
 * Does not touch the card it is given and does not draw from any generator, so
 * it is safe to call while a question is on screen. Fuzz is left off, because a
 * label that shifts every time the screen redraws is a bug.
 *
 * @param state the card being asked
 * @param now the moment the buttons would be pressed
 * @param config the settings
 * @returns the resulting state and interval for each of the four ratings
 */
export function preview(
  state: SchedulingState,
  now: Date,
  config: SchedulerConfig,
): PreviewByRating {
  return scheduleAll(state, now, { ...config, enableFuzz: false }, 0);
}

/**
 * Answers a card.
 *
 * Draws exactly one number from the generator when fuzz is on, and none when it
 * is off, so a caller can reason about how far the generator has advanced.
 *
 * @param state the card being answered
 * @param rating the answer given
 * @param now the moment of the answer
 * @param config the settings
 * @param rng the seeded generator, used only to scatter the interval
 * @param durationMs how long the answer took, recorded but not used to schedule
 * @returns the card's new state and the row to append to the review log
 */
export function review(
  state: SchedulingState,
  rating: Rating,
  now: Date,
  config: SchedulerConfig,
  rng: RandomSource,
  durationMs = 0,
): ReviewOutcome {
  const fuzzFactor = config.enableFuzz ? rng() : 0;
  const outcome = scheduleAll(state, now, config, fuzzFactor)[rating];

  return {
    next: outcome.next,
    log: {
      rating,
      reviewedAt: now,
      elapsedDays: elapsedDaysFor(state, now),
      scheduledDays: scheduledDaysFor(state),
      stateBefore: state.state,
      stabilityBefore: state.stability,
      difficultyBefore: state.difficulty,
      durationMs,
    },
  };
}

/**
 * Rebuilds a card's state by replaying its review log from the beginning.
 *
 * The database keeps reviews as an append only log and treats card state as a
 * projection of it. This is that projection. When two devices answer the same
 * card while offline, the logs are merged by timestamp and replayed, and both
 * devices end up with the same card without either having to win.
 *
 * Fuzz is left off here. It only scatters the due date, never stability or
 * difficulty, and a rebuild has to be the same on every device, so the card
 * comes back on the day the model actually asked for.
 *
 * @param logs the review rows in the order they happened
 * @param config the settings
 * @returns the card state the log adds up to
 */
export function replay(logs: readonly ReviewLog[], config: SchedulerConfig): SchedulingState {
  const first = logs[0];

  if (first === undefined) {
    return newCard(new Date(0));
  }

  const withoutFuzz = { ...config, enableFuzz: false };
  const unused: RandomSource = () => 0;
  let state: SchedulingState = newCard(first.reviewedAt);

  for (const log of logs) {
    state = review(state, log.rating, log.reviewedAt, withoutFuzz, unused, log.durationMs).next;
  }

  return state;
}

/**
 * The 21 trained weights of FSRS-6 and the settings wrapped around them.
 *
 * The weights are not tuning knobs. Each index is a specific term in a specific
 * equation, so the order is fixed and the bounds below are the ranges the
 * optimiser is allowed to produce. Anything outside a bound would push the
 * formulas somewhere they were never fitted, so incoming values are pulled back
 * into range instead of being trusted.
 */

import {
  DEFAULT_DAY_CUTOFF_HOUR,
  DEFAULT_TIME_ZONE,
  isSupportedTimeZone,
  type DayBoundary,
} from '../time/day.js';

import { clamp, round8 } from './math.js';

/** How many weights FSRS-6 takes. FSRS-4 took 17 and FSRS-5 took 19. */
export const PARAMETER_COUNT = 21;

/** The weight vector, as a fixed length tuple so every index is known to exist. */
export type FsrsParameters = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/**
 * The weights fitted on the open review dataset. A user who has never had their
 * own parameters optimised gets these, and they are what the tests run against.
 */
export const DEFAULT_FSRS_PARAMETERS: FsrsParameters = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835,
  0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
];

/** Stability can never fall to zero, because the formulas divide by it. */
export const MIN_STABILITY = 0.001;

/** Stability is capped at a hundred years, which is also the interval cap. */
export const MAX_STABILITY = 36_500;

/** Difficulty is defined on a one to ten scale. */
export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 10;

/** Below this the schedule forgets more than it saves. */
export const MIN_DESIRED_RETENTION = 0.8;

/** Above this the review load climbs fast for very little extra recall. */
export const MAX_DESIRED_RETENTION = 0.97;

/** What a new user gets before touching the setting. */
export const DEFAULT_DESIRED_RETENTION = 0.9;

/** Minutes between the steps a card walks through on its first day. */
export const DEFAULT_LEARNING_STEPS: readonly number[] = [1, 10];

/** Minutes between the steps a card walks through after a lapse. */
export const DEFAULT_RELEARNING_STEPS: readonly number[] = [10];

/** A hundred years. Past this the schedule is a promise nobody will keep. */
export const DEFAULT_MAXIMUM_INTERVAL = 36_500;

/** A lower and an upper bound for one weight. */
type Bound = readonly [min: number, max: number];

/**
 * The ranges the optimiser works inside, index by index. The first four are
 * initial stabilities, so they share the initial stability cap of a hundred
 * days rather than the hundred year cap that applies later.
 */
const PARAMETER_BOUNDS: readonly Bound[] = [
  [MIN_STABILITY, 100],
  [MIN_STABILITY, 100],
  [MIN_STABILITY, 100],
  [MIN_STABILITY, 100],
  [1, 10],
  [MIN_STABILITY, 4],
  [MIN_STABILITY, 4],
  [MIN_STABILITY, 0.75],
  [0, 4.5],
  [0, 0.8],
  [MIN_STABILITY, 3.5],
  [MIN_STABILITY, 5],
  [MIN_STABILITY, 0.25],
  [MIN_STABILITY, 0.9],
  [0, 4],
  [0, 1],
  [1, 6],
  [0, 2],
  [0, 2],
  [0.01, 0.8],
  [0.1, 0.8],
];

/** The widest the same day weights are ever allowed to be. */
const SHORT_TERM_CEILING = 2;

/**
 * Narrows the two same day weights when a card has several relearning steps.
 *
 * With more than one relearning step a card is answered several times in a day
 * after a lapse, and each of those answers multiplies stability by the same day
 * factor. Without a tighter ceiling the product can undo the whole lapse, so the
 * ceiling is set to the point where walking the steps cannot lift stability back
 * above where the post lapse formula put it.
 *
 * @param parameters the weights, already inside their fixed bounds
 * @param relearningStepCount how many relearning steps are configured
 * @returns the bounds, with indices 17 and 18 tightened when it applies
 */
function boundsForSteps(
  parameters: readonly number[],
  relearningStepCount: number,
): readonly Bound[] {
  if (relearningStepCount <= 1) {
    return PARAMETER_BOUNDS;
  }

  const w11 = parameters[11] ?? 0;
  const w13 = parameters[13] ?? 0;
  const w14 = parameters[14] ?? 0;
  const room = -(Math.log(w11) + Math.log(Math.pow(2, w13) - 1) + w14 * 0.3) / relearningStepCount;
  const ceiling = clamp(round8(Math.sqrt(Math.max(room, 0))), 0.01, SHORT_TERM_CEILING);

  return PARAMETER_BOUNDS.map((bound, index) =>
    index === 17 || index === 18 ? ([bound[0], ceiling] as const) : bound,
  );
}

/**
 * Checks that a list of numbers is a full weight vector.
 *
 * @param values the numbers to check
 * @returns true when there are exactly {@link PARAMETER_COUNT} of them
 */
function isParameterVector(values: readonly number[]): values is FsrsParameters {
  return values.length === PARAMETER_COUNT;
}

/**
 * Pulls a weight vector into the ranges the model was fitted in.
 *
 * @param parameters the incoming weights, from the optimiser or from storage
 * @param relearningStepCount how many relearning steps the schedule uses
 * @returns the weights, every one inside its bound
 * @throws RangeError if the vector is the wrong length or holds a value that is
 *   not a finite number
 */
export function clampParameters(
  parameters: readonly number[],
  relearningStepCount: number,
): FsrsParameters {
  if (parameters.length !== PARAMETER_COUNT) {
    throw new RangeError(
      `FSRS-6 takes exactly ${PARAMETER_COUNT} parameters, got ${parameters.length}.`,
    );
  }

  const invalid = parameters.findIndex((value) => !Number.isFinite(value));

  if (invalid >= 0) {
    throw new RangeError(`Parameter ${invalid} is not a finite number.`);
  }

  const fixedBounds = PARAMETER_BOUNDS.map(([min, max], index) =>
    clamp(parameters[index] ?? 0, min, max),
  );
  const bounds = boundsForSteps(fixedBounds, relearningStepCount);
  const clamped = bounds.map(([min, max], index) => clamp(parameters[index] ?? 0, min, max));

  if (!isParameterVector(clamped)) {
    throw new RangeError(`Clamping produced ${clamped.length} parameters.`);
  }

  return clamped;
}

/** Everything the scheduler needs besides the card itself. */
export interface SchedulerConfig extends DayBoundary {
  /** The 21 FSRS-6 weights. */
  readonly parameters: FsrsParameters;
  /** Chance of recall to aim for at the moment a card comes up, 0.8 to 0.97. */
  readonly desiredRetention: number;
  /** Minutes between the steps of a card's first day. */
  readonly learningSteps: readonly number[];
  /** Minutes between the steps a card walks after a lapse. */
  readonly relearningSteps: readonly number[];
  /** The longest interval the scheduler may hand out, in days. */
  readonly maximumInterval: number;
  /** Whether to scatter intervals a little so cards do not pile onto one day. */
  readonly enableFuzz: boolean;
  /** The user's IANA timezone, which decides which day an answer counts for. */
  readonly timezone: string;
  /** The local hour a day rolls over at, 0 to 23. */
  readonly dayCutoffHour: number;
}

/**
 * The settings as they arrive from storage or from a form, where the weights
 * are a plain list of numbers that has not been checked yet.
 */
export interface SchedulerConfigInput extends Partial<Omit<SchedulerConfig, 'parameters'>> {
  readonly parameters?: readonly number[];
}

/** The settings a user gets before changing anything. */
export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = Object.freeze({
  parameters: DEFAULT_FSRS_PARAMETERS,
  desiredRetention: DEFAULT_DESIRED_RETENTION,
  learningSteps: DEFAULT_LEARNING_STEPS,
  relearningSteps: DEFAULT_RELEARNING_STEPS,
  maximumInterval: DEFAULT_MAXIMUM_INTERVAL,
  enableFuzz: true,
  timezone: DEFAULT_TIME_ZONE,
  dayCutoffHour: DEFAULT_DAY_CUTOFF_HOUR,
});

/**
 * Checks a list of step lengths.
 *
 * @param steps minutes per step
 * @param label the field name, for the error message
 * @returns the steps, unchanged
 * @throws RangeError if a step is not a finite number above zero
 */
function checkSteps(steps: readonly number[], label: string): readonly number[] {
  const invalid = steps.findIndex((minutes) => !Number.isFinite(minutes) || minutes <= 0);

  if (invalid >= 0) {
    throw new RangeError(`${label}[${invalid}] must be a number of minutes above zero.`);
  }

  return [...steps];
}

/**
 * Builds a settings object, checking every field and pulling the weights into
 * range. Anything not given falls back to {@link DEFAULT_SCHEDULER_CONFIG}.
 *
 * @param overrides the fields to change
 * @returns a frozen settings object the scheduler can be trusted with
 * @throws RangeError if a field is outside the range the model was fitted in
 */
export function createSchedulerConfig(overrides: SchedulerConfigInput = {}): SchedulerConfig {
  const desiredRetention = overrides.desiredRetention ?? DEFAULT_DESIRED_RETENTION;

  if (
    !Number.isFinite(desiredRetention) ||
    desiredRetention < MIN_DESIRED_RETENTION ||
    desiredRetention > MAX_DESIRED_RETENTION
  ) {
    throw new RangeError(
      `Desired retention must be between ${MIN_DESIRED_RETENTION} and ${MAX_DESIRED_RETENTION}, got ${desiredRetention}.`,
    );
  }

  const maximumInterval = overrides.maximumInterval ?? DEFAULT_MAXIMUM_INTERVAL;

  if (
    !Number.isInteger(maximumInterval) ||
    maximumInterval < 1 ||
    maximumInterval > MAX_STABILITY
  ) {
    throw new RangeError(
      `Maximum interval must be a whole number of days from 1 to ${MAX_STABILITY}, got ${maximumInterval}.`,
    );
  }

  const learningSteps = checkSteps(
    overrides.learningSteps ?? DEFAULT_LEARNING_STEPS,
    'learningSteps',
  );
  const relearningSteps = checkSteps(
    overrides.relearningSteps ?? DEFAULT_RELEARNING_STEPS,
    'relearningSteps',
  );

  const timezone = overrides.timezone ?? DEFAULT_TIME_ZONE;

  if (!isSupportedTimeZone(timezone)) {
    throw new RangeError(`"${timezone}" is not a timezone this platform knows.`);
  }

  const dayCutoffHour = overrides.dayCutoffHour ?? DEFAULT_DAY_CUTOFF_HOUR;

  if (!Number.isInteger(dayCutoffHour) || dayCutoffHour < 0 || dayCutoffHour > 23) {
    throw new RangeError(`The day cutoff must be a whole hour from 0 to 23, got ${dayCutoffHour}.`);
  }

  return Object.freeze({
    parameters: clampParameters(
      overrides.parameters ?? DEFAULT_FSRS_PARAMETERS,
      relearningSteps.length,
    ),
    desiredRetention,
    learningSteps: Object.freeze(learningSteps),
    relearningSteps: Object.freeze(relearningSteps),
    maximumInterval,
    enableFuzz: overrides.enableFuzz ?? DEFAULT_SCHEDULER_CONFIG.enableFuzz,
    timezone,
    dayCutoffHour,
  });
}

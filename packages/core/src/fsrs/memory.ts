/**
 * The FSRS-6 memory model: the equations, and nothing else.
 *
 * Sources this file was written from, both read on 2026-08-07:
 *
 *   The Algorithm, the wiki of open-spaced-repetition/awesome-fsrs.
 *   https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm
 *   The older fsrs4anki wiki page linked from most places now points here.
 *
 *   ts-fsrs 5.4.1, which reports itself as "v5.4.1 using FSRS-6.0".
 *   https://github.com/open-spaced-repetition/ts-fsrs
 *
 * The wiki gives the equations. The library pins down what the equations leave
 * open: where results are rounded, where they are clamped, and in which order.
 * Both were read, and differential.test.ts holds this file to the library on
 * tens of thousands of generated review histories.
 *
 * FSRS-7 exists but is a research branch, so FSRS-6 is what is implemented.
 *
 * Every function here is a function of its arguments alone. No clock, no
 * randomness, no state.
 */

import { clamp, round8 } from './math.js';
import {
  MAX_DIFFICULTY,
  MAX_STABILITY,
  MIN_DIFFICULTY,
  MIN_STABILITY,
  type FsrsParameters,
  type SchedulerConfig,
} from './parameters.js';
import { RATING, type Rating } from './types.js';

/**
 * The two constants of the forgetting curve.
 *
 * FSRS-6 learns the shape of the curve instead of fixing it: w[20] is the decay
 * exponent, and the factor is whatever makes the curve pass through 90% recall
 * at exactly one stability of elapsed time. That is the definition of
 * stability, so the factor follows from the decay rather than being fitted.
 *
 * @param parameters the weight vector
 * @returns the decay exponent (negative) and the matching factor
 */
function curveConstants(parameters: FsrsParameters): { decay: number; factor: number } {
  const decay = -parameters[20];
  const factor = round8(Math.exp(Math.pow(decay, -1) * Math.log(0.9)) - 1);

  return { decay, factor };
}

/**
 * The forgetting curve.
 *
 *   R(t, S) = (1 + FACTOR * t / S) ^ DECAY
 *
 * A power curve, not an exponential one. It has a long tail, which is why a
 * card survives a long absence instead of being forgotten outright.
 *
 * @param parameters the weight vector
 * @param elapsedDays days since the last answer
 * @param stability the card's stability in days
 * @returns the chance of recalling the card right now, from 0 to 1
 */
export function forgettingCurve(
  parameters: FsrsParameters,
  elapsedDays: number,
  stability: number,
): number {
  const { decay, factor } = curveConstants(parameters);

  return round8(Math.pow(1 + (factor * elapsedDays) / stability, decay));
}

/**
 * How many stabilities of waiting the target retention buys.
 *
 * Solving the forgetting curve for t at R = the target gives an interval that
 * is a fixed multiple of stability, so the multiple is worth computing once.
 * At the default 90% target the multiple is 1, which is what makes stability
 * readable as "the interval you would get right now".
 *
 * @param parameters the weight vector
 * @param desiredRetention the chance of recall to aim for
 * @returns the number stability is multiplied by to get an interval in days
 * @throws RangeError if the target is not a finite number in (0, 1)
 */
export function intervalModifier(parameters: FsrsParameters, desiredRetention: number): number {
  if (!Number.isFinite(desiredRetention) || desiredRetention <= 0 || desiredRetention >= 1) {
    throw new RangeError(`Desired retention must be between 0 and 1, got ${desiredRetention}.`);
  }

  const { decay, factor } = curveConstants(parameters);

  return round8((Math.pow(desiredRetention, 1 / decay) - 1) / factor);
}

/**
 * The interval that lets recall decay from certainty to the target.
 *
 * This is the exact, unrounded answer. The scheduler rounds it to whole days,
 * holds it inside the maximum interval and may scatter it, so what a card ends
 * up with is close to this rather than equal to it.
 *
 * @param stability the card's stability in days
 * @param desiredRetention the chance of recall to aim for
 * @param config the settings, read for the weight vector
 * @returns days until recall falls to the target
 * @throws RangeError if the target is not a finite number in (0, 1)
 */
export function intervalFromStability(
  stability: number,
  desiredRetention: number,
  config: SchedulerConfig,
): number {
  return stability * intervalModifier(config.parameters, desiredRetention);
}

/**
 * Stability after the very first answer, which is read straight off the weights.
 *
 *   S0(G) = w[G - 1]
 *
 * @param parameters the weight vector
 * @param rating the first answer given
 * @returns the starting stability in days
 */
export function initialStability(parameters: FsrsParameters, rating: Rating): number {
  switch (rating) {
    case RATING.again:
      return Math.max(parameters[0], 0.1);
    case RATING.hard:
      return Math.max(parameters[1], 0.1);
    case RATING.good:
      return Math.max(parameters[2], 0.1);
    case RATING.easy:
      return Math.max(parameters[3], 0.1);
  }
}

/**
 * Difficulty after the very first answer.
 *
 *   D0(G) = w[4] - e ^ (w[5] * (G - 1)) + 1
 *
 * Not clamped here, because the mean reversion below needs the raw value of
 * D0(Easy) as its target.
 *
 * @param parameters the weight vector
 * @param rating the first answer given
 * @returns the starting difficulty, before clamping to 1..10
 */
export function initialDifficulty(parameters: FsrsParameters, rating: Rating): number {
  return round8(parameters[4] - Math.exp((rating - 1) * parameters[5]) + 1);
}

/**
 * Difficulty after any later answer.
 *
 * Three things happen. The answer pushes difficulty up or down by w[6] per step
 * away from Good. That push is damped by how much room is left below 10, so a
 * card that is already hard barely moves. Then the result is pulled a little
 * towards D0(Easy) by w[7]. The pull is what keeps a long run of Good answers
 * from driving every card to the floor, which is the failure old algorithms are
 * remembered for.
 *
 * @param parameters the weight vector
 * @param difficulty the difficulty before this answer
 * @param rating the answer given
 * @returns the new difficulty, from 1 to 10
 */
export function nextDifficulty(
  parameters: FsrsParameters,
  difficulty: number,
  rating: Rating,
): number {
  const delta = -parameters[6] * (rating - 3);
  const damped = difficulty + round8((delta * (10 - difficulty)) / 9);
  const reverted = round8(
    parameters[7] * initialDifficulty(parameters, RATING.easy) + (1 - parameters[7]) * damped,
  );

  return clamp(reverted, MIN_DIFFICULTY, MAX_DIFFICULTY);
}

/**
 * Stability after a card was recalled, that is after Hard, Good or Easy.
 *
 *   S'(D,S,R,G) = S * (e^w[8] * (11 - D) * S^-w[9] * (e^(w[10] * (1 - R)) - 1)
 *                      * w[15] if Hard * w[16] if Easy
 *                      + 1)
 *
 * The term that matters most is (1 - R). The lower the chance of recall was at
 * the moment of the answer, the more the successful answer proves, and the more
 * stability grows. Recalling something you were about to forget is worth far
 * more than recalling something you saw yesterday.
 *
 * @param parameters the weight vector
 * @param difficulty the difficulty before this answer
 * @param stability the stability before this answer
 * @param retrievability the chance of recall at the moment of the answer
 * @param rating the answer given, one of Hard, Good or Easy
 * @returns the new stability in days
 */
export function recallStability(
  parameters: FsrsParameters,
  difficulty: number,
  stability: number,
  retrievability: number,
  rating: Rating,
): number {
  const hardPenalty = rating === RATING.hard ? parameters[15] : 1;
  const easyBonus = rating === RATING.easy ? parameters[16] : 1;

  return round8(
    clamp(
      stability *
        (1 +
          Math.exp(parameters[8]) *
            (11 - difficulty) *
            Math.pow(stability, -parameters[9]) *
            (Math.exp((1 - retrievability) * parameters[10]) - 1) *
            hardPenalty *
            easyBonus),
      MIN_STABILITY,
      MAX_STABILITY,
    ),
  );
}

/**
 * Stability after the card was forgotten, that is after Again.
 *
 *   S'(D,S,R) = w[11] * D^-w[12] * ((S + 1)^w[13] - 1) * e^(w[14] * (1 - R))
 *
 * The result is small but not zero, and it grows with the stability the card
 * had before. A card you have known for a year and then forget comes back
 * stronger than a card you learned yesterday and forgot. Nothing is reset.
 *
 * @param parameters the weight vector
 * @param difficulty the difficulty before this answer
 * @param stability the stability before this answer
 * @param retrievability the chance of recall at the moment of the answer
 * @returns the new stability in days
 */
export function forgetStability(
  parameters: FsrsParameters,
  difficulty: number,
  stability: number,
  retrievability: number,
): number {
  return round8(
    clamp(
      parameters[11] *
        Math.pow(difficulty, -parameters[12]) *
        (Math.pow(stability + 1, parameters[13]) - 1) *
        Math.exp((1 - retrievability) * parameters[14]),
      MIN_STABILITY,
      MAX_STABILITY,
    ),
  );
}

/**
 * Stability after an answer given on the same day as the previous one.
 *
 *   S'(S,G) = S * S^-w[19] * e^(w[17] * (G - 3 + w[18]))
 *
 * This is the part FSRS-6 added. Seeing a card twice in one afternoon is not
 * the same event as seeing it twice a week apart, and the forgetting curve has
 * nothing to say about it because no measurable time passed. Hard, Good and
 * Easy are held to never lower stability here, since answering correctly again
 * cannot be evidence of a weaker memory.
 *
 * @param parameters the weight vector
 * @param stability the stability before this answer
 * @param rating the answer given
 * @returns the new stability in days
 */
export function shortTermStability(
  parameters: FsrsParameters,
  stability: number,
  rating: Rating,
): number {
  const change =
    Math.pow(stability, -parameters[19]) * Math.exp(parameters[17] * (rating - 3 + parameters[18]));
  const held = rating >= RATING.hard ? Math.max(change, 1) : change;

  return round8(clamp(stability * held, MIN_STABILITY, MAX_STABILITY));
}

/**
 * The floor a lapse cannot push stability below.
 *
 * A lapsed card is about to walk the relearning steps, and each of those steps
 * multiplies stability by the same day factor. Without a floor, a card could
 * come out of relearning with more stability than it had before it was
 * forgotten. The floor is set so the steps can bring it back to at most where
 * it started.
 *
 * @param parameters the weight vector
 * @param stability the stability before the lapse
 * @returns the lowest stability a lapse may leave behind
 */
export function postLapseFloor(parameters: FsrsParameters, stability: number): number {
  return round8(stability / Math.exp(parameters[17] * parameters[18]));
}

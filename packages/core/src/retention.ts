/**
 * Target retention is the probability of recalling a card at the moment it
 * comes up for review. It is the one setting that trades review load against
 * forgetting, so the rest of the scheduler is written in terms of it.
 */

/** Lower bound of the setting. Below this the schedule forgets too much. */
export const MIN_TARGET_RETENTION = 0.8;

/** Upper bound of the setting. Above this the load grows with little gain. */
export const MAX_TARGET_RETENTION = 0.97;

/** What a new user gets before touching the setting. */
export const DEFAULT_TARGET_RETENTION = 0.9;

/**
 * Converts a target retention into the decay constant of the forgetting curve
 *
 *   R(t) = exp(-decay * t / S)
 *
 * where t is the days since the last review and S is the stability of the card
 * in days. At t = S the curve returns exactly the target retention, which makes
 * the constant -ln(targetRetention).
 *
 * A higher target gives a smaller constant, a flatter curve and shorter
 * intervals. The result is always above zero because the target is always
 * below one.
 *
 * @param targetRetention probability to aim for, from 0.8 to 0.97
 * @returns the decay constant, in units of one over stability
 * @throws RangeError if the target is not a finite number within the bounds
 */
export function retentionToDecayConstant(targetRetention: number): number {
  if (!Number.isFinite(targetRetention)) {
    throw new RangeError('Target retention must be a finite number.');
  }

  if (targetRetention < MIN_TARGET_RETENTION || targetRetention > MAX_TARGET_RETENTION) {
    throw new RangeError(
      `Target retention must be between ${MIN_TARGET_RETENTION} and ${MAX_TARGET_RETENTION}, got ${targetRetention}.`,
    );
  }

  return -Math.log(targetRetention);
}

/**
 * The inverse of retentionToDecayConstant. Used to show a stored decay constant
 * back to the user as a retention percentage.
 *
 * @param decayConstant a positive decay constant
 * @returns the retention the constant corresponds to, between 0 and 1
 * @throws RangeError if the constant is not a finite number above zero
 */
export function decayConstantToRetention(decayConstant: number): number {
  if (!Number.isFinite(decayConstant) || decayConstant <= 0) {
    throw new RangeError('Decay constant must be a finite number above zero.');
  }

  return Math.exp(-decayConstant);
}

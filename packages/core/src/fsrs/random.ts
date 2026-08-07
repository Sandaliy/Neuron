/**
 * The only source of randomness in the scheduler.
 *
 * Nothing in this package calls Math.random. A generator is passed in, so the
 * same seed replays the same schedule on the phone and on the server, and a
 * failing case in a test can be reproduced from its seed alone.
 */

/** A generator that yields numbers in [0, 1), like Math.random but seeded. */
export type RandomSource = () => number;

/**
 * Builds a generator from a seed, using mulberry32: a 32 bit state, one
 * multiply and a few shifts per number. It is not a cryptographic generator and
 * does not need to be. It only has to be fast, deterministic and evenly spread.
 *
 * @param seed any integer, truncated to 32 bits
 * @returns a generator that yields the same sequence for the same seed
 */
export function createSeededRandom(seed: number): RandomSource {
  let state = Math.trunc(seed) >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;

    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

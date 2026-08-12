/**
 * The shape of a recovery code.
 *
 * The alphabet and the grouping live here rather than in the api, because the
 * client has to normalise what somebody typed before sending it: a code read
 * off a piece of paper arrives lowercased, with the hyphens in the wrong place,
 * or with a space where a hyphen was. Fixing that on the client means a person
 * who typed it correctly enough is not told they got it wrong.
 */

/**
 * Thirty one characters, with every confusable pair removed.
 *
 * No `0` and no `O`, no `1` and no `I` and no `L`. These codes are read off a
 * screen, written down, and typed back in weeks later, often from a phone. A
 * character somebody cannot tell apart from another is a code that fails for a
 * person who copied it correctly, and the failure looks identical to an attack.
 */
export const RECOVERY_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** Characters per group, between the hyphens. */
export const RECOVERY_CODE_GROUP = 5;

/** How many groups make one code. */
export const RECOVERY_CODE_GROUPS = 3;

/**
 * Fifteen characters of a thirty one character alphabet.
 *
 * That is a little over 74 bits, comfortably past the 64 the phase asks for.
 * The margin is deliberate: these codes are the whole credential, so the
 * question is not whether 64 bits is enough today but whether it stays enough
 * for as long as somebody keeps the piece of paper.
 */
export const RECOVERY_CODE_LENGTH = RECOVERY_CODE_GROUP * RECOVERY_CODE_GROUPS;

/** How many codes a person is given at once. */
export const RECOVERY_CODE_COUNT = 10;

/** Below this many left, the interface starts saying so. */
export const RECOVERY_CODE_LOW_WATERMARK = 3;

/**
 * Puts the hyphens in, for showing a code to a person.
 *
 * @param code fifteen characters from the alphabet
 * @returns the code in groups, for example `A2B3C-D4E5F-G6H7J`
 */
export function formatRecoveryCode(code: string): string {
  const groups: string[] = [];

  for (let start = 0; start < code.length; start += RECOVERY_CODE_GROUP) {
    groups.push(code.slice(start, start + RECOVERY_CODE_GROUP));
  }

  return groups.join('-');
}

/**
 * Turns what somebody typed into the form that gets compared.
 *
 * Uppercases, and drops everything that is not in the alphabet. That covers the
 * hyphens, the spaces somebody used instead of hyphens, and the lowercase a
 * phone keyboard produced. It does not try to guess at a character that is not
 * in the alphabet at all: there is no `0` in a code, so a typed `0` is a
 * mistake nobody can correct without knowing what was meant.
 *
 * @param typed whatever arrived
 * @returns the bare code, uppercased
 */
export function normaliseRecoveryCode(typed: string): string {
  let normalised = '';

  for (const character of typed.toUpperCase()) {
    if (RECOVERY_CODE_ALPHABET.includes(character)) {
      normalised += character;
    }
  }

  return normalised;
}

/**
 * Whether a normalised code is even the right shape.
 *
 * Worth checking on the client so an obvious typo is caught before it costs a
 * round trip. Not worth trusting on the server, which checks it again.
 *
 * @param code the output of `normaliseRecoveryCode`
 */
export function looksLikeRecoveryCode(code: string): boolean {
  return code.length === RECOVERY_CODE_LENGTH;
}

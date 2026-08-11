/**
 * UUID version 7: a random identifier with a timestamp in front of it.
 *
 * Two properties matter here, and neither is cosmetic.
 *
 * The client generates ids, so a note created with no network has a real
 * identity straight away and keeps it when the row eventually reaches the
 * server. Nothing has to be renumbered on sync, and two devices creating rows
 * at the same moment cannot collide, because 74 of the bits are random.
 *
 * The first 48 bits are the creation time in milliseconds, so ids sort by age.
 * That keeps inserts landing at the right hand edge of the primary key index
 * instead of scattered through it, which is the difference between appending to
 * a b-tree and rewriting pages all over it.
 */

/** Milliseconds since the epoch, as stored in the first 48 bits. */
const MAX_TIMESTAMP = 2 ** 48 - 1;

/** The counter occupies the 12 bits the layout calls rand_a. */
const MAX_COUNTER = 0xfff;

const HEX: readonly string[] = Array.from({ length: 256 }, (_, index) =>
  index.toString(16).padStart(2, '0'),
);

/** Where the bytes a generator needs come from. */
export interface UuidV7Sources {
  /** The current time in milliseconds. */
  readonly now: () => number;
  /** Fills the given array with random bytes. */
  readonly fillRandom: (into: Uint8Array) => void;
}

/**
 * The one method needed from the Web Crypto API.
 *
 * Declared here rather than pulled in from the DOM or Node type packages,
 * because this package compiles with neither: it has to be the same code in a
 * browser and on the server, and both have provided this global for years.
 */
interface RandomSource {
  getRandomValues: <T extends ArrayBufferView>(array: T) => T;
}

const platformSources: UuidV7Sources = {
  now: () => Date.now(),
  fillRandom: (into) => {
    const source = (globalThis as { crypto?: RandomSource }).crypto;

    if (!source) {
      throw new Error('no Web Crypto available, so ids cannot be generated safely');
    }

    source.getRandomValues(into);
  },
};

/**
 * Formats sixteen bytes as a UUID.
 *
 * @param bytes exactly sixteen bytes
 * @returns the canonical 8-4-4-4-12 form
 */
function format(bytes: Uint8Array): string {
  let out = '';

  for (let index = 0; index < 16; index += 1) {
    if (index === 4 || index === 6 || index === 8 || index === 10) {
      out += '-';
    }

    // Every index below 16 is in range, but the compiler cannot see that.
    out += HEX[bytes[index] ?? 0];
  }

  return out;
}

/**
 * Builds a generator.
 *
 * The sources are arguments rather than globals so that a test can hold the
 * clock still and check what happens when several ids are asked for inside one
 * millisecond.
 *
 * @param sources where the time and the random bytes come from
 * @returns a function returning a new id on every call
 */
export function createUuidV7(sources: UuidV7Sources = platformSources): () => string {
  let lastMs = -1;
  let counter = 0;

  return function uuid(): string {
    const observed = sources.now();

    if (observed > lastMs) {
      lastMs = observed;
      counter = 0;
    } else {
      // Either the same millisecond or a clock that went backwards. Both are
      // handled the same way: keep the timestamp we already used and count up,
      // so ids from one device never go back on themselves. A clock correction
      // of a few seconds costs a few thousand counter steps, not a duplicate.
      counter += 1;

      if (counter > MAX_COUNTER) {
        lastMs += 1;
        counter = 0;
      }
    }

    if (lastMs > MAX_TIMESTAMP) {
      throw new RangeError('uuid v7 cannot represent a time beyond the year 10889');
    }

    const bytes = new Uint8Array(16);

    sources.fillRandom(bytes);

    // Timestamp, 48 bits, most significant byte first. Split at 32 bits because
    // bitwise operators in JavaScript work on 32 bit integers.
    const high = Math.floor(lastMs / 2 ** 32);
    const low = lastMs >>> 0;

    bytes[0] = (high >>> 8) & 0xff;
    bytes[1] = high & 0xff;
    bytes[2] = (low >>> 24) & 0xff;
    bytes[3] = (low >>> 16) & 0xff;
    bytes[4] = (low >>> 8) & 0xff;
    bytes[5] = low & 0xff;

    // Version 7 in the top four bits, the counter in the twelve below it.
    bytes[6] = 0x70 | ((counter >>> 8) & 0x0f);
    bytes[7] = counter & 0xff;

    // Variant 10 in the top two bits. The rest of the byte stays random.
    bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);

    return format(bytes);
  };
}

/** The generator the application uses. */
export const uuidV7: () => string = createUuidV7();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Whether a string is a version 7 UUID in canonical form.
 *
 * @param value the string to check
 * @returns true when the shape, the version and the variant all match
 */
export function isUuidV7(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * Reads the creation time back out of an id.
 *
 * @param value a version 7 UUID
 * @returns milliseconds since the epoch
 * @throws TypeError when the value is not a version 7 UUID
 */
export function uuidV7Time(value: string): number {
  if (!isUuidV7(value)) {
    throw new TypeError(`not a version 7 uuid: ${value}`);
  }

  return Number.parseInt(value.slice(0, 8) + value.slice(9, 13), 16);
}

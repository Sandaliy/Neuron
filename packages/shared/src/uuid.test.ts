import { describe, expect, it } from 'vitest';

import { createUuidV7, isUuidV7, uuidV7, uuidV7Time, type UuidV7Sources } from './uuid.js';

/**
 * A generator with the clock and the randomness held still, so that the only
 * thing moving between two ids is the part under test.
 */
function fixed(times: readonly number[], fill = 0): () => string {
  let index = 0;

  const sources: UuidV7Sources = {
    now: () => times[Math.min(index++, times.length - 1)] ?? 0,
    fillRandom: (into) => into.fill(fill),
  };

  return createUuidV7(sources);
}

describe('uuidV7', () => {
  it('produces the canonical shape with version 7 and variant 10', () => {
    for (let n = 0; n < 500; n += 1) {
      const id = uuidV7();

      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(id[14]).toBe('7');
      expect('89ab').toContain(id[19]);
      expect(isUuidV7(id)).toBe(true);
    }
  });

  it('reads the creation time back out to the millisecond', () => {
    const before = Date.now();
    const id = uuidV7();
    const after = Date.now();

    expect(uuidV7Time(id)).toBeGreaterThanOrEqual(before);
    expect(uuidV7Time(id)).toBeLessThanOrEqual(after);
  });

  it('round trips a specific instant', () => {
    const instant = Date.UTC(2026, 7, 8, 12, 30, 15, 250);
    const id = fixed([instant])();

    expect(uuidV7Time(id)).toBe(instant);
  });

  it('sorts by creation time as plain strings', () => {
    const generate = fixed([1000, 2000, 3000, 4000]);
    const ids = [generate(), generate(), generate(), generate()];

    expect([...ids].sort()).toEqual(ids);
  });

  it('stays strictly increasing inside one millisecond', () => {
    const generate = fixed([5000, 5000, 5000, 5000, 5000]);
    const ids = Array.from({ length: 5 }, generate);

    // Same timestamp and same random bytes, so only the counter separates them.
    // If the counter were missing, these would be five identical strings.
    expect(new Set(ids).size).toBe(5);
    expect([...ids].sort()).toEqual(ids);
  });

  it('carries into the next millisecond when the counter fills up', () => {
    const generate = fixed(Array.from({ length: 4098 }, () => 7000));
    const ids = Array.from({ length: 4098 }, generate);
    const last = ids.at(-1);

    expect(last).toBeDefined();
    expect(new Set(ids).size).toBe(4098);
    // 4096 ids fit in one millisecond. The next one borrows from the following
    // millisecond rather than repeating a value.
    expect(uuidV7Time(ids[4095] ?? '')).toBe(7000);
    expect(uuidV7Time(ids[4096] ?? '')).toBe(7001);
  });

  it('does not go backwards when the clock does', () => {
    const generate = fixed([9000, 8000, 8500]);
    const ids = [generate(), generate(), generate()];

    expect([...ids].sort()).toEqual(ids);
    expect(uuidV7Time(ids[1] ?? '')).toBe(9000);
    expect(uuidV7Time(ids[2] ?? '')).toBe(9000);
  });

  it('does not repeat across many draws', () => {
    const ids = new Set(Array.from({ length: 50_000 }, uuidV7));

    expect(ids.size).toBe(50_000);
  });

  it('separates two generators drawing in the same millisecond', () => {
    // Same clock, same counter, different random bytes. This is two devices
    // creating a note at the same instant with no way to talk to each other.
    const a = fixed([4000], 0x11)();
    const b = fixed([4000], 0x22)();

    expect(a).not.toBe(b);
  });
});

describe('isUuidV7', () => {
  it('rejects a version 4 uuid', () => {
    expect(isUuidV7('9f1a2b3c-4d5e-4f60-8123-456789abcdef')).toBe(false);
  });

  it('rejects a wrong variant', () => {
    expect(isUuidV7('9f1a2b3c-4d5e-7f60-c123-456789abcdef')).toBe(false);
  });

  it('rejects uppercase, so that stored ids compare as plain text', () => {
    expect(isUuidV7('9F1A2B3C-4D5E-7F60-8123-456789ABCDEF')).toBe(false);
  });

  it('rejects a string that is not a uuid at all', () => {
    expect(isUuidV7('note-1')).toBe(false);
  });
});

describe('uuidV7Time', () => {
  it('refuses anything that is not a version 7 uuid', () => {
    expect(() => uuidV7Time('9f1a2b3c-4d5e-4f60-8123-456789abcdef')).toThrow(TypeError);
  });
});

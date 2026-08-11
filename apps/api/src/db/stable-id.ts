import { createHash } from 'node:crypto';

/**
 * An id derived from a name rather than generated.
 *
 * Used by the seed and by anything else that has to write the same row twice
 * and have it be the same row. Shaped as a version 7 uuid because every id
 * column in this schema is one, though the timestamp in front carries no
 * meaning here.
 *
 * @param key what the row is
 * @returns the id
 */
export function stableId(key: string): string {
  const digest = createHash('sha256').update(`neuron:${key}`).digest();
  const bytes = Uint8Array.prototype.slice.call(digest, 0, 16);

  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);

  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

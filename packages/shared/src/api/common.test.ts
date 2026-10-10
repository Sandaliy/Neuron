import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { idSchema } from './common.js';

describe('persisted collection identities', () => {
  it('accepts canonical PostgreSQL identities without RFC version/variant bits', () => {
    const legacy = '01234567-89ab-cdef-0123-456789abcdef';
    expect(z.uuid().safeParse(legacy).success).toBe(false);
    expect(idSchema.parse(legacy)).toBe(legacy);
    expect(idSchema.parse('01900000-0000-7000-8000-000000000001')).toBeTruthy();
  });
  it('still rejects malformed identifiers', () => {
    for (const value of [
      'anything',
      '0123456789abcdef0123456789abcdef',
      '01234567-89ab-cdef-0123-456789abcdeg',
      '',
      null,
    ])
      expect(idSchema.safeParse(value).success).toBe(false);
  });
});

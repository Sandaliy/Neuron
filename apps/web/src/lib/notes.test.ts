import { describe, expect, it, vi } from 'vitest';

import { findDuplicates } from './notes';

vi.mock('./api', () => ({
  request: vi.fn(),
}));

describe('duplicate lookup', () => {
  it('does not send an invalid empty request', async () => {
    const result = await findDuplicates([]);

    expect(result).toEqual([]);
  });
});

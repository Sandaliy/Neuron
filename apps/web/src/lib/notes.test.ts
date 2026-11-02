import { describe, expect, it, vi } from 'vitest';

import { request } from './api';
import { findDuplicates } from './notes';

vi.mock('./api', () => ({
  request: vi.fn(),
}));

describe('duplicate lookup', () => {
  it('does not send an invalid empty request', async () => {
    const result = await findDuplicates('deck', []);

    expect(result).toEqual([]);
  });
  it('compares long Basic/Cloze identities within the supported wire limit and deduplicates keys', async () => {
    vi.mocked(request).mockReset().mockResolvedValue({ matches: [] });
    await findDuplicates('deck', ['  SAME term ', 'same term', 'x'.repeat(2000), '   ']);
    expect(request).toHaveBeenCalledExactlyOnceWith('/notes/duplicates', {
      method: 'POST',
      body: { deckId: 'deck', terms: ['same term', 'x'.repeat(200)] },
    });
  });
  it('bounds duplicate request concurrency and retains source chunk order when answers reorder', async () => {
    const pending: (() => void)[] = [];
    let inFlight = 0;
    let peak = 0;
    vi.mocked(request)
      .mockReset()
      .mockImplementation(
        (_, options) =>
          new Promise((resolve) => {
            inFlight++;
            peak = Math.max(peak, inFlight);
            const term = (options!.body as { terms: string[] }).terms[0]!;
            pending.push(() => {
              inFlight--;
              resolve({ matches: [{ term }] });
            });
          }),
      );
    const lookup = findDuplicates(
      'deck',
      Array.from({ length: 2500 }, (_, i) => `term ${i}`),
    );
    expect(pending).toHaveLength(2);
    pending[1]!();
    await Promise.resolve();
    expect(pending).toHaveLength(3);
    pending[2]!();
    pending[0]!();
    expect((await lookup).map((match) => match.term)).toEqual(['term 0', 'term 1000', 'term 2000']);
    expect(peak).toBe(2);
    const controller = new AbortController();
    controller.abort();
    await expect(findDuplicates('deck', ['term'], controller.signal)).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(3);
  });
});

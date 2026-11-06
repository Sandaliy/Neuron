import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { recentNoteCursor } from '@neuron/shared';
import type { Note } from '@neuron/shared';

import { request } from './api';
import { findDuplicates, noteListQuery } from './notes';

const state = vi.hoisted(() => ({ accountId: 'reader', visit: 1, available: false }));
const fixtures = vi.hoisted(() => ({ creations: vi.fn(), read: vi.fn() }));
vi.mock('./offline', () => ({ offlineState: () => state, accountEpoch: () => state.visit }));
vi.mock('./collection-transport', () => ({ collectionRead: fixtures.read }));
vi.mock('./note-creation', () => ({
  noteCreations: fixtures.creations,
  creationNote: (note: unknown) => note,
  unsentCreation: () => true,
}));

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

it('merges pending creations into their timestamp page, including corrected device clocks, and guards late account reads', async () => {
  const id = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`;
  const note = (n: number, date: string) =>
    ({
      id: id(n),
      deckId: 'deck',
      fields: { term: 'Word', translation: 'Meaning' },
      tags: [],
      noteType: 'vocab',
      source: null,
      rank: null,
      status: 'active',
      importBatchId: null,
      rev: 0,
      createdAt: date,
      updatedAt: date,
    }) as Note;
  const newer = note(1, '2026-11-03T00:00:00.000Z');
  const boundary = note(2, '2026-11-02T00:00:00.000Z');
  const older = note(3, '2026-11-01T00:00:00.000Z');
  fixtures.creations.mockResolvedValue([newer, older]);
  const cursor = recentNoteCursor('created-desc', boundary.createdAt, boundary.id);
  fixtures.read.mockResolvedValue({ items: [boundary], nextCursor: cursor });
  const query = noteListQuery({ sort: 'created-desc' });
  const client = new QueryClient();
  const signal = new AbortController().signal;
  const first = await query.queryFn({ pageParam: undefined, client, signal });
  expect(first.items.map((row) => row.id)).toEqual([newer.id, boundary.id]);
  expect(first.unsent).toEqual([newer.id]);
  fixtures.read.mockResolvedValue({ items: [] });
  const second = await query.queryFn({ pageParam: cursor, client, signal });
  expect(second.items.map((row) => row.id)).toEqual([older.id]);
  fixtures.creations.mockImplementationOnce(async () => {
    state.visit++;
    return [newer];
  });
  await expect(query.queryFn({ pageParam: undefined, client, signal })).rejects.toThrow(
    'Collection read ended',
  );
  client.clear();
});

import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { recentNoteCursor } from '@neuron/shared';
import type { Note } from '@neuron/shared';

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

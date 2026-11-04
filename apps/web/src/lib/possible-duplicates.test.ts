import { beforeEach, describe, expect, it, vi } from 'vitest';

import { localDuplicateGroups, localDuplicateNotes } from './possible-duplicates';

const state = vi.hoisted(() => ({ accountId: 'reader', visit: 1 }));
const storage = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('./collection-read', () => ({ duplicateCollection: storage.read }));
vi.mock('./offline', () => ({
  accountEpoch: () => state.visit,
  offlineState: () => ({ accountId: state.accountId }),
  useOffline: vi.fn(),
}));
vi.mock('./note-outbox', () => ({ onNoteOutboxChange: vi.fn() }));
const date = '2026-11-03T00:00:00Z';
const note = (id: string, term: string, deckId = 'a') => ({
  id,
  deckId,
  noteType: 'vocab',
  fields: { term, translation: `meaning ${id}` },
  tags: [],
  source: 'source',
  status: 'active',
  rank: null,
  importBatchId: null,
  createdAt: date,
  updatedAt: date,
  rev: 1,
});
function collection() {
  return {
    browseVersion: 0,
    unsent: new Set(['3']),
    notes: [note('1', 'BANK'), note('2', ' bank ', 'b'), note('3', 'bank'), note('4', 'unique')],
    decks: ['a', 'b'].map((id) => ({
      id,
      parentId: null,
      kind: 'deck',
      name: id,
      position: 0,
      path: [],
      settings: null,
      createdAt: date,
      updatedAt: date,
      rev: 1,
    })),
  };
}
beforeEach(() => {
  state.accountId = 'reader';
  state.visit = 1;
  storage.read.mockReset();
});
describe('complete downloaded duplicate pages', () => {
  it('counts full matching groups and keeps Deck scope and pending provenance', async () => {
    storage.read.mockResolvedValue(collection());
    expect((await localDuplicateGroups(undefined, 'meaning 2')).items).toEqual([
      { key: 'bank', count: 3 },
    ]);
    expect((await localDuplicateGroups('a', '')).items).toEqual([{ key: 'bank', count: 2 }]);
    expect((await localDuplicateGroups('b', '')).items).toEqual([]);
    expect(
      (await localDuplicateNotes(undefined, 'bank')).items.find((note) => note.id === '3')?.pending,
    ).toBe(true);
    expect((await localDuplicateNotes('b', 'bank')).items).toEqual([]);
  });
  it('rebuilds after local Note changes and refuses incomplete downloads', async () => {
    const rows = collection();
    storage.read.mockResolvedValue(rows);
    expect((await localDuplicateGroups(undefined, '')).items[0]?.count).toBe(3);
    rows.notes[0] = note('1', 'edited');
    rows.browseVersion++;
    expect((await localDuplicateGroups(undefined, '')).items[0]?.count).toBe(2);
    storage.read.mockRejectedValue(new Error('collection_incomplete'));
    await expect(localDuplicateGroups(undefined, '')).rejects.toThrow('collection_incomplete');
  });
  it('cannot publish a late collection after the account visit changes', async () => {
    let deliver!: (value: ReturnType<typeof collection>) => void;
    storage.read.mockReturnValue(
      new Promise((resolve) => {
        deliver = resolve;
      }),
    );
    const pending = localDuplicateGroups(undefined, '');
    state.accountId = 'other';
    state.visit++;
    deliver(collection());
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('uses bounded group and member value cursors', async () => {
    const rows = collection();
    rows.notes = Array.from({ length: 2400 }, (_, at) =>
      note(String(at).padStart(5, '0'), at < 1000 ? 'large' : `pair ${Math.floor(at / 2)}`),
    );
    storage.read.mockResolvedValue(rows);
    const page = await localDuplicateGroups(undefined, '');
    const next = await localDuplicateGroups(undefined, '', page.nextCursor);
    expect(page.items).toHaveLength(50);
    expect(next.items).toHaveLength(50);
    expect(next.items.every((group) => group.key > page.nextCursor!)).toBe(true);
    const members = await localDuplicateNotes(undefined, 'large');
    expect(members.items).toHaveLength(100);
    expect((await localDuplicateNotes(undefined, 'large', members.nextCursor)).items[0]?.id).toBe(
      '00100',
    );
  });
});

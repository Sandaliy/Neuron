import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearCollectionProjection, localNotes, projectCollectionNote } from './collection-read';

import type { CollectionRow } from './collection-db';
import type { PendingNoteEdit } from './note-outbox';

const state = vi.hoisted(() => ({ accountId: 'reader', visit: 1, version: 0, cursor: 2 }));
const storage = vi.hoisted(() => ({
  snapshot: vi.fn(),
  openCollection: vi.fn(async () => ({ close: vi.fn() })),
}));
vi.mock('./collection-db', () => ({
  openCollection: storage.openCollection,
  snapshot: storage.snapshot,
  metadata: async () => ({ cursor: state.cursor, complete: true, outboxVersion: state.version }),
}));
vi.mock('./offline', () => ({
  accountEpoch: () => state.visit,
  offlineState: () => ({ accountId: state.accountId }),
  offlineReadFailed: vi.fn(),
}));

const id = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const date = '2026-11-01T00:00:00.000Z';
function envelope(entity: CollectionRow['entity'], row: Record<string, unknown>): CollectionRow {
  return { entity, id: String(row['id']), rev: 2, deleted: false, purged: false, row };
}
function deck(n: number, parentId: string | null, kind = 'deck') {
  return envelope('decks', {
    id: id(n),
    parentId,
    kind,
    name: `Deck ${n}`,
    position: n,
    settings: null,
    createdAt: date,
    updatedAt: date,
    rev: 2,
  });
}
function note(n: number, deckId = id(3)) {
  return envelope('notes', {
    id: id(n),
    deckId,
    noteType: 'vocab',
    fields: { term: `Word ${n}`, translation: 'shared meaning' },
    tags: ['saved'],
    source: 'Lesson',
    rank: n,
    status: 'active',
    importBatchId: null,
    createdAt: date,
    updatedAt: date,
    rev: 2,
  });
}
function fixture(notes = [note(10), note(11, id(4))]) {
  return {
    decks: [deck(1, null, 'folder'), deck(2, id(1), 'folder'), deck(3, id(2)), deck(4, null)],
    notes,
    cards: [],
    outbox: [],
    creations: [],
  };
}
beforeEach(() => {
  clearCollectionProjection();
  Object.assign(state, { accountId: 'reader', visit: 1, version: 0, cursor: 2 });
  storage.snapshot.mockReset();
  storage.snapshot.mockResolvedValue(fixture());
});

describe('downloaded account-wide Note browsing', () => {
  it('finds translations and tags across nested Decks, excluding tombstones and missing ancestry', async () => {
    const rows = fixture();
    rows.decks.push({ ...deck(5, null, 'folder'), deleted: true }, deck(6, id(5)));
    rows.notes.push(
      { ...note(12), deleted: true },
      { ...note(13), purged: true, row: {} },
      note(14, id(6)),
    );
    storage.snapshot.mockResolvedValue(rows);
    expect((await localNotes({ search: 'SHARED' })).items.map((item) => item.id)).toEqual([
      id(10),
      id(11),
    ]);
    expect(
      (
        await localNotes({
          search: 'saved',
          tag: 'saved',
          source: 'Lesson',
          status: 'active',
          sort: 'rank',
        })
      ).items,
    ).toHaveLength(2);
    expect((await localNotes({ search: 'missing' })).items).toEqual([]);
    expect(storage.snapshot).toHaveBeenCalledTimes(1);
  });

  it('paginates 6000 matches without scanning or sorting again for each page', async () => {
    storage.snapshot.mockResolvedValue(
      fixture(Array.from({ length: 6000 }, (_, at) => note(100 + at, id(at % 2 ? 3 : 4)))),
    );
    const compare = vi.spyOn(String.prototype, 'localeCompare');
    try {
      const first = await localNotes({ search: 'shared', sort: 'alpha' });
      expect(first.items).toHaveLength(1000);
      const comparisons = compare.mock.calls.length;
      const second = await localNotes({ search: 'shared', sort: 'alpha' }, first.nextCursor);
      expect(second.items).toHaveLength(1000);
      expect(compare).toHaveBeenCalledTimes(comparisons);
      expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(2000);
      expect(storage.snapshot).toHaveBeenCalledTimes(1);
    } finally {
      compare.mockRestore();
    }
  });

  it('invalidates cached matches after an edit, a pull and an account switch', async () => {
    expect((await localNotes({ search: 'changed' })).items).toEqual([]);
    const original = note(10);
    state.version++;
    const edit: PendingNoteEdit = {
      kind: 'note-edit',
      operationId: id(99),
      sequence: 1,
      accountId: 'reader',
      entityId: id(10),
      payload: { accountId: 'reader', operationId: id(99), baseRev: 2, fields: {}, tags: [] },
      base: original,
      working: { fields: { term: 'Changed', translation: 'Updated meaning' }, tags: [] },
      started: false,
      state: 'draft',
    };
    projectCollectionNote('reader', id(10), edit, state.version);
    expect((await localNotes({ search: 'changed' })).items.map((item) => item.id)).toEqual([
      id(10),
    ]);
    expect(storage.snapshot).toHaveBeenCalledTimes(1);
    state.cursor++;
    storage.snapshot.mockResolvedValue(fixture([]));
    expect((await localNotes({ search: 'changed' })).items).toEqual([]);
    state.accountId = 'other';
    state.visit++;
    expect((await localNotes({ search: 'shared' })).items).toEqual([]);
    expect(storage.snapshot).toHaveBeenCalledTimes(3);
  });
});

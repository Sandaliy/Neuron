import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearCollectionProjection,
  localNotes,
  localNoteCategories,
  projectCollectionNote,
} from './collection-read';
import { localDuplicateGroups, localDuplicateNotes } from './possible-duplicates';

import type { CollectionRow } from './collection-db';
import type { PendingNoteEdit } from './note-outbox';

const state = vi.hoisted(() => ({
  accountId: 'reader',
  visit: 1,
  version: 0,
  cursor: 2,
  available: true,
}));
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
  offlineState: () => ({ accountId: state.accountId, available: state.available }),
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
  Object.assign(state, { accountId: 'reader', visit: 1, version: 0, cursor: 2, available: true });
  storage.snapshot.mockReset();
  storage.snapshot.mockResolvedValue(fixture());
});

describe('downloaded account-wide Note browsing', () => {
  it.each(['created-desc', 'updated-desc'] as const)(
    'pages %s timestamps and ties across Decks without a mutable row lookup',
    async (sort) => {
      const rows = fixture([note(10), note(11, id(4)), note(12), note(13)]);
      rows.notes[0]!.row['createdAt'] = '2026-11-02T00:00:00.000001Z';
      rows.notes[0]!.row['updatedAt'] = '2026-11-02T00:00:00.000001Z';
      storage.snapshot.mockResolvedValue(rows);
      const first = await localNotes({ sort }, undefined, 2);
      expect(first.items.map((row) => row.id)).toEqual([id(10), id(13)]);
      // Rebuild the projection after a pull changes the boundary row and removes a seen Note.
      rows.notes[0]!.deleted = true;
      rows.notes[3]!.row['createdAt'] = '2026-11-03T00:00:00.000000Z';
      rows.notes[3]!.row['updatedAt'] = '2026-11-03T00:00:00.000000Z';
      state.cursor++;
      const second = await localNotes({ sort }, first.nextCursor, 2);
      expect(second.items.map((row) => row.id)).toEqual([id(12), id(11)]);
      expect(
        (
          await localNotes({
            sort,
            tag: 'saved',
            source: 'Lesson',
            search: 'meaning',
            status: 'active',
          })
        ).items.map((row) => row.id),
      ).toEqual([id(13), id(12), id(11)]);
      state.accountId = 'other';
      state.visit++;
      storage.snapshot.mockResolvedValue(fixture([]));
      expect((await localNotes({ sort })).items).toEqual([]);
    },
  );
  it('shares live rows and edit invalidation between category browsing and duplicate inspection', async () => {
    const rows = fixture();
    rows.notes[0]!.row['fields'] = { term: ' BANK ', translation: 'River' };
    rows.notes[1]!.row['fields'] = { term: 'bank', translation: 'Finance' };
    rows.decks.push({ ...deck(5, null, 'folder'), deleted: true }, deck(6, id(5)));
    const hidden = note(12, id(6));
    hidden.row['fields'] = { term: 'Bank', translation: 'Hidden' };
    rows.notes.push(hidden, { ...note(13), deleted: true });
    storage.snapshot.mockResolvedValue(rows);
    expect((await localDuplicateGroups(undefined, '')).items).toEqual([{ key: 'bank', count: 2 }]);
    expect((await localNoteCategories({ kind: 'tag', limit: 100 })).items).toEqual([
      { value: 'saved', count: 2 },
    ]);
    expect((await localNotes({ tag: 'saved' })).items.map((row) => row.id)).toEqual([
      id(10),
      id(11),
    ]);
    expect((await localDuplicateNotes(undefined, 'bank')).items.map((row) => row.id)).toEqual([
      id(10),
      id(11),
    ]);
    state.version++;
    projectCollectionNote(
      'reader',
      id(10),
      {
        kind: 'note-edit',
        operationId: id(99),
        sequence: 1,
        accountId: 'reader',
        entityId: id(10),
        payload: { accountId: 'reader', operationId: id(99), baseRev: 2, fields: {}, tags: [] },
        base: rows.notes[0]!,
        working: { fields: { term: 'Updated', translation: 'River' }, tags: ['local'] },
        started: false,
        state: 'draft',
      },
      state.version,
    );
    expect((await localNoteCategories({ kind: 'tag', limit: 100 })).items).toEqual([
      { value: 'local', count: 1 },
      { value: 'saved', count: 1 },
    ]);
    expect((await localDuplicateGroups(undefined, '')).items).toEqual([]);
    expect((await localDuplicateNotes(undefined, 'bank')).items).toEqual([]);
    expect((await localNotes({ tag: 'local' })).items[0]?.fields['term']).toBe('Updated');
    expect(storage.snapshot).toHaveBeenCalledTimes(1);
    expect(storage.snapshot.mock.calls[0]?.[1]).toBe(false);
    state.visit++;
    state.accountId = 'other';
    storage.snapshot.mockResolvedValue(fixture([]));
    expect((await localDuplicateGroups(undefined, '')).items).toEqual([]);
    expect((await localNoteCategories({ kind: 'tag', limit: 100 })).items).toEqual([]);
  });

  it('counts exact metadata over 6000 Notes, de-duplicates tags and omits unavailable ancestry', async () => {
    const rows = fixture(
      Array.from({ length: 6000 }, (_, at) => {
        const row = note(100 + at, id(at % 2 ? 3 : 4));
        row.row['tags'] = ['shared', 'shared', '', ' ', `tag ${at % 500}`];
        row.row['source'] = at % 2 ? 'Course' : 'course';
        return row;
      }),
    );
    rows.decks.push({ ...deck(5, null, 'folder'), deleted: true }, deck(6, id(5)));
    rows.notes.push(
      note(7000, id(6)),
      { ...note(7001), deleted: true },
      { ...note(7002), purged: true },
    );
    storage.snapshot.mockResolvedValue(rows);
    const first = await localNoteCategories({ kind: 'tag', limit: 100 });
    expect(first.total).toBe(501);
    expect(first.items.find((row) => row.value === 'shared')?.count).toBe(6000);
    expect(first.items.every((row) => row.value === 'shared' || row.count === 12)).toBe(true);
    expect(first.items).toHaveLength(100);
    const second = await localNoteCategories({ kind: 'tag', limit: 100, cursor: first.nextCursor });
    expect(new Set([...first.items, ...second.items].map((row) => row.value)).size).toBe(200);
    expect((await localNotes({ tag: 'shared' })).items).toHaveLength(1000);
    expect(await localNoteCategories({ kind: 'source', limit: 100 })).toMatchObject({
      items: [
        { value: 'Course', count: 3000 },
        { value: 'course', count: 3000 },
      ],
      total: 2,
      local: true,
    });
    expect(storage.snapshot).toHaveBeenCalledTimes(1);
    state.available = false;
    await expect(localNoteCategories({ kind: 'tag', limit: 100 })).rejects.toThrow(
      'collection_incomplete',
    );
  });

  it('recomputes categories after a local edit, pull and account switch without persisting an index', async () => {
    expect((await localNoteCategories({ kind: 'tag', limit: 100 })).items).toEqual([
      { value: 'saved', count: 2 },
    ]);
    state.version++;
    const edit: PendingNoteEdit = {
      kind: 'note-edit',
      operationId: id(99),
      sequence: 1,
      accountId: 'reader',
      entityId: id(10),
      payload: { accountId: 'reader', operationId: id(99), baseRev: 2, fields: {}, tags: [] },
      base: note(10),
      working: {
        fields: { term: 'Changed', translation: 'Meaning' },
        tags: [' changed ', 'changed'],
      },
      started: false,
      state: 'draft',
    };
    projectCollectionNote('reader', id(10), edit, state.version);
    expect((await localNoteCategories({ kind: 'tag', limit: 100 })).items).toEqual([
      { value: ' changed ', count: 1 },
      { value: 'changed', count: 1 },
      { value: 'saved', count: 1 },
    ]);
    expect((await localNotes({ tag: ' changed ' })).items.map((row) => row.id)).toEqual([id(10)]);
    expect(storage.snapshot).toHaveBeenCalledTimes(1);
    state.cursor++;
    storage.snapshot.mockResolvedValue(fixture([]));
    expect((await localNoteCategories({ kind: 'tag', limit: 100 })).items).toEqual([]);
    state.accountId = 'other';
    state.visit++;
    expect((await localNoteCategories({ kind: 'source', limit: 100 })).items).toEqual([]);
  });
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

  it.each(['created-desc', 'updated-desc'] as const)(
    'reuses the sorted download for bounded %s pages',
    async (sort) => {
      storage.snapshot.mockResolvedValue(
        fixture(Array.from({ length: 6000 }, (_, at) => note(100 + at, id(at % 2 ? 3 : 4)))),
      );
      const compare = vi.spyOn(String.prototype, 'localeCompare');
      try {
        const first = await localNotes({ sort });
        const comparisons = compare.mock.calls.length;
        const second = await localNotes({ sort }, first.nextCursor);
        expect(first.items).toHaveLength(1000);
        expect(second.items).toHaveLength(1000);
        expect(new Set([...first.items, ...second.items].map((row) => row.id)).size).toBe(2000);
        expect(compare.mock.calls.length - comparisons).toBeLessThan(16);
        expect(storage.snapshot).toHaveBeenCalledTimes(1);
      } finally {
        compare.mockRestore();
      }
    },
  );

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

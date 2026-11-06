import { expect, it } from 'vitest';

import { listNotesSchema, NOTE_SORTS } from './api/notes.js';
import { compareRecentNotes, readRecentNoteCursor, recentNoteCursor } from './note-recency.js';

const id = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const note = (n: number, createdAt: string, updatedAt = createdAt) => ({
  id: id(n),
  createdAt,
  updatedAt,
});

it('orders actual instants, microseconds and identical timestamps deterministically without extending learning orders', () => {
  const rows = [
    note(4, '2026-11-01T00:00:00.000001Z'),
    note(3, '2026-11-01T00:00:00.000002Z'),
    note(1, '2026-11-01T00:00:00.000002Z'),
    note(2, '2026-11-01T03:00:00.001+03:00'),
  ];
  expect(
    [...rows].sort((a, b) => compareRecentNotes(a, b, 'created-desc')).map((row) => row.id),
  ).toEqual([id(2), id(3), id(1), id(4)]);
  expect(NOTE_SORTS).toEqual(['created', 'alpha', 'rank']);
});

it('validates a bounded captured timestamp cursor and refuses a cursor for another sort', () => {
  const cursor = recentNoteCursor('updated-desc', '2026-11-01T00:00:00.123456Z', id(1));
  expect(readRecentNoteCursor(cursor)).toEqual({
    sort: 'updated-desc',
    timestamp: '2026-11-01T00:00:00.123456Z',
    id: id(1),
  });
  expect(listNotesSchema.safeParse({ sort: 'updated-desc', cursor }).success).toBe(true);
  for (const invalid of [
    id(1),
    cursor + '|extra',
    cursor.replace('2026-11-01', '2026-99-99'),
    cursor.replace(id(1), 'bad'),
  ]) {
    expect(listNotesSchema.safeParse({ sort: 'updated-desc', cursor: invalid }).success).toBe(
      false,
    );
  }
  expect(listNotesSchema.safeParse({ sort: 'created-desc', cursor }).success).toBe(false);
});

import { z } from 'zod';

import type { Note, NoteBrowseSort as NoteSort } from './api/notes.js';

export type RecentNoteSort = 'created-desc' | 'updated-desc';
export function isRecentNoteSort(sort: NoteSort | undefined): sort is RecentNoteSort {
  return sort === 'created-desc' || sort === 'updated-desc';
}

export function recentNoteTime(note: Pick<Note, 'createdAt' | 'updatedAt'>, sort: RecentNoteSort) {
  return sort === 'created-desc' ? note.createdAt : note.updatedAt;
}

/** Retain PostgreSQL microseconds as well as the device's millisecond instants. */
export function compareRecentNotes(
  a: Pick<Note, 'id' | 'createdAt' | 'updatedAt'>,
  b: Pick<Note, 'id' | 'createdAt' | 'updatedAt'>,
  sort: RecentNoteSort,
) {
  const first = recentNoteTime(a, sort);
  const second = recentNoteTime(b, sort);
  const fraction = (value: string) => (value.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0');
  return (
    Date.parse(second) - Date.parse(first) ||
    fraction(second).localeCompare(fraction(first)) ||
    (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  );
}

/** A captured boundary survives an update, deletion or purge of its original Note. */
export function recentNoteCursor(sort: RecentNoteSort, timestamp: string, id: string) {
  return `recent|${sort}|${timestamp}|${id}`;
}

export function readRecentNoteCursor(cursor: string) {
  const [prefix, sort, timestamp, id, extra] = cursor.split('|');
  if (
    prefix !== 'recent' ||
    !isRecentNoteSort(sort as NoteSort) ||
    extra !== undefined ||
    !z.iso.datetime().safeParse(timestamp).success ||
    !Number.isFinite(Date.parse(timestamp!)) ||
    !z.guid().safeParse(id).success
  )
    return undefined;
  return { sort: sort as RecentNoteSort, timestamp: timestamp!, id: id! };
}

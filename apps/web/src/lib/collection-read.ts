import { cardSchema, deckSchema, noteSchema, termOf } from '@neuron/shared';
import type { Card, DeckNode, Note } from '@neuron/shared';

import { metadata, openCollection, snapshot } from './collection-db';
import { renameOverlay, validateRenames } from './collection-outbox';
import { noteEditOverlay, validateNoteEdits } from './note-outbox';
import { accountEpoch, offlineReadFailed, offlineState } from './offline';

import type { CollectionRow } from './collection-db';
import type { PendingNoteEdit } from './note-outbox';
import type { NoteQuery } from './notes';

type Collection = {
  decks: ReturnType<typeof deckSchema.parse>[];
  notes: Note[];
  cards: () => Promise<Card[]>;
  originals: Map<string, Note>;
  positions: Map<string, number>;
};
/** Validation stays on the read boundary, but large snapshots must yield to input and paint. */
async function projectRows<T>(
  rows: CollectionRow[],
  project: (row: CollectionRow) => T | undefined,
): Promise<T[]> {
  const values: T[] = [];
  let started = performance.now();
  for (let at = 0; at < rows.length; at++) {
    if (at > 0 && at % 64 === 0 && performance.now() - started >= 6) {
      await new Promise<void>((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          channel.port1.close();
          channel.port2.close();
          resolve();
        };
        channel.port2.postMessage(null);
      });
      started = performance.now();
    }
    const value = project(rows[at]!);
    if (value !== undefined) values.push(value);
  }
  return values;
}
let projection:
  | { key: string; accountId: string; version: number; cards: boolean; value: Promise<Collection> }
  | undefined;
export function clearCollectionProjection() {
  projection = undefined;
}

/** A content edit replaces one projected row; it never reopens the collection stores. */
export function projectCollectionNote(
  accountId: string,
  id: string,
  edit: PendingNoteEdit | undefined,
  version: number,
) {
  const cached = projection;
  if (!cached || cached.accountId !== accountId || cached.version !== version - 1) return;
  cached.version = version;
  cached.value = cached.value.then((rows) => {
    const original = rows.originals.get(id);
    const at = rows.positions.get(id);
    if (original && at !== undefined) rows.notes[at] = noteEditOverlay(edit, original);
    return rows;
  });
}
async function collection(includeCards = false): Promise<Collection> {
  const visit = accountEpoch();
  const id = offlineState().accountId;
  if (!id) throw new Error('collection_no_account');
  try {
    const db = await openCollection(id);
    try {
      const meta = await metadata(db);
      const key = `${visit}:${id}:${meta.cursor}:${meta.complete}`;
      const version = meta.outboxVersion ?? 0;
      if (
        projection?.key === key &&
        projection.version === version &&
        (!includeCards || projection.cards)
      ) {
        const cached = await projection.value;
        if (offlineState().accountId !== id || accountEpoch() !== visit)
          throw new Error('collection_account_changed');
        return cached;
      }
      const value = (async () => {
        const rows = await snapshot(db, includeCards);
        const renames = validateRenames(rows.outbox, id);
        const edits = validateNoteEdits(rows.outbox, id);
        const editsByNote = new Map<string, (typeof edits)[number]>();
        for (const edit of edits) {
          const previous = editsByNote.get(edit.entityId);
          if (!previous || previous.sequence < edit.sequence) editsByNote.set(edit.entityId, edit);
        }
        if (offlineState().accountId !== id || accountEpoch() !== visit)
          throw new Error('collection_account_changed');
        const decks = rows.decks
          .filter((row) => !row.deleted && !row.purged)
          .map((change) =>
            deckSchema.parse({
              ...change.row,
              path: [],
              name: renameOverlay(renames, change.id, change.rev) ?? change.row['name'],
            }),
          );
        const live = new Map(decks.map((deck) => [deck.id, deck]));
        const available = (id: string, visited = new Set<string>()): boolean => {
          const deck = live.get(id);
          if (!deck || visited.has(id)) return false;
          visited.add(id);
          return deck.parentId === null || available(deck.parentId, visited);
        };
        const originals = new Map<string, Note>();
        const notes = await projectRows(rows.notes, (row) =>
          !row.deleted && !row.purged && available(String(row.row['deckId']))
            ? (() => {
                const original = noteSchema.parse(row.row);
                originals.set(row.id, original);
                return noteEditOverlay(editsByNote.get(row.id), original);
              })()
            : undefined,
        );
        const noteIds = new Set(notes.map((note) => note.id));
        const cardRows = rows.cards;
        let parsedCards: Promise<Card[]> | undefined;
        const cards = () =>
          (parsedCards ??= projectRows(cardRows, (row) =>
            !row.deleted && !row.purged && noteIds.has(String(row.row['noteId']))
              ? cardSchema.parse(row.row)
              : undefined,
          )
            .then((cards) => {
              if (offlineState().accountId !== id || accountEpoch() !== visit)
                throw new Error('collection_account_changed');
              return cards;
            })
            .catch((error) => {
              offlineReadFailed(error, visit, id);
              throw error;
            }));
        if (offlineState().accountId !== id || accountEpoch() !== visit)
          throw new Error('collection_account_changed');
        return {
          decks: decks.filter((deck) => available(deck.id)),
          notes,
          cards,
          originals,
          positions: new Map(notes.map((note, index) => [note.id, index])),
        };
      })();
      projection = { key, accountId: id, version, cards: includeCards, value };
      try {
        return await value;
      } catch (error) {
        if (projection?.value === value) projection = undefined;
        throw error;
      }
    } finally {
      db.close();
    }
  } catch (error) {
    offlineReadFailed(error, visit, id);
    throw error;
  }
}

export async function localDeckTree(): Promise<{ decks: DeckNode[]; local?: true }> {
  const { decks, notes } = await collection();
  const counts = new Map<string, number>();
  for (const note of notes) counts.set(note.deckId, (counts.get(note.deckId) ?? 0) + 1);
  const nodes = decks.map((deck) => ({
    ...deck,
    children: [] as DeckNode[],
    due: 0,
    fresh: 0,
    noteCount: counts.get(deck.id) ?? 0,
  }));
  const map = new Map(nodes.map((node) => [node.id, node]));
  const roots: DeckNode[] = [];
  for (const node of nodes) {
    const parent = node.parentId === null ? undefined : map.get(node.parentId);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const order = (list: DeckNode[], path: string[]): number => {
    list.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    let count = 0;
    for (const node of list) {
      node.path = path;
      const children = order(node.children as DeckNode[], [...path, node.id]);
      Object.assign(node, { noteCount: (node.noteCount ?? 0) + children });
      count += node.noteCount ?? 0;
    }
    return count;
  };
  order(roots, []);
  return { decks: roots, local: true };
}

export async function localNote(id: string): Promise<{ note: Note; cards: Card[]; local?: true }> {
  const { notes, cards } = await collection(true);
  const note = notes.find((note) => note.id === id);
  if (!note) throw new Error('collection_note_missing');
  return { note, cards: (await cards()).filter((card) => card.noteId === id), local: true };
}

export async function localNotes(
  query: NoteQuery,
  cursor?: string,
  pageSize = 1000,
): Promise<{ items: Note[]; nextCursor?: string; local?: true }> {
  const { notes, cards } = await collection(Boolean(query.cardState));
  const byNote = new Set<string>();
  if (query.cardState)
    for (const card of await cards()) {
      if (card.state === query.cardState) byNote.add(card.noteId);
    }
  const search = query.search?.toLocaleLowerCase();
  const filtered = notes.filter(
    (note) =>
      (!query.deckId || note.deckId === query.deckId) &&
      (!query.status || note.status === query.status) &&
      (!query.tag || note.tags.includes(query.tag)) &&
      (!query.source || note.source === query.source) &&
      (!search ||
        `${JSON.stringify(note.fields)} ${note.tags.join(' ')}`
          .toLocaleLowerCase()
          .includes(search)) &&
      (!query.cardState || byNote.has(note.id)),
  );
  filtered.sort(
    (a, b) =>
      (query.sort === 'alpha'
        ? termOf(a.fields).localeCompare(termOf(b.fields))
        : query.sort === 'rank'
          ? (a.rank ?? Infinity) - (b.rank ?? Infinity)
          : a.createdAt.localeCompare(b.createdAt)) || a.id.localeCompare(b.id),
  );
  const offset = cursor?.startsWith('local:') ? Number(cursor.slice(6)) : 0;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('collection_invalid_cursor');
  const items = filtered.slice(offset, offset + pageSize);
  return {
    items,
    local: true,
    ...(offset + items.length < filtered.length
      ? { nextCursor: `local:${offset + items.length}` }
      : {}),
  };
}

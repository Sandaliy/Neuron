import {
  cardSchema,
  deckSchema,
  noteSchema,
  termOf,
  triageChoiceOf,
  triageFace,
} from '@neuron/shared';
import type { Card, DeckNode, Note, TriageItem, TriageList } from '@neuron/shared';

import { metadata, openCollection, snapshot } from './collection-db';
import { renameOverlay, validateRenames } from './collection-outbox';
import { creationNote, unsentCreation, validateNoteCreations } from './note-creation';
import { noteEditOverlay, validateNoteEdits } from './note-outbox';
import { accountEpoch, offlineReadFailed, offlineState } from './offline';

import type { PendingNoteCreate } from './note-creation';
import type { PendingNoteEdit } from './note-outbox';
import type { NoteQuery } from './notes';

type Collection = {
  decks: ReturnType<typeof deckSchema.parse>[];
  notes: Note[];
  cards: () => Promise<Card[]>;
  originals: Map<string, Note>;
  positions: Map<string, number>;
  /** Every Note id the download holds, tombstones included: those rows own the Note. */
  pulled: Set<string>;
  /** Saved on this device and not yet acknowledged: no Cards and no learning. */
  unsent: Set<string>;
  liveDecks: Set<string>;
  /** One bounded browse result; cursor pages reuse its filtering and ordering. */
  browse?: { key: string; items: Note[] } | undefined;
  searchText: WeakMap<Note, string>;
  browseVersion: number;
};
/** Validation stays on the read boundary, but large snapshots must yield to input and paint. */
async function projectRows<Row, T>(
  rows: Row[],
  project: (row: Row) => T | undefined,
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

/** A new Note saved, edited or settled on this device replaces one projected row. */
export function projectCollectionCreation(
  accountId: string,
  entry: PendingNoteCreate,
  edit: PendingNoteEdit | undefined,
  version: number,
) {
  const cached = projection;
  if (!cached || cached.accountId !== accountId || cached.version !== version - 1) return;
  cached.version = version;
  cached.value = cached.value.then((rows) => {
    rows.browse = undefined;
    rows.browseVersion++;
    const id = entry.entityId;
    if (rows.pulled.has(id)) return rows;
    if (unsentCreation(entry)) rows.unsent.add(id);
    else rows.unsent.delete(id);
    const at = rows.positions.get(id);
    const shown = entry.state !== 'resolved' && rows.liveDecks.has(entry.payload.deckId);
    if (!shown) {
      rows.originals.delete(id);
      if (at !== undefined) {
        rows.notes.splice(at, 1);
        rows.positions = new Map(rows.notes.map((note, index) => [note.id, index]));
      }
      return rows;
    }
    const original = creationNote(entry);
    rows.originals.set(id, original);
    const note = noteEditOverlay(edit, original);
    if (at === undefined) {
      rows.positions.set(id, rows.notes.length);
      rows.notes.push(note);
    } else rows.notes[at] = note;
    return rows;
  });
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
    rows.browse = undefined;
    rows.browseVersion++;
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
        const pulled = new Set(rows.notes.map((row) => row.id));
        const unsent = new Set<string>();
        for (const entry of validateNoteCreations(rows.creations, id)) {
          if (entry.state === 'resolved' || pulled.has(entry.entityId)) continue;
          if (unsentCreation(entry)) unsent.add(entry.entityId);
          const original = creationNote(entry);
          if (!available(original.deckId)) continue;
          originals.set(entry.entityId, original);
          notes.push(noteEditOverlay(editsByNote.get(entry.entityId), original));
        }
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
        const liveDecks = decks.filter((deck) => available(deck.id));
        return {
          decks: liveDecks,
          notes,
          cards,
          originals,
          positions: new Map(notes.map((note, index) => [note.id, index])),
          pulled,
          unsent,
          liveDecks: new Set(liveDecks.map((deck) => deck.id)),
          searchText: new WeakMap<Note, string>(),
          browseVersion: 0,
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

/** Complete, account-visit-bound presentation, without opening the Cards store. */
export async function duplicateCollection() {
  return collection();
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
  /** Learning pools leave out Notes the server has not acknowledged. */
  sentOnly = false,
): Promise<{ items: Note[]; nextCursor?: string; local?: true; unsent?: string[] }> {
  const visit = accountEpoch();
  const accountId = offlineState().accountId;
  const projected = await collection(Boolean(query.cardState));
  const version = projected.browseVersion;
  const { notes: all, cards, unsent, searchText } = projected;
  const key = JSON.stringify([
    query.deckId,
    query.status,
    query.tag,
    query.source,
    query.cardState,
    query.search,
    query.sort,
    sentOnly,
  ]);
  let filtered = projected.browse?.key === key ? projected.browse.items : undefined;
  if (!filtered) {
    const notes = sentOnly ? all.filter((note) => !unsent.has(note.id)) : all;
    const byNote = new Set<string>();
    if (query.cardState)
      for (const card of await cards()) {
        if (card.state === query.cardState) byNote.add(card.noteId);
      }
    const search = query.search?.toLocaleLowerCase();
    const searchable = (note: Note) => {
      let text = searchText.get(note);
      if (text === undefined) {
        text = `${JSON.stringify(note.fields)} ${note.tags.join(' ')}`.toLocaleLowerCase();
        searchText.set(note, text);
      }
      return text;
    };
    filtered = await projectRows(notes, (note) =>
      (!query.deckId || note.deckId === query.deckId) &&
      (!query.status || note.status === query.status) &&
      (!query.tag || note.tags.includes(query.tag)) &&
      (!query.source || note.source === query.source) &&
      (!search || searchable(note).includes(search)) &&
      (!query.cardState || byNote.has(note.id))
        ? note
        : undefined,
    );
    filtered.sort(
      (a, b) =>
        (query.sort === 'alpha'
          ? termOf(a.fields).localeCompare(termOf(b.fields))
          : query.sort === 'rank'
            ? (a.rank ?? Infinity) - (b.rank ?? Infinity)
            : a.createdAt.localeCompare(b.createdAt)) || a.id.localeCompare(b.id),
    );
    if (accountEpoch() !== visit || offlineState().accountId !== accountId)
      throw new Error('collection_account_changed');
    if (projected.browseVersion !== version) return localNotes(query, cursor, pageSize, sentOnly);
    projected.browse = { key, items: filtered };
  }
  const offset = cursor?.startsWith('local:') ? Number(cursor.slice(6)) : 0;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('collection_invalid_cursor');
  const items = filtered.slice(offset, offset + pageSize);
  const waiting = items.filter((note) => unsent.has(note.id)).map((note) => note.id);
  return {
    items,
    local: true,
    ...(waiting.length ? { unsent: waiting } : {}),
    ...(offset + items.length < filtered.length
      ? { nextCursor: `local:${offset + items.length}` }
      : {}),
  };
}

/**
 * Triage from the downloaded collection, built by the same rules as the server's
 * answer: Notes under the Folder or Deck, in source order, without one answered
 * Card. Set aside and Draft Notes are counted and left out. A Note saved on this
 * device and not yet acknowledged is not in the server's list either: a decision
 * about it would arrive before the Note and be refused as missing.
 */
export async function localTriage(deckId: string): Promise<TriageList & { local: true }> {
  const { decks, notes: all, cards, unsent } = await collection(true);
  const notes = all.filter((note) => !unsent.has(note.id));
  const parents = new Map(decks.map((deck) => [deck.id, deck.parentId]));
  if (!parents.has(deckId)) throw new Error('collection_deck_missing');
  const under = (id: string) => {
    const seen = new Set<string>();
    for (let at: string | null | undefined = id; at && !seen.has(at); at = parents.get(at)) {
      if (at === deckId) return true;
      seen.add(at);
    }
    return false;
  };
  const studied = new Set<string>();
  for (const card of await cards()) if (card.state !== 'new') studied.add(card.noteId);
  const items: TriageItem[] = [];
  let left = 0;
  let aside = 0;
  for (const note of [...notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (!under(note.deckId)) continue;
    const choice = triageChoiceOf(note.status, note.triage);
    if (choice === undefined) aside++;
    else if (studied.has(note.id)) left++;
    else
      items.push({
        id: note.id,
        deckId: note.deckId,
        noteType: note.noteType,
        rank: note.rank,
        choice,
        ...triageFace(note.noteType, note.fields),
      });
  }
  return { items, studied: left, setAside: aside, local: true };
}

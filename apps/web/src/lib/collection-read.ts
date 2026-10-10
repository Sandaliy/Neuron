import { cardSchema, deckSchema, noteSchema, termOf } from '@neuron/shared';
import type { Card, DeckNode, Note } from '@neuron/shared';

import { metadata, openCollection, snapshot } from './collection-db';
import { renameOverlay, validateRenames } from './collection-outbox';
import { accountEpoch, offlineReadFailed, offlineState } from './offline';

import type { NoteQuery } from './notes';

type Collection = { decks: ReturnType<typeof deckSchema.parse>[]; notes: Note[]; cards: Card[] };
let projection: { key: string; value: Promise<Collection> } | undefined;
export function clearCollectionProjection() {
  projection = undefined;
}
async function collection(): Promise<Collection> {
  const visit = accountEpoch();
  const id = offlineState().accountId;
  if (!id) throw new Error('collection_no_account');
  try {
    const db = await openCollection(id);
    try {
      const meta = await metadata(db);
      const key = `${visit}:${id}:${meta.cursor}:${meta.outboxVersion ?? 0}:${meta.complete}`;
      if (projection?.key === key) {
        const cached = await projection.value;
        if (offlineState().accountId !== id || accountEpoch() !== visit)
          throw new Error('collection_account_changed');
        return cached;
      }
      const value = (async () => {
        const rows = await snapshot(db);
        validateRenames(rows.outbox, id);
        if (offlineState().accountId !== id || accountEpoch() !== visit)
          throw new Error('collection_account_changed');
        const decks = rows.decks
          .filter((row) => !row.deleted && !row.purged)
          .map((change) =>
            deckSchema.parse({
              ...change.row,
              path: [],
              name: renameOverlay(rows.outbox, change.id, change.rev) ?? change.row['name'],
            }),
          );
        const live = new Map(decks.map((deck) => [deck.id, deck]));
        const available = (id: string, visited = new Set<string>()): boolean => {
          const deck = live.get(id);
          if (!deck || visited.has(id)) return false;
          visited.add(id);
          return deck.parentId === null || available(deck.parentId, visited);
        };
        const notes = rows.notes
          .filter((row) => !row.deleted && !row.purged && available(String(row.row['deckId'])))
          .map((change) => noteSchema.parse(change.row));
        const noteIds = new Set(notes.map((note) => note.id));
        const cards = rows.cards
          .filter((row) => !row.deleted && !row.purged && noteIds.has(String(row.row['noteId'])))
          .map((change) => cardSchema.parse(change.row));
        return { decks: decks.filter((deck) => available(deck.id)), notes, cards };
      })();
      projection = { key, value };
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
  const { notes, cards } = await collection();
  const note = notes.find((note) => note.id === id);
  if (!note) throw new Error('collection_note_missing');
  return { note, cards: cards.filter((card) => card.noteId === id), local: true };
}

export async function localNotes(
  query: NoteQuery,
  cursor?: string,
  pageSize = 1000,
): Promise<{ items: Note[]; nextCursor?: string; local?: true }> {
  const { notes, cards } = await collection();
  const byNote = new Map<string, Card[]>();
  for (const card of cards) byNote.set(card.noteId, [...(byNote.get(card.noteId) ?? []), card]);
  const filtered = notes.filter(
    (note) =>
      (!query.deckId || note.deckId === query.deckId) &&
      (!query.status || note.status === query.status) &&
      (!query.tag || note.tags.includes(query.tag)) &&
      (!query.source || note.source === query.source) &&
      (!query.search ||
        `${JSON.stringify(note.fields)} ${note.tags.join(' ')}`
          .toLocaleLowerCase()
          .includes(query.search.toLocaleLowerCase())) &&
      (!query.cardState || byNote.get(note.id)?.some((card) => card.state === query.cardState)),
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

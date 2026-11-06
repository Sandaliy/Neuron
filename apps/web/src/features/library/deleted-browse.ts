import { termOf } from '@neuron/shared';
import type { DeletedDeck, DeletedNote } from '@neuron/shared';

export type DeletedSort = 'original' | 'alpha' | 'reverse' | 'location';

export const searchText = (value: string) => value.normalize('NFC').toLowerCase();

/** Index content once per response, rather than walking Note fields while typing. */
function contentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(contentText).join(' ');
  if (value && typeof value === 'object') return Object.values(value).map(contentText).join(' ');
  return '';
}

export function indexDeletedNotes(notes: readonly DeletedNote[]) {
  return notes.map((note) => ({
    ...note,
    title: termOf(note.fields),
    location: note.deckPath.join(' / '),
    search: searchText(`${contentText(note.fields)} ${note.deckPath.join(' / ')}`),
  }));
}

export function matchesDeleted(text: string, query: string) {
  return query.split(/\s+/).every((word) => text.includes(word));
}

export function sortDeleted<T extends { readonly title: string; readonly location: string }>(
  rows: readonly T[],
  sort: DeletedSort,
) {
  if (sort === 'original') return rows;
  return [...rows].sort((a, b) =>
    sort === 'location'
      ? a.location.localeCompare(b.location) || a.title.localeCompare(b.title)
      : a.title.localeCompare(b.title) * (sort === 'reverse' ? -1 : 1),
  );
}

export function indexDeletedDecks(decks: readonly DeletedDeck[], sort: DeletedSort) {
  const rows = sortDeleted(
    decks.map((deck) => ({
      ...deck,
      title: deck.name,
      location: deck.pathNames.join(' / '),
      search: searchText([...deck.pathNames, deck.name].join(' / ')),
    })),
    sort,
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  const children = new Map<string | null, (typeof rows)[number][]>();
  for (const row of rows) {
    const parent = row.parentId && byId.has(row.parentId) ? row.parentId : null;
    const siblings = children.get(parent) ?? [];
    siblings.push(row);
    children.set(parent, siblings);
  }
  return { rows, byId, children, total: rows.filter((row) => !row.context).length };
}

/** Keep supporting ancestors, but count only matching deleted entities. */
export function browseDeletedDecks(
  index: ReturnType<typeof indexDeletedDecks>,
  query: string,
  collapsed: ReadonlySet<string>,
) {
  const matches = new Set(
    index.rows
      .filter((row) => !row.context && matchesDeleted(row.search, query))
      .map((row) => row.id),
  );
  const included = new Set(matches);
  for (const id of matches) {
    let parent = index.byId.get(id)?.parentId;
    while (parent && !included.has(parent)) {
      included.add(parent);
      parent = index.byId.get(parent)?.parentId;
    }
  }
  const rows: ((typeof index.rows)[number] & {
    depth: number;
    supporting: boolean;
    children: boolean;
  })[] = [];
  const stack = (index.children.get(null) ?? []).map((row) => ({ row, depth: 0 })).reverse();
  while (stack.length) {
    const entry = stack.pop()!;
    if (!included.has(entry.row.id)) continue;
    const children = index.children.get(entry.row.id) ?? [];
    rows.push({
      ...entry.row,
      depth: entry.depth,
      supporting: !matches.has(entry.row.id),
      children: children.length > 0,
    });
    if (query || !collapsed.has(entry.row.id)) {
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push({ row: children[i]!, depth: entry.depth + 1 });
      }
    }
  }
  return { rows, count: matches.size };
}

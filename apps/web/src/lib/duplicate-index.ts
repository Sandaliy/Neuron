import { noteTermKey } from '@neuron/shared';
import type { Deck, Note, PossibleDuplicateNote } from '@neuron/shared';

export interface DuplicateIndexEntry {
  key: string;
  notes: PossibleDuplicateNote[];
  search: string;
}
const terms = new WeakMap<Note, string>();
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Normalize once per immutable Note projection, then reuse across search and cursor pages. */
export async function indexDuplicateNotes(
  notes: readonly Note[],
  decks: readonly Deck[],
  unsent: ReadonlySet<string>,
  yieldToInput: () => Promise<void>,
): Promise<DuplicateIndexEntry[]> {
  const byId = new Map(decks.map((deck) => [deck.id, deck]));
  const paths = new Map<string, string[]>();
  for (const deck of decks) {
    if (deck.kind !== 'deck') continue;
    const chain: string[] = [];
    const seen = new Set<string>();
    let current: Deck | undefined = deck;
    while (current && !seen.has(current.id) && seen.size <= 8) {
      if (current.id !== deck.id && current.kind !== 'folder') break;
      seen.add(current.id);
      chain.unshift(current.name);
      if (current.parentId === null) {
        paths.set(deck.id, chain);
        break;
      }
      current = byId.get(current.parentId);
    }
  }
  const groups = new Map<string, DuplicateIndexEntry>();
  let started = performance.now();
  for (let at = 0; at < notes.length; at++) {
    if (at > 0 && at % 64 === 0 && performance.now() - started >= 6) {
      await yieldToInput();
      started = performance.now();
    }
    const note = notes[at]!;
    const deckPath = paths.get(note.deckId);
    if (!deckPath) continue;
    let key = terms.get(note);
    if (key === undefined) {
      key = noteTermKey(note.fields);
      terms.set(note, key);
    }
    if (!key) continue;
    const group = groups.get(key) ?? { key, notes: [], search: '' };
    group.notes.push({ ...note, deckPath, ...(unsent.has(note.id) ? { pending: true } : {}) });
    groups.set(key, group);
  }
  const result = [...groups.values()].filter((group) => group.notes.length >= 2);
  for (let at = 0; at < result.length; at++) {
    if (at % 64 === 0 && performance.now() - started >= 6) {
      await yieldToInput();
      started = performance.now();
    }
    const group = result[at]!;
    group.notes.sort((a, b) => compare(a.id, b.id));
    group.search =
      `${group.key}\n` +
      group.notes
        .map(
          (note) =>
            `${JSON.stringify(note.fields)} ${note.source ?? ''} ${note.deckPath.join(' / ')}`,
        )
        .join('\n')
        .toLowerCase();
  }
  return result.sort((a, b) => compare(a.key, b.key));
}

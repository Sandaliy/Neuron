import { describe, expect, it } from 'vitest';

import { buildDeckTree } from './serialise.js';

import type { DeckCount, DeckRow } from './db/repositories/index.js';

/**
 * Building the library tree, without a database.
 *
 * The rolling up is arithmetic over the `path` arrays the decks already carry,
 * which is the whole reason the counts can come from one query instead of one
 * per deck. Arithmetic is worth testing on its own, at speed, with the shapes
 * that are awkward rather than the shape that is typical.
 */

const base = {
  userId: 'someone',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  deletedAt: null,
  settings: null,
  position: 0,
  rev: 1,
};

function deck(id: string, parentId: string | null, path: string[], name = id): DeckRow {
  return { ...base, id, parentId, path, name } as DeckRow;
}

function counts(entries: Record<string, [number, number]>): DeckCount[] {
  return Object.entries(entries).map(([deckId, [due, fresh]]) => ({ deckId, due, fresh }));
}

describe('buildDeckTree', () => {
  it('nests children under their parents', () => {
    const tree = buildDeckTree(
      [deck('root', null, []), deck('child', 'root', ['root'])],
      counts({}),
    );

    expect(tree).toHaveLength(1);
    expect(tree[0]?.children[0]?.id).toBe('child');
  });

  it('adds a deck’s own counts to every ancestor above it', () => {
    const tree = buildDeckTree(
      [
        deck('root', null, []),
        deck('middle', 'root', ['root']),
        deck('leaf', 'middle', ['root', 'middle']),
      ],
      counts({ leaf: [3, 5] }),
    );

    const root = tree[0];
    const middle = root?.children[0];
    const leaf = middle?.children[0];

    expect(leaf).toMatchObject({ due: 3, fresh: 5 });
    expect(middle).toMatchObject({ due: 3, fresh: 5 });
    expect(root).toMatchObject({ due: 3, fresh: 5 });
  });

  it('adds up several branches into one folder', () => {
    const tree = buildDeckTree(
      [deck('root', null, []), deck('left', 'root', ['root']), deck('right', 'root', ['root'])],
      counts({ left: [1, 2], right: [4, 8], root: [10, 0] }),
    );

    expect(tree[0]).toMatchObject({ due: 15, fresh: 10 });
  });

  it('gives a deck with nothing in it zero rather than nothing', () => {
    // An empty list has to render as a zero, not as a blank area where a number
    // should be.
    const tree = buildDeckTree([deck('lonely', null, [])], counts({}));

    expect(tree[0]).toMatchObject({ due: 0, fresh: 0 });
  });

  it('shows a deck at the root when its parent has been deleted', () => {
    // The parent is not in the list, because a soft deleted deck is not
    // returned. Losing a folder should not lose what was inside it.
    const tree = buildDeckTree([deck('orphan', 'gone', ['gone'])], counts({ orphan: [2, 0] }));

    expect(tree).toHaveLength(1);
    expect(tree[0]?.id).toBe('orphan');
    expect(tree[0]?.due).toBe(2);
  });

  it('ignores a count for a deck that is not in the tree', () => {
    const tree = buildDeckTree([deck('here', null, [])], counts({ elsewhere: [9, 9] }));

    expect(tree[0]).toMatchObject({ due: 0, fresh: 0 });
  });
});

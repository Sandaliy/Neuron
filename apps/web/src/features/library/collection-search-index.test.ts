import { describe, expect, it } from 'vitest';

import type { DeckNode } from '@neuron/shared';

import { indexCollections, searchCollections } from './collection-search-index';

function node(id: string, name: string, children: DeckNode[] = []): DeckNode {
  return {
    id,
    name,
    kind: children.length ? 'folder' : 'deck',
    children,
    parentId: null,
    path: [],
    position: 0,
    settings: null,
    rev: 1,
    createdAt: '',
    updatedAt: '',
    noteCount: 0,
    due: 0,
    fresh: 0,
  };
}

describe('collection name search', () => {
  it('indexes collapsed descendants and repeated names with their current complete locations', () => {
    const tree = [
      node('a', 'Languages', [node('b', 'German', [node('c', 'Lesson')])]),
      node('d', 'Lesson'),
    ];
    const before = JSON.stringify(tree);
    const index = indexCollections(tree);
    expect(
      searchCollections(index, ' LESSON ').map(({ id, location }) => ({ id, location })),
    ).toEqual([
      { id: 'c', location: 'Languages / German' },
      { id: 'd', location: '' },
    ]);
    expect(searchCollections(index, 'languages').map((row) => row.id)).toEqual(['a']);
    expect(searchCollections(index, '')).toBe(index);
    expect(JSON.stringify(tree)).toBe(before);
    tree[0] = { ...tree[0]!, name: 'Updated', children: [] };
    expect(indexCollections(tree).map((row) => row.name)).toEqual(['Updated', 'Lesson']);
  });

  it('matches Unicode names and preserves pending provenance', () => {
    const pending = { ...node('a', 'КОЛОДА'), rev: 0 };
    expect(
      searchCollections(indexCollections([pending, node('b', 'Ｆｏｌｄｅｒ')]), 'колода')[0]
        ?.pending,
    ).toBe(true);
    expect(
      searchCollections(indexCollections([pending, node('b', 'Ｆｏｌｄｅｒ')]), 'folder'),
    ).toHaveLength(1);
  });

  it('reuses a flat index across repeated queries over 10,000 nested collections', () => {
    const tree = Array.from({ length: 100 }, (_, group) =>
      node(
        `f${group}`,
        `Folder ${group}`,
        Array.from({ length: 100 }, (_, at) => node(`${group}-${at}`, `Lesson ${at}`)),
      ),
    );
    const index = indexCollections(tree);
    expect(index).toHaveLength(10100);
    for (let i = 0; i < 100; i++)
      expect(searchCollections(index, `Lesson ${i}`)).toHaveLength(i < 10 && i > 0 ? 1100 : 100);
  });
});

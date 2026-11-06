import { describe, expect, it } from 'vitest';

import type { DeletedDeck, DeletedNote } from '@neuron/shared';

import {
  browseDeletedDecks,
  indexDeletedDecks,
  indexDeletedNotes,
  matchesDeleted,
  searchText,
  sortDeleted,
} from './deleted-browse';

const deck = (id: string, parentId: string | null, name: string, context = false) =>
  ({
    id,
    parentId,
    name,
    kind: 'folder',
    pathNames: parentId ? ['Languages'] : [],
    context,
    parentDeleted: parentId !== null,
  }) as DeletedDeck;

describe('Deleted presentation index', () => {
  it('matches Note content, nested fields and original location across case and word order', () => {
    const notes = indexDeletedNotes([
      {
        id: 'note',
        fields: {
          term: 'École',
          translation: 'School',
          grammar: { plural: 'écoles' },
          example: 'A quiet place',
        },
        deckPath: ['French', 'Lesson 3'],
      } as unknown as DeletedNote,
    ]);
    expect(matchesDeleted(notes[0]!.search, searchText('SCHOOL french'))).toBe(true);
    expect(matchesDeleted(notes[0]!.search, searchText('e\u0301cole quiet'))).toBe(true);
    expect(matchesDeleted(notes[0]!.search, 'lesson écoles')).toBe(true);
    expect(matchesDeleted(notes[0]!.search, 'french / lesson')).toBe(true);
    expect(matchesDeleted(notes[0]!.search, 'missing')).toBe(false);
  });

  it('retains live and deleted ancestors, counts only matches and preserves dependency flags', () => {
    const index = indexDeletedDecks(
      [
        deck('live', null, 'Languages', true),
        deck('parent', 'live', 'French'),
        { ...deck('child', 'parent', 'Verbs'), pathNames: ['Languages', 'French'] },
        deck('unrelated', null, 'Other'),
      ],
      'original',
    );
    const result = browseDeletedDecks(index, 'verbs', new Set(['live', 'parent']));
    expect(result.rows.map((row) => [row.id, row.depth, row.supporting])).toEqual([
      ['live', 0, true],
      ['parent', 1, true],
      ['child', 2, false],
    ]);
    expect(result.rows[2]!.parentDeleted).toBe(true);
    expect(result.count).toBe(1);
    expect(index.total).toBe(3);
    expect(browseDeletedDecks(index, 'languages verbs', new Set()).count).toBe(1);
    expect(browseDeletedDecks(index, 'missing', new Set()).rows).toEqual([]);
    expect(
      browseDeletedDecks(index, '', new Set(['parent'])).rows.map((row) => row.id),
    ).not.toContain('child');
  });

  it('sorts siblings without flattening ancestry and leaves source order untouched', () => {
    const source = [
      deck('parent', null, 'Z'),
      deck('b', 'parent', 'Beta'),
      deck('a', 'parent', 'Alpha'),
    ];
    const rows = browseDeletedDecks(indexDeletedDecks(source, 'alpha'), '', new Set()).rows;
    expect(rows.map((row) => row.id)).toEqual(['parent', 'a', 'b']);
    expect(source.map((row) => row.id)).toEqual(['parent', 'b', 'a']);
    expect(
      sortDeleted(
        [
          { title: 'B', location: 'A' },
          { title: 'A', location: 'Z' },
        ],
        'location',
      )[0]!.title,
    ).toBe('B');
  });

  it('indexes and filters 5000 Notes and 2000 hierarchy rows without recursive full-array scans', () => {
    const notes = indexDeletedNotes(
      Array.from(
        { length: 5000 },
        (_, i) =>
          ({
            id: `n${i}`,
            fields: { front: `Word ${i}`, back: 'Meaning' },
            deckPath: ['Language', `Lesson-${i % 10}`],
          }) as unknown as DeletedNote,
      ),
    );
    expect(notes.filter((row) => matchesDeleted(row.search, 'lesson-9')).length).toBe(500);
    const decks = Array.from({ length: 2000 }, (_, i) =>
      deck(`d${i}`, i ? `d${i - 1}` : null, `Folder ${i}`),
    );
    const result = browseDeletedDecks(
      indexDeletedDecks(decks, 'original'),
      'folder 1999',
      new Set(),
    );
    expect(result.count).toBe(1);
    expect(result.rows).toHaveLength(2000);
    expect(result.rows.at(-1)!.parentDeleted).toBe(true);
  });
});

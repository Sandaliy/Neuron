import { describe, expect, it } from 'vitest';

import type { Deck, Note } from '@neuron/shared';

import { indexDuplicateNotes } from './duplicate-index';

const date = '2026-11-03T00:00:00Z';
const deck = (
  id: string,
  parentId: string | null = null,
  kind: 'deck' | 'folder' = 'deck',
): Deck => ({
  id,
  parentId,
  kind,
  name: id,
  position: 0,
  settings: null,
  createdAt: date,
  updatedAt: date,
  rev: 1,
  path: [],
});
const note = (id: string, term: string, deckId = 'a', translation = 'same'): Note => ({
  id,
  deckId,
  noteType: 'vocab',
  fields: { term, translation },
  tags: [],
  source: 'source',
  rank: null,
  status: 'active',
  importBatchId: null,
  createdAt: date,
  updatedAt: date,
  rev: 1,
});
const yieldToInput = () => Promise.resolve();
describe('downloaded duplicate term index', () => {
  it('keeps meanings, accents, types, identities, sources and pending provenance separate', async () => {
    const notes = [
      note('1', '  Bank\t'),
      note('2', 'BANK', 'b', 'river'),
      note('3', 'schon'),
      note('4', 'schön'),
      note('5', 'different', 'a', 'river'),
      { ...note('6', ''), noteType: 'basic' as const, fields: { front: 'bank', back: 'seat' } },
      { ...note('7', ''), noteType: 'cloze' as const, fields: { text: 'bank', extra: 'context' } },
    ];
    const groups = await indexDuplicateNotes(
      notes,
      [deck('f', null, 'folder'), deck('a', 'f'), deck('b')],
      new Set(['6']),
      yieldToInput,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe('bank');
    expect(groups[0]?.notes).toHaveLength(4);
    expect(groups[0]?.notes.find((note) => note.id === '1')?.deckPath).toEqual(['f', 'a']);
    expect(groups[0]?.notes.find((note) => note.id === '6')?.pending).toBe(true);
    expect(groups[0]?.search).toContain('river');
    expect(groups[0]?.notes.map((note) => note.id)).toEqual(['1', '2', '6', '7']);
  });
  it('excludes missing parents, cycles and children of Decks', async () => {
    const decks = [
      deck('a'),
      deck('orphan', 'missing'),
      deck('cycle1', 'cycle2', 'folder'),
      deck('cycle2', 'cycle1', 'folder'),
      deck('cycle', 'cycle1'),
      deck('child', 'a'),
    ];
    expect(
      await indexDuplicateNotes(
        [
          note('1', 'bank'),
          note('2', 'bank', 'orphan'),
          note('3', 'bank', 'cycle'),
          note('4', 'bank', 'child'),
        ],
        decks,
        new Set(),
        yieldToInput,
      ),
    ).toEqual([]);
  });
  it('uses the established 200-character key, excludes empty keys and rebuilds changed Notes', async () => {
    const prefix = 'x'.repeat(200);
    const notes = [
      note('1', prefix + 'a'),
      note('2', prefix + 'b'),
      note('3', ' \t '),
      note('4', ''),
    ];
    const groups = await indexDuplicateNotes(notes, [deck('a')], new Set(), yieldToInput);
    expect(groups.map((group) => group.key)).toEqual([prefix]);
    expect(
      await indexDuplicateNotes(
        [notes[0]!, { ...notes[1]!, fields: { term: 'edited', translation: 'same' } }],
        [deck('a')],
        new Set(),
        yieldToInput,
      ),
    ).toEqual([]);
  });
  it('indexes 6500 Notes with many unique terms, a large group and cross-Deck pairs', async () => {
    const notes = Array.from({ length: 6500 }, (_, at) =>
      note(
        String(at).padStart(5, '0'),
        at < 1500 ? 'large' : at < 5500 ? `unique ${at}` : `pair ${Math.floor(at / 2)}`,
        at % 2 ? 'a' : 'b',
      ),
    );
    let yields = 0;
    const started = performance.now();
    const groups = await indexDuplicateNotes(notes, [deck('a'), deck('b')], new Set(), async () => {
      yields++;
    });
    const elapsed = performance.now() - started;
    expect(groups).toHaveLength(501);
    expect(groups[0]?.notes).toHaveLength(1500);
    console.info(
      `Downloaded duplicate index: 6500 Notes, ${elapsed.toFixed(1)} ms, ${yields} input yields`,
    );
  });
});

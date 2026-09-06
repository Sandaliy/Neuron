import { describe, expect, it } from 'vitest';

import { parseImport } from '@neuron/shared';
import type { DuplicateMatch } from '@neuron/shared';

import { createAttempt, groupMatches, planRows, resolveDuplicate } from './import-plan';

const match = (
  noteId: string,
  noteType: DuplicateMatch['noteType'] = 'vocab',
  term = 'eins',
): DuplicateMatch => ({ noteId, noteType, term, written: term, deckId: 'deck' });
const parsed = parseImport('eins\tone\nzwei\ttwo\ndrei\tthree', 'tsv', {
  noteType: 'vocab',
  columns: ['term', 'translation'],
});

describe('duplicate decisions', () => {
  it('never chooses between two same-type targets, in either order', () => {
    for (const matches of [
      [match('a'), match('b')],
      [match('b'), match('a')],
    ]) {
      const decision = resolveDuplicate(matches, 'vocab', 'merge');
      expect(decision).toMatchObject({ action: 'skip', ambiguous: true, target: undefined });
      expect(resolveDuplicate(matches, 'vocab', 'merge', 'create').action).toBe('create');
    }
  });
  it('selects the unique compatible target regardless of incompatible matches or order', () => {
    for (const matches of [
      [match('a'), match('b', 'basic')],
      [match('b', 'basic'), match('a')],
    ]) {
      expect(resolveDuplicate(matches, 'vocab', 'merge').target?.noteId).toBe('a');
    }
    expect(resolveDuplicate([match('b', 'basic')], 'vocab', 'merge')).toMatchObject({
      action: 'skip',
      target: undefined,
      incompatible: true,
    });
  });
  it('deduplicates repeated lookup results by note ID, not by term', () => {
    expect(groupMatches([match('a'), match('a'), match('b')]).get('eins')).toHaveLength(2);
  });
  it('applies the default, allows independent overrides, and leaves normal rows alone', () => {
    expect(parsed.rows).toHaveLength(3);
    const matches = [match('a'), match('b', 'vocab', 'zwei')];
    const first = parsed.rows[0]!.line;
    const second = parsed.rows[1]!.line;
    expect(planRows(parsed, matches, 'merge').merge).toHaveLength(2);
    const mixed = planRows(parsed, matches, 'skip', { [first]: 'merge', [second]: 'create' });
    expect(mixed.merge.map((row) => row.noteId)).toEqual(['a']);
    expect(mixed.create).toHaveLength(2);
    expect(planRows(parsed, matches, 'skip').merge).toEqual([]);
    expect(planRows(parsed, matches, 'skip').skipped).toBe(2);
  });
  it('freezes create-another IDs and decisions for one attempt', () => {
    const attempt = createAttempt(parsed, [match('a')], 'create', {}, 'deck');
    expect(attempt.create).toHaveLength(3);
    const original = JSON.stringify(attempt.create);
    planRows(parsed, [], 'skip');
    expect(JSON.stringify(attempt.create)).toBe(original);
    expect(new Set(attempt.create.map((row) => row.id)).size).toBe(3);
  });
});

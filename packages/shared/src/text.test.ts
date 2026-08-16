import { describe, expect, it } from 'vitest';

import { exampleContainsTerm, normaliseTerm, noteTermKey, termOf } from './text.js';

describe('normalising a term', () => {
  it('folds case and collapses whitespace', () => {
    expect(normaliseTerm('  Die   Sorgfalt ')).toBe('die sorgfalt');
  });

  it('keeps umlauts, because schon and schön are two different words', () => {
    expect(normaliseTerm('schön')).not.toBe(normaliseTerm('schon'));
  });

  it('stops at the length the index stores', () => {
    expect(normaliseTerm('a'.repeat(500))).toHaveLength(200);
  });
});

describe('what a note is identified by', () => {
  it('is the term, the front, or the text, in that order', () => {
    expect(termOf({ term: 'Haus', front: 'q' })).toBe('Haus');
    expect(termOf({ front: 'q', back: 'a' })).toBe('q');
    expect(termOf({ text: 'a {{b}} c' })).toBe('a {{b}} c');
  });

  it('is empty when there is nothing to compare', () => {
    expect(noteTermKey({})).toBe('');
    expect(noteTermKey(null)).toBe('');
  });
});

describe('whether an example contains its word', () => {
  it('accepts the plain case', () => {
    expect(exampleContainsTerm('Er arbeitet mit großer Sorgfalt.', 'Sorgfalt')).toBe(true);
  });

  it('accepts an inflected form', () => {
    expect(exampleContainsTerm('Die Häuser sind alt.', 'Haus')).toBe(true);
    expect(exampleContainsTerm('Sie arbeitet viel.', 'arbeiten')).toBe(true);
  });

  it('accepts a separable verb written apart', () => {
    expect(exampleContainsTerm('Ich stehe früh auf.', 'aufstehen')).toBe(true);
  });

  it('rejects a sentence that does not contain the word at all', () => {
    expect(exampleContainsTerm('Das Wetter ist gut.', 'Sorgfalt')).toBe(false);
  });

  it('accepts anything when there is no word to look for', () => {
    expect(exampleContainsTerm('Das Wetter ist gut.', '')).toBe(true);
  });
});

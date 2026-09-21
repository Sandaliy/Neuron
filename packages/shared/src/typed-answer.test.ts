import { describe, expect, it } from 'vitest';

import { checkTypedAnswer } from './typed-answer.js';

describe('typed production feedback', () => {
  it('accepts canonical Unicode, whitespace and case without stripping meaningful marks', () => {
    expect(checkTypedAnswer('  CAFE\u0301  ', 'café')).toBe('correct');
    expect(checkTypedAnswer('cafe', 'café')).toBe('close');
    expect(checkTypedAnswer('schon', 'schön')).toBe('close');
    expect(checkTypedAnswer('ss', 'ß')).toBe('incorrect');
    expect(checkTypedAnswer('все', 'всё')).toBe('incorrect');
  });
  it('uses explicit alternatives without guessing from punctuation', () => {
    expect(checkTypedAnswer('colour', 'color', ['colour'])).toBe('exact');
    expect(checkTypedAnswer('color', 'colour / color')).toBe('incorrect');
    expect(checkTypedAnswer('I', 'ı', [], 'tr')).toBe('correct');
    expect(checkTypedAnswer('İ', 'i', [], 'tr')).toBe('correct');
    expect(checkTypedAnswer('I', 'i', [], 'tr')).toBe('incorrect');
  });
  it('reports small insertions, deletions and transpositions as close, never correct', () => {
    for (const input of ['wrod', 'worrd', 'wordd', 'words'])
      expect(checkTypedAnswer(input, 'word')).toBe('close');
    expect(checkTypedAnswer('cat', 'car')).toBe('incorrect');
    expect(checkTypedAnswer('   ', 'word')).toBe('incorrect');
    expect(checkTypedAnswer('a'.repeat(10000), 'word')).toBe('incorrect');
  });
});

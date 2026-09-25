import { describe, expect, it } from 'vitest';

import { checkTypedAnswer, spellingFeedback } from './typed-answer.js';

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

it('aligns insertions and omissions without marking the following suffix wrong', () => {
  expect(spellingFeedback('hxouse', 'house').parts.map((part) => part.kind)).toEqual([
    'correct',
    'extra',
    'correct',
    'correct',
    'correct',
    'correct',
  ]);
  expect(spellingFeedback('hose', 'house').parts.map((part) => part.kind)).toEqual([
    'correct',
    'correct',
    'missing',
    'correct',
    'correct',
  ]);
  expect(spellingFeedback('COLOUR', 'color', ['colour']).parts).toEqual([
    { kind: 'correct', text: 'COLOUR' },
  ]);
  expect(
    spellingFeedback('schon', 'schön').parts.filter((part) => part.kind === 'incorrect'),
  ).toEqual([{ kind: 'incorrect', text: 'o', expected: 'ö' }]);
});

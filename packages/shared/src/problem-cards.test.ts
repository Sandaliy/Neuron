import { describe, expect, it } from 'vitest';

import {
  problemCardCursor,
  problemCardsQuerySchema,
  readProblemCardCursor,
} from './api/problem-cards.js';
import {
  PROBLEM_CARD_MINIMUM_ANSWERS,
  countAnswers,
  isRecovering,
  problemReasons,
} from './problem-cards.js';

import type { CountedAnswer } from './problem-cards.js';

const answers = (text: string): CountedAnswer[] =>
  // a = Again in learning, L = Again in review (a lapse), g = Good in learning, G = Good in review
  [...text].map((letter) => ({
    rating: letter.toLowerCase() === 'a' || letter === 'L' ? 'again' : 'good',
    stateBefore: letter === 'L' || letter === 'G' ? 'review' : 'learning',
  }));
const reasons = (text: string) => problemReasons(countAnswers(answers(text)));

describe('slipping Card policy', () => {
  it('needs repeated evidence, never one or two misses', () => {
    expect(reasons('')).toEqual([]);
    expect(reasons('aa')).toEqual([]);
    expect(reasons('aaa')).toEqual([]);
    expect(reasons('gGLgGLgG')).toEqual([]);
  });

  it('lists three lapses after learning however long the history', () => {
    expect(reasons('gGLgGLgGL')).toEqual(['repeated_lapses']);
    expect(reasons('gGGGGGGGGGGLgGGGGGGGGGLgGGGGGGGGLgGGGG')).toEqual(['repeated_lapses']);
  });

  it('lists frequent Again only when it is at least half of enough answers', () => {
    expect(reasons('aaaa')).toEqual(['frequent_again']);
    expect(reasons('aaaagggg')).toEqual(['frequent_again']);
    expect(reasons('aaaaggggg')).toEqual([]);
    expect(reasons('agagagLgL')).toEqual(['frequent_again']);
    expect(reasons('aLgLgLg')).toEqual(['repeated_lapses', 'frequent_again']);
  });

  it('describes recovery from the answers after the last Again', () => {
    const counted = countAnswers(answers('gGLgGLgGLgGG'));
    expect(counted).toMatchObject({ answers: 12, again: 3, lapses: 3, sinceLastAgain: 3 });
    expect(isRecovering(counted.sinceLastAgain)).toBe(true);
    expect(isRecovering(countAnswers(answers('gGLgGLgGLg')).sinceLastAgain)).toBe(false);
  });

  it('keeps the server pre-filter no stricter than the rules', () => {
    for (const text of ['aaaa', 'LLL'])
      expect(answers(text).length).toBeGreaterThanOrEqual(PROBLEM_CARD_MINIMUM_ANSWERS);
  });

  it('round-trips value cursors and refuses one from the other order', () => {
    const value = {
      again: 7,
      lastAgainAt: '2026-11-05T10:00:00.123456Z',
      id: '0190f0a0-0000-7000-8000-000000000001',
    };
    expect(readProblemCardCursor('again', problemCardCursor('again', value))).toEqual(value);
    const recent = problemCardCursor('recent', value);
    expect(readProblemCardCursor('recent', recent)).toEqual({
      lastAgainAt: value.lastAgainAt,
      id: value.id,
    });
    expect(problemCardsQuerySchema.safeParse({ sort: 'again', cursor: recent }).success).toBe(
      false,
    );
    for (const cursor of [
      'x',
      '1~2026-11-05T10:00:00Z~nope',
      `-1~${value.lastAgainAt}~${value.id}`,
    ])
      expect(problemCardsQuerySchema.safeParse({ cursor }).success).toBe(false);
    expect(problemCardsQuerySchema.parse({})).toMatchObject({
      state: 'all',
      sort: 'again',
      limit: 50,
    });
  });
});

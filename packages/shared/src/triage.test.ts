import { describe, expect, it } from 'vitest';

import {
  TRIAGE_BATCH_LIMIT,
  TRIAGE_CHOICES,
  countTriage,
  nextInTriage,
  orderTriage,
  triageChoiceOf,
  triageDecisionsSchema,
  triageFace,
  triageWrite,
} from './triage.js';

import type { TriageChoice } from './triage.js';

const id = (index: number) => `01900000-0000-7000-8000-${String(index).padStart(12, '0')}`;

describe('triage choices and the Note status', () => {
  it('reads Known from the status, whatever mark is left beside it', () => {
    expect(triageChoiceOf('known', null)).toBe('known');
    expect(triageChoiceOf('known', 'unsure')).toBe('known');
  });

  it('reads Unsure, New and unsorted from an active Note’s mark', () => {
    expect(triageChoiceOf('active', 'unsure')).toBe('unsure');
    expect(triageChoiceOf('active', 'new')).toBe('new');
    expect(triageChoiceOf('active', null)).toBe('unsorted');
    expect(triageChoiceOf('active', undefined)).toBe('unsorted');
  });

  it('leaves Set aside and Draft Notes out of triage', () => {
    expect(triageChoiceOf('suspended', 'new')).toBeUndefined();
    expect(triageChoiceOf('draft', null)).toBeUndefined();
  });

  it('writes every choice so that it reads back as itself', () => {
    for (const choice of TRIAGE_CHOICES) {
      const written = triageWrite(choice);
      expect(triageChoiceOf(written.status, written.triage)).toBe(choice);
    }
  });

  it('keeps Unsure and New in Study and only Known out of it', () => {
    expect(triageWrite('known')).toEqual({ status: 'known', triage: null });
    expect(triageWrite('unsure').status).toBe('active');
    expect(triageWrite('new').status).toBe('active');
    expect(triageWrite('unsorted')).toEqual({ status: 'active', triage: null });
  });
});

describe('the face triage shows', () => {
  it('shows a word with its article and reading, and its translation as the meaning', () => {
    expect(
      triageFace('vocab', {
        term: 'See',
        translation: 'lake',
        reading: 'zeː',
        grammar: { article: 'der' },
      }),
    ).toEqual({ term: 'der See', detail: 'zeː', meaning: 'lake' });
    expect(triageFace('vocab', { term: 'run', translation: 'бежать' })).toEqual({
      term: 'run',
      detail: '',
      meaning: 'бежать',
    });
  });

  it('shows a basic Note’s front and back', () => {
    expect(triageFace('basic', { front: 'Capital of Peru', back: 'Lima' })).toEqual({
      term: 'Capital of Peru',
      detail: '',
      meaning: 'Lima',
    });
  });

  it('hides cloze gaps, showing a hint where the author wrote one, and the whole text as meaning', () => {
    expect(
      triageFace('cloze', { text: 'Water boils at {{100}} and freezes at {{c2::0::cold}}.' }),
    ).toEqual({
      term: 'Water boils at […] and freezes at [cold].',
      detail: '',
      meaning: 'Water boils at 100 and freezes at 0.',
    });
  });

  it('survives fields that are missing or the wrong shape', () => {
    expect(triageFace('vocab', null)).toEqual({ term: '', detail: '', meaning: '' });
    expect(triageFace('basic', { front: 3 })).toEqual({ term: '', detail: '', meaning: '' });
    expect(triageFace('vocab', { term: 'Haus', translation: 'house', grammar: 'none' }).term).toBe(
      'Haus',
    );
  });
});

describe('the order a sweep follows', () => {
  const items = [
    { id: id(1), rank: 30, term: 'beta' },
    { id: id(2), rank: null, term: 'Alpha' },
    { id: id(3), rank: 10, term: 'gamma' },
    { id: id(4), rank: 10, term: '  alpha' },
  ];

  it('keeps source order as given', () => {
    expect(orderTriage(items, 'created').map((item) => item.id)).toEqual([
      id(1),
      id(2),
      id(3),
      id(4),
    ]);
  });

  it('puts the most frequent first, unranked last, and ties in source order', () => {
    expect(orderTriage(items, 'rank').map((item) => item.id)).toEqual([id(3), id(4), id(1), id(2)]);
  });

  it('sorts by the folded word, with ties in source order', () => {
    expect(orderTriage(items, 'alpha').map((item) => item.id)).toEqual([
      id(2),
      id(4),
      id(1),
      id(3),
    ]);
  });

  it('does not change the list it was given', () => {
    const copy = [...items];
    orderTriage(items, 'rank');
    expect(items).toEqual(copy);
  });
});

describe('moving through a sweep', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];
  const with_ = (choices: Record<string, TriageChoice>) => (item: string) =>
    choices[item] ?? 'unsorted';

  it('starts at the first unsorted Note', () => {
    expect(nextInTriage(order, with_({ a: 'known', b: 'new' }), 'unsorted', -1)).toBe(2);
  });

  it('moves forward, then wraps round to a Note that was skipped', () => {
    const choices = with_({ a: 'unsorted', b: 'known', c: 'known', d: 'known', e: 'known' });
    expect(nextInTriage(order, choices, 'unsorted', 2)).toBe(0);
  });

  it('says the sweep is done when nothing is unsorted', () => {
    const all = with_({ a: 'known', b: 'new', c: 'unsure', d: 'known', e: 'new' });
    expect(nextInTriage(order, all, 'unsorted', 1)).toBe(-1);
    expect(nextInTriage([], all, 'unsorted', -1)).toBe(-1);
  });

  it('passes over Unsure Notes once, without wrapping back', () => {
    const choices = with_({ a: 'unsure', b: 'known', c: 'unsure', d: 'new', e: 'unsure' });
    expect(nextInTriage(order, choices, 'unsure', -1, false)).toBe(0);
    expect(nextInTriage(order, choices, 'unsure', 0, false)).toBe(2);
    expect(nextInTriage(order, choices, 'unsure', 2, false)).toBe(4);
    expect(nextInTriage(order, choices, 'unsure', 4, false)).toBe(-1);
  });

  it('counts each choice', () => {
    expect(countTriage(order, with_({ a: 'known', b: 'unsure', c: 'known', d: 'new' }))).toEqual({
      known: 2,
      unsure: 1,
      new: 1,
      unsorted: 1,
    });
  });

  it('stays fast enough for one tap at a time over five thousand Notes', () => {
    const large = Array.from({ length: 5000 }, (_, index) => ({
      id: id(index),
      rank: (index * 7919) % 5000,
      term: `word${index}`,
    }));
    const choices = new Map<string, TriageChoice>();
    const choiceOf = (item: { id: string }) => choices.get(item.id) ?? 'unsorted';
    const ranked = orderTriage(large, 'rank');
    const started = Date.now();
    let at = nextInTriage(ranked, choiceOf, 'unsorted', -1);
    for (let step = 0; step < 5000; step++) {
      choices.set(ranked[at]!.id, 'known');
      countTriage(ranked, choiceOf);
      at = nextInTriage(ranked, choiceOf, 'unsorted', at);
    }
    const perTap = (Date.now() - started) / 5000;
    expect(at).toBe(-1);
    // A decision recounts the whole sweep; that must stay far below one frame.
    expect(perTap).toBeLessThan(2);
  });
});

describe('a batch of decisions', () => {
  it('accepts up to the batch limit, one per Note', () => {
    const decisions = Array.from({ length: TRIAGE_BATCH_LIMIT }, (_, index) => ({
      id: id(index),
      choice: 'known',
    }));
    expect(triageDecisionsSchema.safeParse({ decisions }).success).toBe(true);
    expect(
      triageDecisionsSchema.safeParse({
        decisions: [...decisions, { id: id(9999), choice: 'new' }],
      }).success,
    ).toBe(false);
  });

  it('refuses two decisions for one Note, and choices that do not exist', () => {
    expect(
      triageDecisionsSchema.safeParse({
        decisions: [
          { id: id(1), choice: 'known' },
          { id: id(1), choice: 'new' },
        ],
      }).success,
    ).toBe(false);
    expect(
      triageDecisionsSchema.safeParse({ decisions: [{ id: id(1), choice: 'forgotten' }] }).success,
    ).toBe(false);
    expect(triageDecisionsSchema.safeParse({ decisions: [] }).success).toBe(false);
  });
});

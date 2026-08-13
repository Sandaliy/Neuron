import { describe, expect, it } from 'vitest';

import type { DeckNode } from '@neuron/shared';

import { estimateMinutes } from '../features/today/today';

import { totals } from './decks';

/** A deck node with only the fields these sums read. */
function deck(
  name: string,
  due: number,
  fresh: number,
  children: readonly DeckNode[] = [],
): DeckNode {
  return {
    id: name,
    name,
    parentId: null,
    position: 0,
    path: [],
    settings: null,
    createdAt: '',
    updatedAt: '',
    rev: 1,
    due,
    fresh,
    children,
  };
}

describe('adding up the library', () => {
  it('adds the roots and nothing else', () => {
    /*
     * The counts arrive rolled up: a folder already carries what its whole
     * subtree holds. Walking the tree and adding every node would count a card
     * once for itself and once for every folder above it, so a card two levels
     * down would be counted three times.
     */
    const tree = [
      deck('German', 30, 5, [deck('Textbook', 20, 3, [deck('Lesson 1', 12, 1)])]),
      deck('English', 8, 2),
    ];

    expect(totals(tree)).toEqual({ due: 38, fresh: 7 });
  });

  it('is zero for an empty library', () => {
    expect(totals([])).toEqual({ due: 0, fresh: 0 });
  });
});

describe('estimating how long today takes', () => {
  it('says nothing takes no time', () => {
    expect(estimateMinutes(0)).toBe(0);
  });

  it('never rounds a real pile of cards down to nothing', () => {
    // Two cards is twelve seconds, which rounds to zero minutes. "0 minutes"
    // next to "2 cards waiting" reads as a bug.
    expect(estimateMinutes(2)).toBe(1);
  });

  it('scales with the number waiting', () => {
    // Sixty cards at six seconds each is six minutes.
    expect(estimateMinutes(60)).toBe(6);
  });
});

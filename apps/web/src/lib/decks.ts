import { useQuery } from '@tanstack/react-query';

import type { DeckNode } from '@neuron/shared';

import { request } from './api';

/**
 * The library, in one request.
 *
 * `GET /api/decks` returns the whole tree with the counts already rolled up
 * over each subtree, from two queries on the server. Asking per deck instead
 * would put one round trip per row on the first screen anybody sees.
 */
export const DECK_TREE_KEY = ['decks'] as const;

/**
 * The query itself, apart from the hook that reads it.
 *
 * Both screens behind the session gate read this, and the gate does not render
 * them until it knows who is signed in. That made two round trips in a row for
 * the first screen anybody sees, one waiting on the other, which on a cold
 * function is two cold starts end to end. Starting it from the entry point
 * instead means the two questions are asked at the same time.
 */
export function deckTreeQuery() {
  return {
    queryKey: DECK_TREE_KEY,
    queryFn: () => request<{ decks: DeckNode[] }>('/decks'),
  } as const;
}

export function useDeckTree() {
  return useQuery({ ...deckTreeQuery(), select: (data) => data.decks });
}

/** Everything waiting across the whole collection, roots included. */
export function totals(decks: readonly DeckNode[]): { due: number; fresh: number } {
  // The counts are already rolled up, so only the roots are added. Walking the
  // whole tree would count every card once per level of nesting above it.
  return decks.reduce((sum, deck) => ({ due: sum.due + deck.due, fresh: sum.fresh + deck.fresh }), {
    due: 0,
    fresh: 0,
  });
}

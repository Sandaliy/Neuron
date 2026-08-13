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

export function useDeckTree() {
  return useQuery({
    queryKey: DECK_TREE_KEY,
    queryFn: () => request<{ decks: DeckNode[] }>('/decks'),
    select: (data) => data.decks,
  });
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

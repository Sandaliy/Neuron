import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { resolveDeckSettings, uuidV7 } from '@neuron/shared';
import type { Deck, DeckNode, DeckSettings, ResolvedDeckSettings } from '@neuron/shared';

import { request } from './api';

/**
 * The library, in one request, and the six things that can change it.
 *
 * `GET /api/decks` returns the whole tree with the counts already rolled up
 * over each subtree, from two queries on the server. Asking per deck instead
 * would put one round trip per row on the first screen anybody sees.
 *
 * Every change refetches the tree rather than editing the cached copy. The
 * counts roll up over a subtree, a move changes them at three levels at once,
 * and a cache patched by hand would be right for the deck that moved and wrong
 * for both of its parents.
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

/** Every deck in the tree, flattened, parents before children. */
export function flatten(decks: readonly DeckNode[]): DeckNode[] {
  return decks.flatMap((deck) => [deck, ...flatten(deck.children)]);
}

/** One deck out of the tree, by id. */
export function findDeck(decks: readonly DeckNode[], id: string): DeckNode | undefined {
  return flatten(decks).find((deck) => deck.id === id);
}

/**
 * The settings that apply inside a deck, its ancestors included.
 *
 * The same walk the api does before it creates a card, run here so the editor
 * and the import screen can say which language a deck is about without asking.
 *
 * @param decks the whole tree
 * @param id which deck
 * @returns settings with every question answered
 */
export function settingsFor(decks: readonly DeckNode[], id: string): ResolvedDeckSettings {
  const all = flatten(decks);
  const deck = all.find((entry) => entry.id === id);

  if (!deck) {
    return resolveDeckSettings([]);
  }

  const byId = new Map(all.map((entry) => [entry.id, entry]));
  const chain = [...deck.path.map((ancestor) => byId.get(ancestor)), deck];

  return resolveDeckSettings(chain.map((entry) => entry?.settings ?? null));
}

/**
 * Whether a deck can be moved into another one.
 *
 * Refused here as well as by the server. A picker that lets somebody choose a
 * target and then answers with a refusal has wasted the choice; the targets
 * that cannot work are disabled with the reason next to them.
 *
 * @param decks the whole tree
 * @param moving the deck being moved
 * @param target where it would go, or null for the root
 * @returns why not, or undefined when it is allowed
 */
export function moveProblem(
  decks: readonly DeckNode[],
  moving: string,
  target: string | null,
): 'self' | 'descendant' | 'same' | undefined {
  const deck = findDeck(decks, moving);

  if (!deck) {
    return undefined;
  }

  if (target === moving) {
    return 'self';
  }

  if ((deck.parentId ?? null) === target) {
    return 'same';
  }

  if (target !== null && findDeck(decks, target)?.path.includes(moving) === true) {
    return 'descendant';
  }

  return undefined;
}

/** Everything a deck row can be asked to do. */
export function useDeckActions() {
  const client = useQueryClient();
  // Cache reconciliation is follow-up work. A confirmed write must remain a
  // success even when a best-effort refresh is unavailable (for example during
  // a cold/briefly disconnected production request).
  const refresh = () => {
    void client.invalidateQueries({ queryKey: DECK_TREE_KEY }).catch(() => undefined);
  };

  const create = useMutation({
    mutationFn: (input: { name: string; parentId: string | null }) =>
      request<{ deck: Deck }>('/decks', {
        method: 'POST',
        // The id is generated here rather than by the server, so that a retry
        // after a timeout that actually landed does not make a second deck.
        body: { id: uuidV7(), name: input.name, parentId: input.parentId },
      }),
    onSuccess: refresh,
  });

  const rename = useMutation({
    mutationFn: (input: { id: string; name: string }) =>
      request<{ deck: Deck }>(`/decks/${input.id}`, {
        method: 'PATCH',
        body: { name: input.name },
      }),
    onSuccess: refresh,
  });

  const update = useMutation({
    mutationFn: (input: { id: string; settings: DeckSettings | null }) =>
      request<{ deck: Deck }>(`/decks/${input.id}`, {
        method: 'PATCH',
        body: { settings: input.settings },
      }),
    onSuccess: refresh,
  });

  const move = useMutation({
    mutationFn: (input: { id: string; parentId: string | null }) =>
      request<{ deck: Deck }>(`/decks/${input.id}/move`, {
        method: 'POST',
        body: { parentId: input.parentId },
      }),
    onSuccess: refresh,
  });

  const reorder = useMutation({
    mutationFn: (input: { parentId: string | null; order: readonly string[] }) =>
      request<{ decks: Deck[] }>('/decks/reorder', {
        method: 'POST',
        body: { parentId: input.parentId, order: input.order },
      }),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: (id: string) => request<{ deleted: number }>(`/decks/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  const restore = useMutation({
    mutationFn: (id: string) =>
      request<{ restored: number }>(`/decks/${id}/restore`, { method: 'POST' }),
    onSuccess: refresh,
  });

  return { create, rename, update, move, reorder, remove, restore };
}

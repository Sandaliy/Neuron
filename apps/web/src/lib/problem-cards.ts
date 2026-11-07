import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import type { CardDirection } from '@neuron/core';
import { PROBLEM_CARD_POLICY, problemCardsPageSchema } from '@neuron/shared';
import type {
  Card,
  Note,
  ProblemCard,
  ProblemCardSort,
  ProblemCardStateFilter,
  ProblemCardsPage,
} from '@neuron/shared';

import { ApiFailure, request } from './api';
import { problemCardCollection } from './collection-read';
import { collectionRead } from './collection-transport';
import { DECK_TREE_KEY } from './decks';
import { onNoteOutboxChange } from './note-outbox';
import { NOTE_KEY } from './notes';
import { accountEpoch, offlineState, retryDownload, useOffline } from './offline';

import type { InfiniteData } from '@tanstack/react-query';

export const PROBLEM_CARDS_KEY = ['cards', 'problems'] as const;
const PAGE = 50;

export interface ProblemCardFilters {
  readonly deckId: string | undefined;
  readonly direction: CardDirection | undefined;
  readonly state: ProblemCardStateFilter;
  readonly sort: ProblemCardSort;
  readonly search: string;
}

interface LocalDeck {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
}

/**
 * The downloaded answer to the same question, conservatively.
 *
 * A download holds each Card's scheduler projection, already net of Undo, restart and reset,
 * but not a verified Review history. So only the lapse rule is evaluated, from the `lapses`
 * counter, and the page says so. Frequent Again needs the history and is never guessed.
 * Pending Notes have no Cards. Answers this device has not delivered are not in the counters.
 */
export function localProblemCards(
  input: {
    readonly notes: readonly Note[];
    readonly decks: readonly LocalDeck[];
    readonly cards: readonly Card[];
    readonly unsent: ReadonlySet<string>;
  },
  filters: ProblemCardFilters,
  cursor?: string,
): ProblemCardsPage {
  const decks = new Map(input.decks.map((deck) => [deck.id, deck]));
  const chain = (id: string) => {
    const path: LocalDeck[] = [];
    const seen = new Set<string>();
    for (let at = decks.get(id); at && !seen.has(at.id); at = decks.get(at.parentId ?? '')) {
      seen.add(at.id);
      path.unshift(at);
      if (at.parentId === null) return path;
    }
    return undefined;
  };
  const notes = new Map(input.notes.map((note) => [note.id, note]));
  const search = filters.search.toLowerCase();
  const listed: ProblemCard[] = [];
  for (const card of input.cards) {
    if (card.lapses < PROBLEM_CARD_POLICY.repeatedLapses) continue;
    const note = notes.get(card.noteId);
    if (!note || note.status !== 'active' || input.unsent.has(note.id)) continue;
    if (note.deckId !== card.deckId) continue;
    if (filters.direction && card.direction !== filters.direction) continue;
    if (filters.state === 'studying' && card.suspendedAt) continue;
    if (filters.state === 'suspended' && !card.suspendedAt) continue;
    const path = chain(card.deckId);
    if (!path) continue;
    if (filters.deckId && !path.some((deck) => deck.id === filters.deckId)) continue;
    const deckPath = path.map((deck) => deck.name);
    if (
      search &&
      !`${JSON.stringify(note.fields)} ${note.source ?? ''} ${deckPath.join(' / ')}`
        .toLowerCase()
        .includes(search)
    )
      continue;
    listed.push({
      card: {
        id: card.id,
        noteId: card.noteId,
        deckId: card.deckId,
        direction: card.direction,
        slot: card.slot,
        state: card.state,
        due: card.due,
        suspendedAt: card.suspendedAt,
        rev: card.rev,
      },
      note: {
        id: note.id,
        deckId: note.deckId,
        noteType: note.noteType,
        fields: note.fields,
        source: note.source,
      },
      deckPath,
      reasons: ['repeated_lapses'],
      evidence: {
        kind: 'counters',
        answers: card.reps,
        lapses: card.lapses,
        lastAnsweredAt: card.lastReview,
      },
    });
  }
  const answered = (item: ProblemCard) =>
    item.evidence.lastAnsweredAt ? Date.parse(item.evidence.lastAnsweredAt) : 0;
  listed.sort(
    (a, b) =>
      (filters.sort === 'again' ? b.evidence.lapses - a.evidence.lapses : 0) ||
      answered(b) - answered(a) ||
      (a.card.id < b.card.id ? 1 : a.card.id > b.card.id ? -1 : 0),
  );
  const start = cursor === undefined ? 0 : listed.findIndex((item) => item.card.id === cursor) + 1;
  const items = listed.slice(start, start + PAGE);
  return {
    items,
    total: listed.length,
    local: true,
    ...(start + PAGE < listed.length ? { nextCursor: items.at(-1)!.card.id } : {}),
  };
}

async function readLocal(filters: ProblemCardFilters, cursor?: string) {
  const visit = accountEpoch();
  const accountId = offlineState().accountId;
  const collection = await problemCardCollection();
  const cards = await collection.cards();
  if (visit !== accountEpoch() || accountId !== offlineState().accountId)
    throw new DOMException('Collection read ended', 'AbortError');
  return localProblemCards(
    { notes: collection.notes, decks: collection.decks, cards, unsent: collection.unsent },
    filters,
    cursor,
  );
}

/** Separate local/server keys keep a cursor from crossing read authority. */
export function useProblemCards(filters: ProblemCardFilters) {
  const offline = useOffline();
  const client = useQueryClient();
  const visit = accountEpoch();
  useEffect(
    () =>
      onNoteOutboxChange((change) => {
        if (change.accountId === offline.accountId && visit === accountEpoch())
          void client.invalidateQueries({ queryKey: PROBLEM_CARDS_KEY });
      }),
    [client, offline.accountId, visit],
  );
  return useInfiniteQuery({
    queryKey: [
      ...PROBLEM_CARDS_KEY,
      offline.accountId,
      visit,
      offline.offline,
      offline.offline ? offline.revision : null,
      filters,
    ],
    enabled: !!offline.accountId && (!offline.offline || offline.available),
    networkMode: 'always',
    staleTime: 0,
    gcTime: 30 * 60_000,
    placeholderData: () => undefined,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: String(PAGE), sort: filters.sort });
      if (filters.state !== 'all') params.set('state', filters.state);
      if (filters.deckId) params.set('deckId', filters.deckId);
      if (filters.direction) params.set('direction', filters.direction);
      if (filters.search) params.set('search', filters.search);
      if (pageParam !== undefined) params.set('cursor', pageParam);
      return problemCardsPageSchema.parse(
        await collectionRead<ProblemCardsPage>(`/cards/problems?${params}`, signal, () =>
          readLocal(filters, pageParam),
        ),
      );
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

/**
 * Set aside and resume use the existing Card endpoints, which change `suspended_at` and the
 * revision only: due date, memory state, counters and Reviews are untouched. There is no
 * offline Card mutation; callers check server authority first.
 *
 * The listed row is patched in place and the list is marked stale without refetching, so the
 * row, its focus and the scroll position stay put. The next visit reads the server again.
 */
export function useCardSuspension() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, suspend }: { id: string; suspend: boolean }) => {
      try {
        return (
          await request<{ card: Card }>(`/cards/${id}/${suspend ? 'suspend' : 'unsuspend'}`, {
            method: 'POST',
          })
        ).card;
      } catch (error) {
        // Suspending an already suspended Card answers not found: re-read the actual state.
        if (suspend && error instanceof ApiFailure && error.code === 'not_found') {
          return (await request<{ card: Card }>(`/cards/${id}`)).card;
        }
        throw error;
      }
    },
    onSuccess: (card) => {
      client.setQueriesData<InfiniteData<ProblemCardsPage>>(
        { queryKey: PROBLEM_CARDS_KEY },
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              items: page.items.map((item) =>
                item.card.id === card.id
                  ? {
                      ...item,
                      card: { ...item.card, suspendedAt: card.suspendedAt, rev: card.rev },
                    }
                  : item,
              ),
            })),
          },
      );
      void client.invalidateQueries({ queryKey: PROBLEM_CARDS_KEY, refetchType: 'none' });
      void client.invalidateQueries({ queryKey: [NOTE_KEY] });
      void client.invalidateQueries({ queryKey: DECK_TREE_KEY });
      void client.invalidateQueries({ queryKey: ['study-plan'] });
      // Bring the download up to the server's revision, so offline Study agrees.
      void retryDownload();
    },
  });
}

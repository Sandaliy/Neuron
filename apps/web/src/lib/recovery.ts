import { useQuery } from '@tanstack/react-query';

import type { DeletedDeck, DeletedNote } from '@neuron/shared';

import { request } from './api';

/** Recovery data is deliberately separate from every live library query. */
export const DELETED_DECKS_KEY = ['decks', 'deleted'] as const;
export const DELETED_NOTES_KEY = ['notes', 'deleted'] as const;

export function useDeletedDecks() {
  return useQuery({
    queryKey: DELETED_DECKS_KEY,
    queryFn: () => request<{ decks: DeletedDeck[] }>('/decks/deleted'),
    select: (data) => data.decks,
  });
}

export function useDeletedNotes() {
  return useQuery({
    queryKey: DELETED_NOTES_KEY,
    queryFn: () => request<{ notes: DeletedNote[] }>('/notes/deleted'),
    select: (data) => data.notes,
  });
}

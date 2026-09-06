import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  Card,
  Note,
  NoteSort,
  NoteStatus,
  NoteTypeName,
  DuplicateMatch,
  RestoreNoteResult,
} from '@neuron/shared';

import { request } from './api';
import { DECK_TREE_KEY } from './decks';

/**
 * Notes over the wire.
 *
 * A note and its cards always travel together. The editor needs both to say
 * what an edit will cost, and separating them would mean two requests where the
 * server already answers with one.
 */

export const NOTE_KEY = 'notes';

/** One note and the cards it currently has. */
export function useNote(id: string | undefined) {
  return useQuery({
    queryKey: [NOTE_KEY, id],
    queryFn: () => request<{ note: Note; cards: Card[] }>(`/notes/${id ?? ''}`),
    enabled: id !== undefined,
  });
}

/** What the browse screen is asking the api for. */
export interface NoteQuery {
  readonly deckId?: string | undefined;
  readonly status?: NoteStatus | undefined;
  readonly tag?: string | undefined;
  readonly source?: string | undefined;
  readonly cardState?: string | undefined;
  readonly search?: string | undefined;
  readonly sort?: NoteSort | undefined;
}

/** The query as a string, which is also what the cache is keyed by. */
export function noteQueryString(query: NoteQuery, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();

  for (const [name, value] of Object.entries({ ...query, ...extra })) {
    if (value !== undefined && value !== '') {
      params.set(name, String(value));
    }
  }

  return params.toString();
}

/** What a note write asks for, and what it costs. */
export interface NoteInput {
  readonly deckId: string;
  readonly noteType: NoteTypeName;
  readonly fields: Record<string, unknown>;
  readonly tags: readonly string[];
}

export function useNoteActions() {
  const client = useQueryClient();

  /*
   * A write changes what the library counts and what the list holds, so both
   * are dropped rather than patched. Editing the cached copy by hand would be
   * right for the note and wrong for the counts rolled up over three levels of
   * folder above it.
   */
  const refresh = () => {
    void Promise.all([
      client.invalidateQueries({ queryKey: [NOTE_KEY] }),
      client.invalidateQueries({ queryKey: DECK_TREE_KEY }),
    ]).catch(() => undefined);
  };

  const create = useMutation({
    mutationFn: (input: NoteInput & { readonly id: string }) =>
      request<{ note: Note; cards: Card[] }>('/notes', { method: 'POST', body: input }),
    onSuccess: refresh,
  });

  const update = useMutation({
    mutationFn: (input: {
      readonly id: string;
      readonly fields?: Record<string, unknown>;
      readonly tags?: readonly string[];
      readonly noteType?: NoteTypeName;
      readonly status?: NoteStatus;
      readonly deckId?: string;
      readonly discardCards?: boolean;
    }) => {
      const { id, ...body } = input;

      return request<{ note: Note; cards: Card[] }>(`/notes/${id}`, { method: 'PATCH', body });
    },
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: (id: string) => request<{ deleted: boolean }>(`/notes/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  const restore = useMutation({
    mutationFn: (id: string) =>
      request<RestoreNoteResult>(`/notes/${id}/restore`, { method: 'POST' }),
    onSuccess: refresh,
  });

  const setStatus = useMutation({
    mutationFn: (input: { readonly ids: readonly string[]; readonly status: NoteStatus }) =>
      request<{ changed: number }>('/notes/status', { method: 'POST', body: input }),
    onSuccess: refresh,
  });

  const move = useMutation({
    mutationFn: (input: { readonly ids: readonly string[]; readonly deckId: string }) =>
      request<{ changed: number }>('/notes/move', { method: 'POST', body: input }),
    onSuccess: refresh,
  });

  const tag = useMutation({
    mutationFn: (input: {
      readonly ids: readonly string[];
      readonly add?: readonly string[];
      readonly remove?: readonly string[];
    }) => request<{ changed: number }>('/notes/tags', { method: 'POST', body: input }),
    onSuccess: refresh,
  });

  const removeMany = useMutation({
    mutationFn: (ids: readonly string[]) =>
      request<{ deleted: number }>('/notes/delete', { method: 'POST', body: { ids } }),
    onSuccess: refresh,
  });

  return { create, update, remove, restore, setStatus, move, tag, removeMany };
}

/**
 * Which of these words the library already has.
 *
 * One request for a whole chunk rather than one per word, because an import of
 * five thousand rows cannot be five thousand round trips.
 *
 * @param terms the words to ask about, already read out of the file
 * @returns what was found, keyed by the comparable form of the term
 */
export async function findDuplicates(terms: readonly string[]): Promise<DuplicateMatch[]> {
  const found: DuplicateMatch[] = [];

  // The duplicate endpoint deliberately rejects an empty list. Imports whose
  // identity field is not comparable yet (for example an invalid/empty row)
  // still have a valid preview and must not enter the connection/retry state.
  if (terms.length === 0) return found;

  for (let start = 0; start < terms.length; start += 1000) {
    const body = await request<{ matches: DuplicateMatch[] }>('/notes/duplicates', {
      method: 'POST',
      body: { terms: terms.slice(start, start + 1000) },
    });

    found.push(...body.matches);
  }

  return found;
}

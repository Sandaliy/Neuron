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

type NoteDetail = { note: Note; cards: Card[] };
type NoteListPage = { items: Note[]; nextCursor?: string };
type NoteListCache = { pages: readonly NoteListPage[]; pageParams: readonly unknown[] };

/** Applies one confirmed note to every list that already contains it. */
function replaceInLists(client: ReturnType<typeof useQueryClient>, written: Note): void {
  client.setQueriesData<NoteListCache>({ queryKey: [NOTE_KEY, 'list'] }, (current) => {
    if (!current) return current;

    return {
      ...current,
      pages: current.pages.map((page) => ({
        ...page,
        items: page.items.map((note) =>
          note.id === written.id
            ? {
                ...note,
                ...written,
                // The detail endpoint does not calculate list summaries.
                cardStates: written.cardStates ?? note.cardStates,
              }
            : note,
        ),
      })),
    };
  });
}

/** Removes a confirmed deletion without briefly bringing the row back on Back. */
function removeFromLists(client: ReturnType<typeof useQueryClient>, id: string): void {
  client.setQueriesData<NoteListCache>({ queryKey: [NOTE_KEY, 'list'] }, (current) => {
    if (!current) return current;

    return {
      ...current,
      pages: current.pages.map((page) => ({
        ...page,
        items: page.items.filter((note) => note.id !== id),
      })),
    };
  });
}

export function useNoteActions() {
  const client = useQueryClient();

  /*
   * The server response is enough to reconcile the note itself. Refetching
   * every active note/list/tree query after each write made one autosave turn
   * into a second network round trip and re-rendered the editor under the
   * keyboard. Counts are still marked stale, but only reconciled on the next
   * screen that needs them.
   */
  const markCollectionStale = () => {
    void Promise.all([
      client.invalidateQueries({ queryKey: [NOTE_KEY, 'list'], refetchType: 'none' }),
      client.invalidateQueries({ queryKey: DECK_TREE_KEY, refetchType: 'none' }),
    ]).catch(() => undefined);
  };

  /** Refreshes browse rows after a confirmed bulk write, without touching an open editor. */
  const refreshLists = () => {
    void Promise.all([
      client.invalidateQueries({ queryKey: [NOTE_KEY, 'list'] }),
      client.invalidateQueries({ queryKey: DECK_TREE_KEY, refetchType: 'none' }),
    ]).catch(() => undefined);
  };

  const reconcileWrite = (written: NoteDetail) => {
    client.setQueryData<NoteDetail>([NOTE_KEY, written.note.id], written);
    replaceInLists(client, written.note);
    markCollectionStale();
  };

  const create = useMutation({
    mutationFn: (input: NoteInput & { readonly id: string }) =>
      request<{ note: Note; cards: Card[] }>('/notes', { method: 'POST', body: input }),
    onSuccess: reconcileWrite,
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
    onMutate: (input) => {
      if (input.status === undefined) {
        return undefined;
      }

      const detail = client.getQueryData<NoteDetail>([NOTE_KEY, input.id]);
      const lists = client.getQueriesData<NoteListCache>({ queryKey: [NOTE_KEY, 'list'] });

      if (detail) {
        client.setQueryData<NoteDetail>([NOTE_KEY, input.id], {
          ...detail,
          note: { ...detail.note, status: input.status },
        });
      }

      replaceInLists(client, { id: input.id, status: input.status } as Note);

      return { detail, lists };
    },
    onError: (_error, _input, context) => {
      if (!context) return;

      if (context.detail) {
        client.setQueryData<NoteDetail>([NOTE_KEY, context.detail.note.id], context.detail);
      }

      for (const [key, value] of context.lists) {
        client.setQueryData(key, value);
      }
    },
    onSuccess: reconcileWrite,
  });

  const remove = useMutation({
    mutationFn: (id: string) => request<{ deleted: boolean }>(`/notes/${id}`, { method: 'DELETE' }),
    onSuccess: (_result, id) => {
      client.removeQueries({ queryKey: [NOTE_KEY, id], exact: true });
      removeFromLists(client, id);
      markCollectionStale();
    },
  });

  const restore = useMutation({
    mutationFn: (id: string) =>
      request<RestoreNoteResult>(`/notes/${id}/restore`, { method: 'POST' }),
    onSuccess: markCollectionStale,
  });

  const setStatus = useMutation({
    mutationFn: (input: { readonly ids: readonly string[]; readonly status: NoteStatus }) =>
      request<{ changed: number }>('/notes/status', { method: 'POST', body: input }),
    onMutate: async (input) => {
      await client.cancelQueries({ queryKey: [NOTE_KEY, 'list'] });

      const lists = client.getQueriesData<NoteListCache>({ queryKey: [NOTE_KEY, 'list'] });
      const ids = new Set(input.ids);

      client.setQueriesData<NoteListCache>({ queryKey: [NOTE_KEY, 'list'] }, (current) => {
        if (!current) return current;

        return {
          ...current,
          pages: current.pages.map((page) => ({
            ...page,
            items: page.items.map((note) =>
              ids.has(note.id) ? { ...note, status: input.status } : note,
            ),
          })),
        };
      });

      return { lists };
    },
    onError: (_error, _input, context) => {
      for (const [key, value] of context?.lists ?? []) {
        client.setQueryData(key, value);
      }
    },
    onSuccess: refreshLists,
  });

  const move = useMutation({
    mutationFn: (input: { readonly ids: readonly string[]; readonly deckId: string }) =>
      request<{ changed: number }>('/notes/move', { method: 'POST', body: input }),
    onSuccess: markCollectionStale,
  });

  const tag = useMutation({
    mutationFn: (input: {
      readonly ids: readonly string[];
      readonly add?: readonly string[];
      readonly remove?: readonly string[];
    }) => request<{ changed: number }>('/notes/tags', { method: 'POST', body: input }),
    onSuccess: markCollectionStale,
  });

  const removeMany = useMutation({
    mutationFn: (ids: readonly string[]) =>
      request<{ deleted: number }>('/notes/delete', { method: 'POST', body: { ids } }),
    onSuccess: markCollectionStale,
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
export async function findDuplicates(
  deckId: string,
  terms: readonly string[],
): Promise<DuplicateMatch[]> {
  const found: DuplicateMatch[] = [];

  // The duplicate endpoint deliberately rejects an empty list. Imports whose
  // identity field is not comparable yet (for example an invalid/empty row)
  // still have a valid preview and must not enter the connection/retry state.
  if (terms.length === 0) return found;

  for (let start = 0; start < terms.length; start += 1000) {
    const body = await request<{ matches: DuplicateMatch[] }>('/notes/duplicates', {
      method: 'POST',
      body: { deckId, terms: terms.slice(start, start + 1000) },
    });

    found.push(...body.matches);
  }

  return found;
}

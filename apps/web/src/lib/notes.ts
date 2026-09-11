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

import type { InfiniteData } from '@tanstack/react-query';

/**
 * Notes over the wire.
 *
 * A note and its cards always travel together. The editor needs both to say
 * what an edit will cost, and separating them would mean two requests where the
 * server already answers with one.
 */

export const NOTE_KEY = 'notes';
type NotePages = InfiniteData<{ items: Note[]; nextCursor?: string }>;

/** One note and the cards it currently has. */
export function useNote(id: string | undefined) {
  return useQuery({
    ...noteQuery(id),
    placeholderData: () => undefined,
    enabled: id !== undefined,
  });
}

export function noteQuery(id: string | undefined) {
  return {
    queryKey: [NOTE_KEY, id],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      request<{ note: Note; cards: Card[] }>(`/notes/${id ?? ''}`, { signal }),
  };
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

  function accept(written: { note: Note; cards: Card[] }, created = false) {
    const pendingStatus = client
      .getMutationCache()
      .findAll({ mutationKey: ['note-status'], status: 'pending' })
      .map((mutation) => mutation.state.variables as { ids: readonly string[]; status: NoteStatus })
      .find((input) => input.ids.includes(written.note.id));
    if (pendingStatus)
      written = { ...written, note: { ...written.note, status: pendingStatus.status } };
    client.setQueryData([NOTE_KEY, written.note.id], written);
    for (const [key, data] of client.getQueriesData<NotePages>({ queryKey: [NOTE_KEY, 'list'] })) {
      if (!data) continue;
      const params = new URLSearchParams(String(key[2]));
      const canAppend =
        created &&
        (!params.get('deckId') || params.get('deckId') === written.note.deckId) &&
        (!params.get('sort') || params.get('sort') === 'created') &&
        !['search', 'status', 'tag', 'source', 'cardState'].some((name) => params.has(name)) &&
        !data.pages.at(-1)?.nextCursor;
      const exists = data.pages.some((page) =>
        page.items.some((note) => note.id === written.note.id),
      );
      client.setQueryData<NotePages>(key, {
        ...data,
        pages: data.pages.map((page, index) => ({
          ...page,
          items: [
            ...page.items.map((note) =>
              note.id === written.note.id ? { ...note, ...written.note } : note,
            ),
            ...(canAppend && !exists && index === data.pages.length - 1 ? [written.note] : []),
          ],
        })),
      });
    }
    // Revalidate on the next visit, without making every keystroke refetch a
    // thousand rows and the entire deck tree while the keyboard is open.
    void client.invalidateQueries({ queryKey: [NOTE_KEY, 'list'], refetchType: 'none' });
    void client.invalidateQueries({ queryKey: DECK_TREE_KEY, refetchType: 'none' });
  }

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

  const create = useMutation({
    mutationFn: (input: NoteInput & { readonly id: string }) =>
      request<{ note: Note; cards: Card[] }>('/notes', { method: 'POST', body: input }),
    onSuccess: (written) => accept(written, true),
  });

  const update = useMutation({
    scope: { id: 'note-writes' },
    onMutate: async ({ id }) => {
      await Promise.all([
        client.cancelQueries({ queryKey: [NOTE_KEY, id], exact: true }),
        client.cancelQueries({ queryKey: [NOTE_KEY, 'list'] }),
      ]);
    },
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
    onSuccess: (written) => accept(written),
  });

  const remove = useMutation({
    mutationFn: (id: string) => request<{ deleted: boolean }>(`/notes/${id}`, { method: 'DELETE' }),
    onSuccess: (_result, id) => {
      client.removeQueries({ queryKey: [NOTE_KEY, id], exact: true });
      client.setQueriesData<NotePages>(
        { queryKey: [NOTE_KEY, 'list'] },
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              items: page.items.filter((note) => note.id !== id),
            })),
          },
      );
      markCollectionStale();
    },
  });

  const restore = useMutation({
    mutationFn: (id: string) =>
      request<RestoreNoteResult>(`/notes/${id}/restore`, { method: 'POST' }),
    onSuccess: markCollectionStale,
  });

  const setStatus = useMutation({
    mutationKey: ['note-status'],
    scope: { id: 'note-writes' },
    mutationFn: (input: { readonly ids: readonly string[]; readonly status: NoteStatus }) =>
      request<{ changed: number }>('/notes/status', { method: 'POST', body: input }),
    onMutate: async ({ ids, status }) => {
      await client.cancelQueries({ queryKey: [NOTE_KEY] });
      const previous = client.getQueriesData<NotePages>({ queryKey: [NOTE_KEY, 'list'] });
      const details = ids.map(
        (id) => [id, client.getQueryData<{ note: Note; cards: Card[] }>([NOTE_KEY, id])] as const,
      );
      const selected = new Set(ids);
      client.setQueriesData<NotePages>(
        { queryKey: [NOTE_KEY, 'list'] },
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              items: page.items.map((note) => (selected.has(note.id) ? { ...note, status } : note)),
            })),
          },
      );
      for (const [id, data] of details)
        if (data) client.setQueryData([NOTE_KEY, id], { ...data, note: { ...data.note, status } });
      return { previous, details };
    },
    onError: (_error, _input, context) => {
      const selected = new Set(_input.ids);
      for (const [key, data] of context?.previous ?? []) {
        const oldStatus = new Map(
          data?.pages.flatMap((page) => page.items.map((note) => [note.id, note.status] as const)),
        );
        client.setQueryData<NotePages>(
          key,
          (current) =>
            current && {
              ...current,
              pages: current.pages.map((page) => ({
                ...page,
                items: page.items.map((note) => {
                  const status = oldStatus.get(note.id);
                  return selected.has(note.id) && status ? { ...note, status } : note;
                }),
              })),
            },
        );
      }
      for (const [id, data] of context?.details ?? [])
        if (data) {
          client.setQueryData<{ note: Note; cards: Card[] }>(
            [NOTE_KEY, id],
            (current) =>
              current && { ...current, note: { ...current.note, status: data.note.status } },
          );
        }
    },
    onSettled: refreshLists,
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

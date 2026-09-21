import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  Card,
  Note,
  NoteSort,
  NoteStatus,
  NoteTypeName,
  DuplicateMatch,
  RestoreNoteResult,
  DeletedNote,
  DeckNode,
} from '@neuron/shared';

import { request } from './api';
import { DECK_TREE_KEY, flatten } from './decks';
import { writeEntities } from './entity-writes';
import { projectNotes } from './note-projection';
import { DELETED_NOTES_KEY } from './recovery';

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
const deletingNotes = new Map<string, Promise<{ deleted: boolean }>>();

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
      .findAll({ mutationKey: ['note-interaction', 'status'], status: 'pending' })
      .map((mutation) => mutation.state.variables as { ids: readonly string[]; status: NoteStatus })
      .filter((input) => input.ids.includes(written.note.id))
      .at(-1);
    if (pendingStatus)
      written = { ...written, note: { ...written.note, status: pendingStatus.status } };
    const resetting = client
      .getMutationCache()
      .findAll({ mutationKey: ['note-interaction', 'restart'], status: 'pending' })
      .some(
        (mutation) => (mutation.state.variables as { noteId: string }).noteId === written.note.id,
      );
    if (resetting)
      written = {
        note: { ...written.note, status: 'active' },
        cards: written.cards.map(resetCard),
      };
    for (const mutation of client
      .getMutationCache()
      .findAll({ mutationKey: ['note-interaction'], status: 'pending' })) {
      const input = mutation.state.variables as {
        ids?: readonly string[];
        deckId?: string;
        add?: readonly string[];
        remove?: readonly string[];
      };
      if (!input.ids?.includes(written.note.id)) continue;
      if (mutation.options.mutationKey?.[1] === 'move' && input.deckId) {
        written = {
          note: { ...written.note, deckId: input.deckId },
          cards: written.cards.map((card) => ({ ...card, deckId: input.deckId! })),
        };
      }
      if (mutation.options.mutationKey?.[1] === 'tag')
        written = {
          ...written,
          note: {
            ...written.note,
            tags: [
              ...new Set([
                ...written.note.tags.filter((tag) => !input.remove?.includes(tag)),
                ...(input.add ?? []),
              ]),
            ],
          },
        };
    }
    const cardStates = { new: 0, learning: 0, review: 0, relearning: 0 };
    for (const card of written.cards) cardStates[card.state]++;
    written = { ...written, note: { ...written.note, cardStates } };
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
      client.invalidateQueries({ queryKey: ['study-plan'], refetchType: 'none' }),
    ]).catch(() => undefined);
  };

  const reconcileInteraction = () => {
    markCollectionStale();
    // Only planning requires fresh server policy. Keep visible projections in place.
    if (client.isMutating({ mutationKey: ['note-interaction'] }) === 1) {
      void client.invalidateQueries({ queryKey: ['study-plan'] });
      void client.invalidateQueries({ queryKey: DECK_TREE_KEY });
    }
  };

  const create = useMutation({
    mutationFn: (input: NoteInput & { readonly id: string }) =>
      request<{ note: Note; cards: Card[] }>('/notes', { method: 'POST', body: input }),
    onSuccess: (written) => accept(written, true),
  });

  const update = useMutation({
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

      return writeEntities(client, [id], () =>
        request<{ note: Note; cards: Card[] }>(`/notes/${id}`, { method: 'PATCH', body }),
      );
    },
    onSuccess: (written) => accept(written),
  });

  const reconcileRecovery = () => {
    if (client.isMutating({ mutationKey: ['note-recovery'] }) !== 1) return;
    void client.invalidateQueries({ queryKey: DELETED_NOTES_KEY });
    void client.invalidateQueries({ queryKey: [NOTE_KEY, 'list'] });
    void client.invalidateQueries({ queryKey: DECK_TREE_KEY, exact: true });
  };

  const remove = useMutation({
    mutationKey: ['note-recovery'],
    onMutate: async (id: string) => {
      await Promise.all([
        client.cancelQueries({ queryKey: [NOTE_KEY, 'list'] }),
        client.cancelQueries({ queryKey: DELETED_NOTES_KEY }),
      ]);
      const previous = client.getQueriesData<NotePages>({ queryKey: [NOTE_KEY, 'list'] });
      const note = previous
        .flatMap(([, data]) => data?.pages.flatMap((page) => page.items) ?? [])
        .find((row) => row.id === id);
      if (note) {
        const all = flatten(client.getQueryData<{ decks: DeckNode[] }>(DECK_TREE_KEY)?.decks ?? []);
        const deck = all.find((row) => row.id === note.deckId);
        client.setQueryData<{ notes: DeletedNote[] }>(DELETED_NOTES_KEY, (data) => ({
          notes: [
            {
              ...note,
              deckLive: !!deck,
              deckPath: [...(deck?.path ?? []), note.deckId].flatMap((key) => {
                const item = all.find((row) => row.id === key);
                return item ? [item.name] : [];
              }),
            },
            ...(data?.notes ?? []).filter((row) => row.id !== id),
          ],
        }));
      }
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
      return { previous };
    },
    onError: (_error, id, context) => {
      client.setQueryData<{ notes: DeletedNote[] }>(
        DELETED_NOTES_KEY,
        (data) => data && { notes: data.notes.filter((row) => row.id !== id) },
      );
      for (const [key, previous] of context?.previous ?? []) {
        const pageIndex =
          previous?.pages.findIndex((page) => page.items.some((note) => note.id === id)) ?? -1;
        const oldPage = previous?.pages[pageIndex];
        const index = oldPage?.items.findIndex((note) => note.id === id) ?? -1;
        const note = oldPage?.items[index];
        if (!note) continue;
        client.setQueryData<NotePages>(
          key,
          (current) =>
            current && {
              ...current,
              pages: current.pages.map((page, at) => {
                if (at !== pageIndex || page.items.some((row) => row.id === id)) return page;
                const items = [...page.items];
                items.splice(index, 0, note);
                return { ...page, items };
              }),
            },
        );
      }
      markCollectionStale();
    },
    mutationFn: (id: string) => {
      const pending = deletingNotes.get(id);
      if (pending) return pending;
      const operation = request<{ deleted: boolean }>(`/notes/${id}`, { method: 'DELETE' });
      deletingNotes.set(id, operation);
      void operation.finally(() => deletingNotes.delete(id)).catch(() => undefined);
      return operation;
    },
    onSettled: reconcileRecovery,
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
    mutationKey: ['note-recovery'],
    onMutate: async (id: string) => {
      await client.cancelQueries({ queryKey: DELETED_NOTES_KEY });
      const note = client
        .getQueryData<{ notes: DeletedNote[] }>(DELETED_NOTES_KEY)
        ?.notes.find((row) => row.id === id);
      client.setQueryData<{ notes: DeletedNote[] }>(
        DELETED_NOTES_KEY,
        (data) => data && { notes: data.notes.filter((row) => row.id !== id) },
      );
      return { note };
    },
    onError: (_error, id, context) => {
      const note = context?.note;
      if (note)
        client.setQueryData<{ notes: DeletedNote[] }>(DELETED_NOTES_KEY, (data) => ({
          notes: [note, ...(data?.notes ?? []).filter((row) => row.id !== id)],
        }));
    },
    mutationFn: async (id: string) => {
      await deletingNotes.get(id);
      return request<RestoreNoteResult>(`/notes/${id}/restore`, { method: 'POST' });
    },
    onSuccess: markCollectionStale,
    onSettled: reconcileRecovery,
  });

  const enableDirection = useMutation({
    mutationKey: ['note-interaction', 'direction'],
    mutationFn: (input: { noteId: string; direction: 'production' | 'listening' }) =>
      writeEntities(client, [input.noteId], () =>
        request<{ card: Card }>(`/notes/${input.noteId}/cards`, {
          method: 'POST',
          body: { direction: input.direction },
        }),
      ),
    onError: (_error, input) => {
      // A lost response may still have created the server-owned Card identity.
      void client.invalidateQueries({ queryKey: [NOTE_KEY, input.noteId], exact: true });
    },
    onSuccess: ({ card }, input) => {
      const detail = client.getQueryData<{ note: Note; cards: Card[] }>([NOTE_KEY, input.noteId]);
      if (detail)
        accept({
          note: detail.note,
          cards: [...detail.cards.filter((item) => item.id !== card.id), card],
        });
    },
    onSettled: reconcileInteraction,
  });

  const studyAgain = useMutation({
    mutationKey: ['note-interaction', 'restart'],
    onMutate: ({ noteId }: { noteId: string; id: string }) => ({
      rollback: projectNotes(
        client,
        [noteId],
        (note) => ({ ...note, status: 'active' }),
        (cards) => cards.map(resetCard),
      ),
    }),
    onError: (_error, _input, context) => context?.rollback(),
    onSettled: reconcileInteraction,
    mutationFn: (input: { noteId: string; id: string }) =>
      writeEntities(client, [input.noteId], () =>
        request<{ note: Note; cards: Card[] }>(`/notes/${input.noteId}/study-again`, {
          method: 'POST',
          body: { id: input.id },
        }),
      ),
    onSuccess: (written) => {
      accept(written);
      markCollectionStale();
    },
  });

  const setStatus = useMutation({
    mutationKey: ['note-interaction', 'status'],
    mutationFn: (input: { readonly ids: readonly string[]; readonly status: NoteStatus }) =>
      writeEntities(client, input.ids, () =>
        request<{ changed: number }>('/notes/status', { method: 'POST', body: input }),
      ),
    onMutate: ({ ids, status }) => ({
      rollback: projectNotes(client, ids, (note) => ({ ...note, status })),
    }),
    onError: (_error, _input, context) => context?.rollback(),
    onSettled: reconcileInteraction,
  });

  const move = useMutation({
    mutationKey: ['note-interaction', 'move'],
    onMutate: (input: { readonly ids: readonly string[]; readonly deckId: string }) => ({
      rollback: projectNotes(
        client,
        input.ids,
        (note) => ({ ...note, deckId: input.deckId }),
        (cards) => cards.map((card) => ({ ...card, deckId: input.deckId })),
      ),
    }),
    onError: (_error, _input, context) => context?.rollback(),
    onSettled: reconcileInteraction,
    mutationFn: (input: { readonly ids: readonly string[]; readonly deckId: string }) =>
      writeEntities(client, input.ids, () =>
        request<{ changed: number }>('/notes/move', { method: 'POST', body: input }),
      ),
    onSuccess: markCollectionStale,
  });

  const tag = useMutation({
    mutationKey: ['note-interaction', 'tag'],
    onMutate: (input: {
      readonly ids: readonly string[];
      readonly add?: readonly string[];
      readonly remove?: readonly string[];
    }) => ({
      rollback: projectNotes(client, input.ids, (note) => ({
        ...note,
        tags: [
          ...new Set([
            ...note.tags.filter((tag) => !input.remove?.includes(tag)),
            ...(input.add ?? []),
          ]),
        ],
      })),
    }),
    onError: (_error, _input, context) => context?.rollback(),
    onSettled: markCollectionStale,
    mutationFn: (input: {
      readonly ids: readonly string[];
      readonly add?: readonly string[];
      readonly remove?: readonly string[];
    }) =>
      writeEntities(client, input.ids, () =>
        request<{ changed: number }>('/notes/tags', { method: 'POST', body: input }),
      ),
    onSuccess: markCollectionStale,
  });

  const removeMany = useMutation({
    mutationFn: (ids: readonly string[]) =>
      request<{ deleted: number }>('/notes/delete', { method: 'POST', body: { ids } }),
    onSuccess: markCollectionStale,
  });

  return {
    create,
    update,
    remove,
    restore,
    setStatus,
    studyAgain,
    enableDirection,
    move,
    tag,
    removeMany,
  };
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

function resetCard(card: Card): Card {
  return card.suspendedAt
    ? card
    : {
        ...card,
        state: 'new',
        stability: null,
        difficulty: null,
        lastReview: null,
        reps: 0,
        lapses: 0,
        learningStep: 0,
      };
}

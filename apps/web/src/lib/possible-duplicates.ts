import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
  possibleDuplicateGroupsPageSchema,
  possibleDuplicateNotesPageSchema,
} from '@neuron/shared';
import type { PossibleDuplicateGroupsPage, PossibleDuplicateNotesPage } from '@neuron/shared';

import { duplicateCollection } from './collection-read';
import { collectionRead } from './collection-transport';
import { indexDuplicateNotes } from './duplicate-index';
import { onNoteOutboxChange } from './note-outbox';
import { accountEpoch, offlineState, useOffline } from './offline';

import type { DuplicateIndexEntry } from './duplicate-index';

const PREFIX = ['notes', 'possible-duplicates'] as const;
const indices = new WeakMap<object, { version: number; value: Promise<DuplicateIndexEntry[]> }>();
const yieldToInput = () =>
  new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });

async function localIndex() {
  const visit = accountEpoch();
  const accountId = offlineState().accountId;
  const collection = await duplicateCollection();
  let cached = indices.get(collection);
  if (!cached || cached.version !== collection.browseVersion) {
    cached = {
      version: collection.browseVersion,
      value: indexDuplicateNotes(
        collection.notes,
        collection.decks,
        collection.unsent,
        yieldToInput,
      ),
    };
    indices.set(collection, cached);
  }
  const value = await cached.value;
  if (visit !== accountEpoch() || accountId !== offlineState().accountId)
    throw new DOMException('Collection read ended', 'AbortError');
  if (cached.version !== collection.browseVersion) return localIndex();
  return value;
}

export async function localDuplicateGroups(
  deckId: string | undefined,
  search: string,
  cursor?: string,
): Promise<PossibleDuplicateGroupsPage> {
  const groups = (await localIndex()).flatMap((group) => {
    const notes = deckId ? group.notes.filter((note) => note.deckId === deckId) : group.notes;
    if (notes.length < 2 || (cursor !== undefined && group.key <= cursor)) return [];
    const text = deckId
      ? `${group.key}\n` +
        notes
          .map(
            (note) =>
              `${JSON.stringify(note.fields)} ${note.source ?? ''} ${note.deckPath.join(' / ')}`,
          )
          .join('\n')
          .toLowerCase()
      : group.search;
    return search && !text.includes(search.toLowerCase())
      ? []
      : [{ key: group.key, count: notes.length }];
  });
  return {
    items: groups.slice(0, 50),
    local: true,
    ...(groups.length > 50 ? { nextCursor: groups[49]!.key } : {}),
  };
}
export async function localDuplicateNotes(
  deckId: string | undefined,
  key: string,
  cursor?: string,
): Promise<PossibleDuplicateNotesPage> {
  const group = (await localIndex()).find((group) => group.key === key);
  const notes = group?.notes.filter((note) => !deckId || note.deckId === deckId) ?? [];
  const after =
    notes.length < 2 ? [] : notes.filter((note) => cursor === undefined || note.id > cursor);
  return {
    items: after.slice(0, 100),
    local: true,
    ...(after.length > 100 ? { nextCursor: after[99]!.id } : {}),
  };
}

/** Separate local/server page keys prevent a cursor crossing an authority change. */
export function usePossibleDuplicates(
  deckId: string | undefined,
  search: string,
  group: string | undefined,
) {
  const offline = useOffline();
  const client = useQueryClient();
  const visit = accountEpoch();
  useEffect(() => {
    const refresh = (change: { accountId: string }) => {
      if (change.accountId === offline.accountId && visit === accountEpoch())
        void client.invalidateQueries({ queryKey: PREFIX });
    };
    const edited = onNoteOutboxChange(refresh);
    return edited;
  }, [client, offline.accountId, visit]);
  const base = [
    ...PREFIX,
    offline.accountId,
    visit,
    offline.offline,
    offline.offline ? offline.revision : null,
    deckId,
  ];
  const enabled = !!offline.accountId && (!offline.offline || offline.available);
  const groups = useInfiniteQuery({
    queryKey: [...base, 'groups', search],
    enabled: enabled && group === undefined,
    networkMode: 'always',
    staleTime: 0,
    placeholderData: () => undefined,
    initialPageParam: undefined as string | undefined,
    gcTime: 30 * 60_000,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: '50' });
      if (deckId) params.set('deckId', deckId);
      if (search) params.set('search', search);
      if (pageParam !== undefined) params.set('cursor', pageParam);
      return possibleDuplicateGroupsPageSchema.parse(
        await collectionRead<PossibleDuplicateGroupsPage>(
          `/notes/possible-duplicates?${params}`,
          signal,
          () => localDuplicateGroups(deckId, search, pageParam),
        ),
      );
    },
    getNextPageParam: (last) => last.nextCursor,
  });
  const notes = useInfiniteQuery({
    queryKey: [...base, 'members', group],
    enabled: enabled && group !== undefined,
    networkMode: 'always',
    staleTime: 0,
    placeholderData: () => undefined,
    initialPageParam: undefined as string | undefined,
    gcTime: 30 * 60_000,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ key: group ?? '', limit: '100' });
      if (deckId) params.set('deckId', deckId);
      if (pageParam !== undefined) params.set('cursor', pageParam);
      return possibleDuplicateNotesPageSchema.parse(
        await collectionRead<PossibleDuplicateNotesPage>(
          `/notes/possible-duplicates/notes?${params}`,
          signal,
          () => localDuplicateNotes(deckId, group ?? '', pageParam),
        ),
      );
    },
    getNextPageParam: (last) => last.nextCursor,
  });
  return { groups, notes };
}

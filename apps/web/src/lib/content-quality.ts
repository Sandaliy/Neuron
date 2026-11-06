import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { contentChecks, contentQualityPageSchema, contentQualitySearchText } from '@neuron/shared';
import type { ContentCheck, ContentQualityNote, ContentQualityPage } from '@neuron/shared';

import { duplicateCollection as inspectionCollection } from './collection-read';
import { collectionRead } from './collection-transport';
import { onNoteOutboxChange } from './note-outbox';
import { accountEpoch, offlineState, useOffline } from './offline';

const PREFIX = ['notes', 'content-quality'] as const;
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
type LocalView = {
  counts: ContentQualityPage['counts'];
  vocabularyCount: number;
  notes: { note: ContentQualityNote; checks: ContentCheck[] }[];
};
// Only the last filter of an existing in-memory projection. Nothing is persisted.
const views = new WeakMap<object, { key: string; version: number; value: Promise<LocalView> }>();

async function localView(deckId: string | undefined, search: string): Promise<LocalView> {
  if (!offlineState().available) throw new Error('collection_incomplete');
  const visit = accountEpoch();
  const accountId = offlineState().accountId;
  const collection = await inspectionCollection();
  const key = JSON.stringify([deckId, search]);
  let cached = views.get(collection);
  if (!cached || cached.key !== key || cached.version !== collection.browseVersion) {
    const value = (async () => {
      const counts: LocalView['counts'] = {
        'translation-without-example': 0,
        'example-without-translation': 0,
        'missing-example': 0,
        'missing-definition': 0,
      };
      const result: LocalView = { counts, vocabularyCount: 0, notes: [] };
      const byId = new Map(collection.decks.map((deck) => [deck.id, deck]));
      const paths = new Map<string, string[]>();
      for (const deck of collection.decks) {
        if (deck.kind !== 'deck') continue;
        const chain: string[] = [];
        const seen = new Set<string>();
        let current: (typeof collection.decks)[number] | undefined = deck;
        while (current && !seen.has(current.id) && seen.size <= 8) {
          if (current.id !== deck.id && current.kind !== 'folder') break;
          seen.add(current.id);
          chain.unshift(current.name);
          if (current.parentId === null) {
            paths.set(deck.id, chain);
            break;
          }
          current = byId.get(current.parentId);
        }
      }
      let started = performance.now();
      for (let at = 0; at < collection.notes.length; at++) {
        if (at > 0 && at % 64 === 0 && performance.now() - started >= 6) {
          await yieldToInput();
          started = performance.now();
        }
        const note = collection.notes[at]!;
        const deckPath = paths.get(note.deckId);
        if (note.noteType !== 'vocab' || !deckPath || (deckId && note.deckId !== deckId)) continue;
        if (
          search &&
          !contentQualitySearchText(note.fields, note.tags, note.source, deckPath).includes(
            search.toLowerCase(),
          )
        )
          continue;
        result.vocabularyCount++;
        const checks = contentChecks(note.noteType, note.fields);
        for (const check of checks) counts[check]++;
        if (checks.length)
          result.notes.push({
            note: {
              ...note,
              deckPath,
              ...(collection.unsent.has(note.id) ? { pending: true } : {}),
            },
            checks,
          });
      }
      result.notes.sort((a, b) => (a.note.id < b.note.id ? -1 : a.note.id > b.note.id ? 1 : 0));
      return result;
    })();
    cached = { key, version: collection.browseVersion, value };
    views.set(collection, cached);
  }
  const value = await cached.value;
  if (!offlineState().available) throw new Error('collection_incomplete');
  if (visit !== accountEpoch() || accountId !== offlineState().accountId)
    throw new DOMException('Collection read ended', 'AbortError');
  if (cached.version !== collection.browseVersion) return localView(deckId, search);
  return value;
}

export async function localContentQuality(
  deckId: string | undefined,
  search: string,
  category?: ContentCheck,
  cursor?: string,
): Promise<ContentQualityPage> {
  const view = await localView(deckId, search);
  const notes =
    category === undefined
      ? []
      : view.notes.filter(
          (entry) =>
            entry.checks.includes(category) && (cursor === undefined || entry.note.id > cursor),
        );
  return {
    counts: view.counts,
    vocabularyCount: view.vocabularyCount,
    items: notes.slice(0, 100).map((entry) => entry.note),
    local: true,
    ...(notes.length > 100 ? { nextCursor: notes[99]!.note.id } : {}),
  };
}

/** Authority and account visits own separate pages; an offline cursor never reaches the server. */
export function useContentQuality(
  deckId: string | undefined,
  search: string,
  category?: ContentCheck,
) {
  const offline = useOffline();
  const client = useQueryClient();
  const visit = accountEpoch();
  useEffect(
    () =>
      onNoteOutboxChange((change) => {
        if (change.accountId === offline.accountId && visit === accountEpoch())
          void client.invalidateQueries({ queryKey: PREFIX });
      }),
    [client, offline.accountId, visit],
  );
  return useInfiniteQuery({
    queryKey: [
      ...PREFIX,
      offline.accountId,
      visit,
      offline.offline,
      offline.offline ? offline.revision : null,
      deckId,
      search,
      category,
    ],
    enabled: !!offline.accountId && (!offline.offline || offline.available),
    networkMode: 'always',
    staleTime: 0,
    placeholderData: () => undefined,
    initialPageParam: undefined as string | undefined,
    gcTime: 30 * 60_000,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: '100' });
      if (deckId) params.set('deckId', deckId);
      if (search) params.set('search', search);
      if (category) params.set('category', category);
      if (pageParam) params.set('cursor', pageParam);
      return contentQualityPageSchema.parse(
        await collectionRead<ContentQualityPage>(`/notes/content-quality?${params}`, signal, () =>
          localContentQuality(deckId, search, category, pageParam),
        ),
      );
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

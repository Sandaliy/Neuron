import { noteCategoryPageSchema } from '@neuron/shared';
import type { NoteCategoryPage, NoteCategoryQuery } from '@neuron/shared';

import { localNoteCategories } from './collection-read';
import { collectionRead } from './collection-transport';
import { accountEpoch, offlineState } from './offline';

import type { QueryClient } from '@tanstack/react-query';

export type NoteCategory = { kind: 'tag' | 'source'; value: string };

export function noteCategoriesQuery(kind: NoteCategory['kind'], search: string) {
  const queryKey = ['notes', 'categories', offlineState().accountId, accountEpoch(), kind, search];
  return {
    queryKey,
    networkMode: 'always' as const,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({
      pageParam,
      signal,
      client,
    }: {
      pageParam: string | undefined;
      signal: AbortSignal;
      client: QueryClient;
    }): Promise<NoteCategoryPage & { local?: true }> => {
      const cursor = pageParam?.startsWith('server:') ? pageParam.slice(7) : pageParam;
      const query: NoteCategoryQuery = {
        kind,
        search,
        limit: 100,
        ...(pageParam?.startsWith('local:') ? { cursor: pageParam } : {}),
      };
      const local = () => localNoteCategories(query);
      if (pageParam?.startsWith('local:')) return local();
      const params = new URLSearchParams({
        kind,
        search,
        limit: '100',
        ...(cursor ? { cursor } : {}),
      });
      const page = await collectionRead<NoteCategoryPage & { local?: true }>(
        `/notes/categories?${params}`,
        signal,
        local,
        (value) =>
          client.setQueryData(
            queryKey,
            { pages: [value], pageParams: [undefined] },
            { updatedAt: 0 },
          ),
        () => pageParam === undefined && !client.getQueryData(queryKey),
      );
      return {
        ...noteCategoryPageSchema.parse(page),
        ...(page.local
          ? { local: true as const }
          : page.nextCursor
            ? { nextCursor: `server:${page.nextCursor}` }
            : {}),
      };
    },
    getNextPageParam: (page: NoteCategoryPage) => page.nextCursor,
  };
}

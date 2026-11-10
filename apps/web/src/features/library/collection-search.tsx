import { useQuery } from '@tanstack/react-query';
import { useNavigate, useRouter, useRouterState } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { DeckNode } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { describe } from '../../lib/api';
import { useBrowseState } from '../../lib/browse-state';
import {
  deckCreations,
  deckCreationsQueryKey,
  overlayDeckCreations,
} from '../../lib/deck-creation';
import { useDeckTree } from '../../lib/decks';
import { accountEpoch, useOffline } from '../../lib/offline';
import { Input } from '../../ui/input';
import { BackLink, PageHeader } from '../../ui/page-header';
import { EmptyState, ErrorState, SkeletonRows } from '../../ui/states';
import { useToast } from '../../ui/toast';

import { collectionTerm, indexCollections, searchCollections } from './collection-search-index';
import { CollectionSearchRows } from './collection-search-rows';
import { SearchScope } from './search-scope';

import type { CollectionMatch } from './collection-search-index';
import type { SearchReturn } from './collection-search-rows';

interface Browse {
  typed: string;
  returning?: SearchReturn | undefined;
}
const initial: Browse = { typed: '' };
const EMPTY: readonly DeckNode[] = [];

export function CollectionSearchScreen() {
  const t = useTranslate();
  const navigate = useNavigate();
  const router = useRouter();
  const toast = useToast();
  const offline = useOffline();
  const visit = accountEpoch();
  const key = useMemo(
    () => ['collection-search', offline.accountId, visit],
    [offline.accountId, visit],
  );
  const [browse, update] = useBrowseState(key, initial);
  const entry = useRouterState({ select: (state) => state.location.state.collectionSearchEntry });
  const decks = useDeckTree();
  const creations = useQuery({
    queryKey: deckCreationsQueryKey(offline.accountId),
    queryFn: () => deckCreations(offline.accountId!),
    enabled: !!offline.accountId,
    networkMode: 'always',
  });
  const unavailable = offline.offline && !offline.available;
  const tree = useMemo(
    () => overlayDeckCreations(decks.data ?? EMPTY, creations.data ?? [], offline.revision ?? 0),
    [decks.data, creations.data, offline.revision],
  );
  const index = useMemo(() => indexCollections(tree), [tree]);
  const [query, setQuery] = useState(() => collectionTerm(browse.typed));
  useEffect(() => {
    const timer = setTimeout(() => setQuery(collectionTerm(browse.typed)), 150);
    return () => clearTimeout(timer);
  }, [browse.typed]);
  const rows = useMemo(() => searchCollections(index, query), [index, query]);
  const busy = query !== collectionTerm(browse.typed);
  const loading = !unavailable && !decks.data && decks.isPending;
  const back = () =>
    entry?.accountId === offline.accountId && entry.visit === visit
      ? router.history.back()
      : void navigate({ to: '/library' });

  function open(row: CollectionMatch, returning: SearchReturn) {
    if (row.pending) {
      toast.show(t('offline.collection.dependencies'));
      return;
    }
    update({ returning });
    const state = { collectionSearchOrigin: { id: row.id, accountId: offline.accountId, visit } };
    void (row.kind === 'folder'
      ? navigate({ to: '/library', search: { folderId: row.id }, state })
      : navigate({ to: '/notes', search: { deckId: row.id }, state }));
  }

  return (
    <section data-screen="" className="flex flex-col gap-20">
      <PageHeader
        title={t('search.title')}
        back={<BackLink label={t('library.title')} onClick={back} />}
      />
      <SearchScope value="collections" />
      <div className="relative">
        <Search
          size={16}
          aria-hidden="true"
          className="pointer-events-none absolute top-16 left-12 z-10 text-secondary"
        />
        <Input
          type="search"
          className="pl-40"
          value={browse.typed}
          busy={busy || loading}
          aria-label={t('library.search.label')}
          placeholder={t('library.search.label')}
          maxLength={200}
          enterKeyHint="search"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => update({ typed: event.target.value, returning: undefined })}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              setQuery(collectionTerm(browse.typed));
              event.currentTarget.blur();
            }
          }}
        />
      </div>
      {unavailable ? (
        <p role="status" className="text-14 text-secondary">
          {t('offline.incomplete')}
        </p>
      ) : (
        <>
          {(decks.local || offline.offline) && (
            <p role="status" className="text-13 text-secondary">
              {t('offline.results')}
            </p>
          )}
          {loading ? (
            <SkeletonRows rows={5} />
          ) : decks.error && !decks.data ? (
            <ErrorState
              message={t(describe(decks.error).key, describe(decks.error).values)}
              retryLabel={t('common.retry')}
              onRetry={() => void decks.refetch()}
            />
          ) : (
            decks.data && (
              <>
                {decks.error && (
                  <ErrorState
                    message={t('library.search.stale')}
                    retryLabel={t('common.retry')}
                    onRetry={() => void decks.refetch()}
                  />
                )}
                {creations.error && (
                  <p role="status" className="text-13 text-secondary">
                    {t('library.search.pendingUnavailable')}
                  </p>
                )}
                <p role="status" aria-busy={busy} className="text-13 text-secondary">
                  {t('library.search.results', { count: rows.length, total: index.length })}
                </p>
                {rows.length ? (
                  <CollectionSearchRows
                    rows={rows}
                    resetKey={query}
                    returning={browse.returning}
                    onOpen={open}
                  />
                ) : (
                  <EmptyState
                    title={t(query ? 'library.search.emptyTitle' : 'library.emptyTitle')}
                    description={t(query ? 'library.search.emptyBody' : 'library.emptyBody')}
                  />
                )}
              </>
            )
          )}
        </>
      )}
    </section>
  );
}

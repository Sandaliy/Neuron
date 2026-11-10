import { useNavigate, useSearch } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { CARD_DIRECTIONS } from '@neuron/core';
import type { CardDirection } from '@neuron/core';
import type { ProblemCardSort, ProblemCardStateFilter } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { describe } from '../../lib/api';
import { useBrowseState } from '../../lib/browse-state';
import { hasServerAuthority, useCapabilities } from '../../lib/capabilities';
import { flatten, useDeckTree } from '../../lib/decks';
import { accountEpoch, useOffline } from '../../lib/offline';
import { useCardSuspension, useProblemCards } from '../../lib/problem-cards';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { PageHeader } from '../../ui/page-header';
import { Select } from '../../ui/select';
import { EmptyState, ErrorState, SkeletonRows } from '../../ui/states';
import { useToast } from '../../ui/toast';
import { CheckBack } from '../library/library-checks';
import { ScopeSelect } from '../library/scope-select';

import { ProblemCardRows } from './problem-card-rows';

import type { ProblemReturn } from './problem-card-rows';

interface Browse {
  typed: string;
  direction: CardDirection | undefined;
  state: ProblemCardStateFilter;
  sort: ProblemCardSort;
  filtersOpen: boolean;
  returning: ProblemReturn | undefined;
}
const initial: Browse = {
  typed: '',
  direction: undefined,
  state: 'all',
  sort: 'again',
  filtersOpen: false,
  returning: undefined,
};

export function ProblemCardsScreen() {
  const { deckId } = useSearch({ from: '/app/library/slipping' });
  const offline = useOffline();
  return (
    <ProblemCardsBrowser
      key={`${offline.accountId}:${accountEpoch()}:${deckId ?? ''}`}
      deckId={deckId}
    />
  );
}

function ProblemCardsBrowser({ deckId }: { readonly deckId: string | undefined }) {
  const t = useTranslate();
  const navigate = useNavigate();
  const toast = useToast();
  const offline = useOffline();
  const capabilities = useCapabilities();
  const visit = accountEpoch();
  const browseKey = useMemo(
    () => ['problem-browse', offline.accountId, visit, deckId],
    [offline.accountId, visit, deckId],
  );
  const [browse, update] = useBrowseState(browseKey, initial);
  const [search, setSearch] = useState(browse.typed.trim());
  useEffect(() => {
    const timer = setTimeout(() => setSearch(browse.typed.trim()), 250);
    return () => clearTimeout(timer);
  }, [browse.typed]);
  const filters = useMemo(
    () => ({ deckId, direction: browse.direction, state: browse.state, sort: browse.sort, search }),
    [deckId, browse.direction, browse.state, browse.sort, search],
  );
  const query = useProblemCards(filters);
  const suspension = useCardSuspension();
  const tree = useDeckTree();
  const scopes = useMemo(() => {
    const all = flatten(tree.data ?? []);
    const names = new Map(all.map((deck) => [deck.id, deck.name]));
    return all
      .filter((deck) => deck.rev > 0)
      .map((deck) => ({
        id: deck.id,
        label: [...deck.path.map((id) => names.get(id)), deck.name].filter(Boolean).join(' / '),
      }));
  }, [tree.data]);
  const unavailable = offline.offline && !offline.available;
  const rows = useMemo(() => {
    if (unavailable) return [];
    // Refetches can move page boundaries. Never render a Card twice.
    const seen = new Set<string>();
    return (query.data?.pages.flatMap((page) => page.items) ?? []).filter((row) => {
      if (seen.has(row.card.id)) return false;
      seen.add(row.card.id);
      return true;
    });
  }, [unavailable, query.data]);
  const local = offline.offline || !!query.data?.pages.some((page) => page.local);
  const total = query.data?.pages.at(-1)?.total;
  const canAct = capabilities.server && !local;
  const filter = (patch: Partial<Browse>) => {
    update({ ...patch, returning: undefined });
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  return (
    <section data-screen="" className="flex min-w-0 flex-col gap-16">
      <PageHeader title={t('problems.title')} back={<CheckBack deckId={deckId} />} />
      <ScopeSelect
        label={t('problems.scope')}
        value={deckId ?? ''}
        onChange={(event) =>
          void navigate({
            to: '/library/slipping',
            search: event.target.value ? { deckId: event.target.value } : {},
          })
        }
      >
        <option value="">{t('problems.library')}</option>
        {scopes.map((scope) => (
          <option key={scope.id} value={scope.id}>
            {scope.label}
          </option>
        ))}
      </ScopeSelect>
      <div className="flex min-w-0 items-start gap-8">
        <div className="relative min-w-0 flex-1">
          <Search
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute top-16 left-12 z-10 text-secondary"
          />
          <Input
            type="search"
            className="pl-40"
            aria-label={t('problems.search')}
            placeholder={t('problems.search')}
            value={browse.typed}
            maxLength={100}
            enterKeyHint="search"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            busy={query.isFetching || search !== browse.typed.trim()}
            onChange={(event) => update({ typed: event.target.value, returning: undefined })}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                setSearch(browse.typed.trim());
                event.currentTarget.blur();
              }
            }}
          />
        </div>
        <Button
          variant="quiet"
          aria-expanded={browse.filtersOpen}
          onClick={() => update({ filtersOpen: !browse.filtersOpen })}
        >
          {t('notes.filters')}
          {browse.direction !== undefined ||
          browse.state !== initial.state ||
          browse.sort !== initial.sort
            ? ' ·'
            : ''}
        </Button>
      </div>
      {browse.filtersOpen && (
        <div className="grid min-w-0 grid-cols-1 gap-8 sm:grid-cols-3">
          <Select
            aria-label={t('problems.direction')}
            value={browse.direction ?? ''}
            onChange={(event) =>
              filter({ direction: (event.target.value || undefined) as CardDirection | undefined })
            }
          >
            <option value="">{t('problems.direction.all')}</option>
            {CARD_DIRECTIONS.map((direction) => (
              <option key={direction} value={direction}>
                {t(`card.direction.${direction}`)}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t('problems.state')}
            value={browse.state}
            onChange={(event) => filter({ state: event.target.value as ProblemCardStateFilter })}
          >
            <option value="all">{t('problems.state.all')}</option>
            <option value="studying">{t('problems.state.studying')}</option>
            <option value="suspended">{t('problems.state.suspended')}</option>
          </Select>
          <Select
            aria-label={t('problems.sort')}
            value={browse.sort}
            onChange={(event) => filter({ sort: event.target.value as ProblemCardSort })}
          >
            <option value="again">{t('problems.sort.again')}</option>
            <option value="recent">{t('problems.sort.recent')}</option>
          </Select>
        </div>
      )}
      <div role="status" className="flex flex-col gap-4 text-13 text-secondary">
        {(unavailable || local) && (
          <p>{t(unavailable ? 'offline.incomplete' : 'problems.downloaded')}</p>
        )}
        {!unavailable && total !== undefined && <p>{t('problems.count', { count: total })}</p>}
      </div>
      {!unavailable && (
        <>
          {query.error && (
            <ErrorState
              message={t(describe(query.error).key, describe(query.error).values)}
              retryLabel={t('common.retry')}
              onRetry={() => void query.refetch()}
            />
          )}
          {query.isPending ? (
            <SkeletonRows rows={4} />
          ) : rows.length ? (
            <ProblemCardRows
              key={`${search}:${browse.direction}:${browse.state}:${browse.sort}:${local}`}
              rows={rows}
              returning={browse.returning}
              canAct={canAct}
              pending={suspension.isPending ? suspension.variables?.id : undefined}
              onEdit={(row, position) => {
                update({ returning: position });
                void navigate({
                  to: '/notes/$noteId',
                  params: { noteId: row.note.id },
                  state: { problemOrigin: { accountId: offline.accountId, visit } },
                });
              }}
              onSuspend={(row) => {
                // Recheck at the press: a connection lost since render never acts locally.
                if (!hasServerAuthority() || local || suspension.isPending) return;
                const suspend = !row.card.suspendedAt;
                suspension.mutate(
                  { id: row.card.id, suspend },
                  {
                    onSuccess: () =>
                      toast.show(t(suspend ? 'problems.suspended' : 'problems.resumed')),
                    onError: (error) => toast.show(t(describe(error).key, describe(error).values)),
                  },
                );
              }}
            />
          ) : (
            !query.error && (
              <EmptyState title={t('problems.empty')} description={t('problems.emptyHint')} />
            )
          )}
          {query.hasNextPage && (
            <Button
              variant="quiet"
              disabled={query.isFetching}
              onClick={() => void query.fetchNextPage({ cancelRefetch: false })}
            >
              {t('problems.more')}
            </Button>
          )}
        </>
      )}
    </section>
  );
}

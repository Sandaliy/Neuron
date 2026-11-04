import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { ChevronLeft, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { useTranslate } from '../../i18n/locale';
import { describe } from '../../lib/api';
import { flatten, useDeckTree } from '../../lib/decks';
import { accountEpoch, useOffline } from '../../lib/offline';
import { usePossibleDuplicates } from '../../lib/possible-duplicates';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Select } from '../../ui/select';
import { EmptyState, ErrorState, SkeletonRows } from '../../ui/states';

import { DuplicateRows } from './duplicate-rows';

import type { DuplicateReturn } from './duplicate-rows';

interface Browse {
  typed: string;
  group: string | undefined;
  groupsReturn: DuplicateReturn | undefined;
  notesReturn: DuplicateReturn | undefined;
}
const initial: Browse = {
  typed: '',
  group: undefined,
  groupsReturn: undefined,
  notesReturn: undefined,
};

export function PossibleDuplicatesScreen() {
  const { deckId } = useSearch({ from: '/app/library/duplicates' });
  const offline = useOffline();
  return (
    <DuplicateBrowser
      key={`${offline.accountId}:${accountEpoch()}:${deckId ?? ''}`}
      deckId={deckId}
    />
  );
}

function DuplicateBrowser({ deckId }: { readonly deckId: string | undefined }) {
  const t = useTranslate();
  const navigate = useNavigate();
  const offline = useOffline();
  const visit = accountEpoch();
  const client = useQueryClient();
  const browseKey = useMemo(
    () => ['duplicate-browse', offline.accountId, visit, deckId],
    [offline.accountId, visit, deckId],
  );
  const browse = useQuery({
    queryKey: browseKey,
    queryFn: () => initial,
    initialData: initial,
    enabled: false,
    staleTime: Infinity,
    gcTime: Infinity,
  }).data;
  const update = (patch: Partial<Browse>) =>
    client.setQueryData<Browse>(browseKey, (current) => ({ ...initial, ...current, ...patch }));
  const [search, setSearch] = useState(browse.typed.trim());
  useEffect(() => {
    const timer = setTimeout(() => setSearch(browse.typed.trim()), 250);
    return () => clearTimeout(timer);
  }, [browse.typed]);
  const { groups, notes } = usePossibleDuplicates(deckId, search, browse.group);
  const query = browse.group === undefined ? groups : notes;
  const tree = useDeckTree();
  const decks = useMemo(() => {
    const all = flatten(tree.data ?? []);
    const names = new Map(all.map((deck) => [deck.id, deck.name]));
    return all
      .filter((deck) => deck.kind === 'deck' && deck.rev > 0)
      .map((deck) => ({
        id: deck.id,
        label: [...deck.path.map((id) => names.get(id)), deck.name].filter(Boolean).join(' / '),
      }));
  }, [tree.data]);
  const unavailable = offline.offline && !offline.available;
  const rows = useMemo(() => {
    if (unavailable) return [];
    // Refetches and live edits can move page boundaries. Never render an identity twice.
    const seen = new Set<string>();
    const items =
      browse.group === undefined
        ? groups.data?.pages.flatMap((page) => page.items)
        : notes.data?.pages.flatMap((page) => page.items);
    return (items ?? []).filter((row) => {
      const id = 'key' in row ? row.key : row.id;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [unavailable, browse.group, groups.data, notes.data]);
  const local = offline.offline || query.data?.pages.some((page) => page.local);
  const back = () => {
    if (browse.group !== undefined) update({ group: undefined, notesReturn: undefined });
    else
      void navigate({
        to: deckId ? '/notes' : '/library',
        ...(deckId ? { search: { deckId } } : {}),
      });
  };
  return (
    <section data-screen="" className="flex min-w-0 flex-col gap-16">
      <header className="flex min-w-0 flex-col gap-4">
        <Button variant="text" className="self-start" onClick={back}>
          <ChevronLeft size={20} aria-hidden="true" />
          {t(
            browse.group !== undefined
              ? 'duplicates.groups'
              : deckId
                ? 'notes.title'
                : 'library.title',
          )}
        </Button>
        <h1 className="font-display text-24 tracking-tight text-primary">
          {t('duplicates.title')}
        </h1>
        <p className="text-14 text-secondary">{t('duplicates.hint')}</p>
      </header>
      <Select
        aria-label={t('duplicates.scope')}
        value={deckId ?? ''}
        onChange={(event) =>
          void navigate({
            to: '/library/duplicates',
            search: event.target.value ? { deckId: event.target.value } : {},
          })
        }
      >
        <option value="">{t('duplicates.library')}</option>
        {decks.map((deck) => (
          <option key={deck.id} value={deck.id}>
            {deck.label}
          </option>
        ))}
      </Select>
      {browse.group === undefined ? (
        <div className="relative">
          <Search
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute top-16 left-12 z-10 text-secondary"
          />
          <Input
            type="search"
            className="pl-40"
            aria-label={t('duplicates.search')}
            placeholder={t('duplicates.search')}
            value={browse.typed}
            maxLength={100}
            enterKeyHint="search"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            busy={query.isFetching || search !== browse.typed.trim()}
            onChange={(event) => update({ typed: event.target.value, groupsReturn: undefined })}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                setSearch(browse.typed.trim());
                event.currentTarget.blur();
              }
            }}
          />
        </div>
      ) : (
        <h2 className="whitespace-pre-wrap break-words font-display text-20 text-primary [overflow-wrap:anywhere]">
          {browse.group}
        </h2>
      )}
      <p role="status" className="text-13 text-secondary">
        {t(
          unavailable
            ? 'offline.incomplete'
            : local
              ? 'duplicates.downloaded'
              : 'duplicates.online',
        )}
      </p>
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
            <SkeletonRows rows={5} />
          ) : rows.length ? (
            <DuplicateRows
              key={`${browse.group ?? 'groups'}:${search}:${local}`}
              rows={rows}
              returning={browse.group === undefined ? browse.groupsReturn : browse.notesReturn}
              onOpen={(row, position) => {
                if ('key' in row) {
                  update({ group: row.key, groupsReturn: position, notesReturn: undefined });
                  window.scrollTo({ top: 0, behavior: 'instant' });
                } else {
                  update({ notesReturn: position });
                  void navigate({
                    to: '/notes/$noteId',
                    params: { noteId: row.id },
                    state: { duplicateOrigin: { accountId: offline.accountId, visit } },
                  });
                }
              }}
            />
          ) : (
            !query.error && (
              <EmptyState title={t('duplicates.empty')} description={t('duplicates.emptyHint')} />
            )
          )}
          {query.hasNextPage && (
            <Button
              variant="quiet"
              disabled={query.isFetching}
              onClick={() => void query.fetchNextPage({ cancelRefetch: false })}
            >
              {t('duplicates.more')}
            </Button>
          )}
        </>
      )}
    </section>
  );
}

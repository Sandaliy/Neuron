import { useInfiniteQuery } from '@tanstack/react-query';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { defaultRangeExtractor, useWindowVirtualizer } from '@tanstack/react-virtual';
import { ChevronLeft, Search } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { useTranslate } from '../../i18n/locale';
import { describe } from '../../lib/api';
import { useBrowseState } from '../../lib/browse-state';
import { noteCategoriesQuery } from '../../lib/note-categories';
import { accountEpoch, useOffline } from '../../lib/offline';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Row, RowChevron } from '../../ui/row';
import { Segmented } from '../../ui/segmented';
import { EmptyState, ErrorState, SkeletonRows } from '../../ui/states';

import type { NoteCategory } from '../../lib/note-categories';
import type { VirtualItem } from '@tanstack/react-virtual';

interface Browse {
  kind: NoteCategory['kind'];
  typed: string;
  returning?: { value?: string | undefined; measurements: VirtualItem[] } | undefined;
}
const initial: Browse = { kind: 'tag', typed: '' };

export function NoteCategoriesScreen() {
  const t = useTranslate();
  const offline = useOffline();
  const navigate = useNavigate();
  const key = ['note-category-browse', offline.accountId, accountEpoch()];
  const [browse, update] = useBrowseState(key, initial);
  const [search, setSearch] = useState(browse.typed.trim());
  useEffect(() => {
    const timer = setTimeout(() => setSearch(browse.typed.trim()), 200);
    return () => clearTimeout(timer);
  }, [browse.typed]);
  const categories = useInfiniteQuery({
    ...noteCategoriesQuery(browse.kind, search),
    placeholderData: () => undefined,
    gcTime: 30 * 60_000,
  });
  const unavailable = offline.offline && !offline.available;
  const rows = useMemo(
    () => categories.data?.pages.flatMap((page) => page.items) ?? [],
    [categories.data],
  );
  const total = categories.data?.pages[0]?.total ?? 0;
  const local = categories.data?.pages.some((page) => page.local);
  const busy = search !== browse.typed.trim();
  return (
    <section data-screen="" className="flex flex-col gap-16">
      <header className="flex min-w-0 flex-col gap-4">
        <Button
          variant="text"
          className="self-start"
          onClick={() => void navigate({ to: '/library' })}
        >
          <ChevronLeft size={20} strokeWidth={1.5} aria-hidden="true" />
          {t('library.title')}
        </Button>
        <h1 className="font-display text-24 tracking-tight text-primary">
          {t('categories.title')}
        </h1>
        <p className="text-14 text-secondary">{t('categories.hint')}</p>
      </header>
      <Segmented
        value={browse.kind}
        label={t('categories.title')}
        options={[
          { value: 'tag', label: t('categories.tags') },
          { value: 'source', label: t('categories.sources') },
        ]}
        onChange={(kind) => update({ kind, returning: undefined })}
      />
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
          busy={busy || categories.isFetching}
          aria-label={t('categories.search')}
          placeholder={t('categories.search')}
          maxLength={100}
          enterKeyHint="search"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => update({ typed: event.target.value, returning: undefined })}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              setSearch(browse.typed.trim());
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
          <p role="status" className="text-13 text-secondary">
            {t(local ? 'categories.downloaded' : 'categories.online')}
          </p>
          {categories.error && (
            <ErrorState
              message={t(describe(categories.error).key, describe(categories.error).values)}
              retryLabel={t('common.retry')}
              onRetry={() => void categories.refetch()}
            />
          )}
          {categories.isPending ? (
            <SkeletonRows rows={5} />
          ) : (
            categories.data && (
              <>
                <p
                  role="status"
                  aria-busy={busy || categories.isFetching}
                  className="text-13 text-secondary"
                >
                  {t('categories.results', { count: rows.length, total })}
                </p>
                {rows.length ? (
                  <CategoryRows
                    key={`${browse.kind}:${search}`}
                    rows={rows}
                    returning={browse.returning}
                    onOpen={(value, returning) => {
                      update({ returning });
                      void navigate({
                        to: '/notes',
                        search: { [browse.kind]: value },
                        state: {
                          noteCategoryOrigin: {
                            accountId: offline.accountId,
                            visit: accountEpoch(),
                          },
                        },
                      });
                    }}
                  />
                ) : (
                  <EmptyState
                    title={t(search ? 'categories.noMatches' : 'categories.empty')}
                    description={t(search ? 'categories.trySearch' : 'categories.emptyHint')}
                  />
                )}
                {categories.hasNextPage && (
                  <Button
                    variant="quiet"
                    disabled={categories.isFetchingNextPage}
                    onClick={() => void categories.fetchNextPage()}
                  >
                    {t('categories.more')}
                  </Button>
                )}
              </>
            )
          )}
        </>
      )}
    </section>
  );
}

function CategoryRows({
  rows,
  returning,
  onOpen,
}: {
  readonly rows: readonly { value: string; count: number }[];
  readonly returning: Browse['returning'];
  readonly onOpen: (value: string, returning: NonNullable<Browse['returning']>) => void;
}) {
  const t = useTranslate();
  const list = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [focused, setFocused] = useState(returning?.value);
  const restored = useRef(false);
  const focusedIndex = rows.findIndex((row) => row.value === focused);
  const virtual = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => 80,
    overscan: 5,
    scrollMargin: offset,
    getItemKey: (index) => rows[index]!.value,
    initialMeasurementsCache: returning?.measurements ?? [],
    rangeExtractor: (range) => {
      const indices = new Set(defaultRangeExtractor(range));
      if (focusedIndex >= 0)
        for (
          let i = Math.max(0, focusedIndex - 1);
          i <= Math.min(rows.length - 1, focusedIndex + 1);
          i++
        )
          indices.add(i);
      return [...indices].sort((a, b) => a - b);
    },
  });
  useLayoutEffect(() => {
    const measure = () =>
      setOffset(list.current ? list.current.getBoundingClientRect().top + window.scrollY : 0);
    measure();
    const observer = new ResizeObserver(measure);
    if (list.current?.parentElement) observer.observe(list.current.parentElement);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (restored.current || !returning?.value) return;
    const row = [
      ...(list.current?.querySelectorAll<HTMLElement>('[data-category-value]') ?? []),
    ].find((node) => node.dataset['categoryValue'] === returning.value);
    if (row) {
      row.querySelector('button')?.focus({ preventScroll: true });
      restored.current = true;
    }
  });
  return (
    <div
      ref={list}
      role="list"
      aria-label={t('categories.title')}
      className="relative min-w-0"
      style={{ height: virtual.getTotalSize() }}
    >
      {virtual.getVirtualItems().map((item) => {
        const row = rows[item.index]!;
        return (
          <div
            key={row.value}
            role="listitem"
            aria-posinset={item.index + 1}
            aria-setsize={rows.length}
            data-index={item.index}
            data-category-value={row.value}
            ref={virtual.measureElement}
            onFocusCapture={() => setFocused(row.value)}
            className="absolute top-0 left-0 w-full pb-8"
            style={{ transform: `translateY(${item.start - offset}px)` }}
          >
            <Row
              standalone={false}
              title={
                <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                  {row.value}
                </span>
              }
              subtitle={t('categories.notes', { count: row.count })}
              trailing={<RowChevron />}
              onClick={() =>
                onOpen(row.value, {
                  value: document.activeElement?.matches(':focus-visible') ? row.value : undefined,
                  measurements: virtual.takeSnapshot(),
                })
              }
            />
          </div>
        );
      })}
    </div>
  );
}

export function NoteCategoryBack() {
  const t = useTranslate();
  const router = useRouter();
  return (
    <Button variant="text" className="self-start" onClick={() => router.history.back()}>
      <ChevronLeft size={20} strokeWidth={1.5} aria-hidden="true" />
      {t('categories.title')}
    </Button>
  );
}

declare module '@tanstack/react-router' {
  interface HistoryState {
    noteCategoryOrigin?: { accountId: string | null; visit: number };
  }
}

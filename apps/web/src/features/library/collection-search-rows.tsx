import { defaultRangeExtractor, useWindowVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { useTranslate } from '../../i18n/locale';
import { CollectionIcon, collectionSurface } from '../../ui/collection';
import { Row, RowChevron } from '../../ui/row';

import type { CollectionMatch } from './collection-search-index';
import type { VirtualItem } from '@tanstack/react-virtual';

export interface SearchReturn {
  readonly focusId?: string | undefined;
  readonly measurements: VirtualItem[];
}

/** Measured paths wrap fully; only the visible rows and keyboard neighbours mount. */
export function CollectionSearchRows({
  rows,
  resetKey,
  returning,
  onOpen,
}: {
  readonly rows: readonly CollectionMatch[];
  readonly resetKey: string;
  readonly returning: SearchReturn | undefined;
  readonly onOpen: (row: CollectionMatch, returning: SearchReturn) => void;
}) {
  const t = useTranslate();
  const list = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [focused, setFocused] = useState(returning?.focusId);
  const restored = useRef(false);
  const focusedIndex = useMemo(() => rows.findIndex((row) => row.id === focused), [rows, focused]);
  const previousKey = useRef(resetKey);
  const getItemKey = useCallback((index: number) => rows[index]!.id, [rows]);
  const virtual = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => 100,
    overscan: 5,
    scrollMargin: offset,
    getItemKey,
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
    if (previousKey.current === resetKey) return;
    const top = list.current ? list.current.getBoundingClientRect().top + window.scrollY : 0;
    if (window.scrollY > top) window.scrollTo({ top, behavior: 'instant' });
    previousKey.current = resetKey;
  }, [resetKey]);
  useLayoutEffect(() => {
    if (restored.current || !returning?.focusId) return;
    const row = [...(list.current?.querySelectorAll<HTMLElement>('[data-search-id]') ?? [])].find(
      (node) => node.dataset['searchId'] === returning.focusId,
    );
    if (row) {
      row.querySelector('button')?.focus({ preventScroll: true });
      restored.current = true;
    }
  });
  return (
    <div
      ref={list}
      role="list"
      aria-label={t('search.collections')}
      className="relative min-w-0"
      style={{ height: virtual.getTotalSize() }}
    >
      {virtual.getVirtualItems().map((item) => {
        const row = rows[item.index]!;
        return (
          <div
            key={row.id}
            role="listitem"
            aria-posinset={item.index + 1}
            aria-setsize={rows.length}
            data-index={item.index}
            data-search-id={row.id}
            ref={virtual.measureElement}
            onFocusCapture={() => setFocused(row.id)}
            className="absolute top-0 left-0 w-full pb-8"
            style={{ transform: `translateY(${item.start - offset}px)` }}
          >
            <Row
              standalone={false}
              className={`${collectionSurface(row.kind)} min-h-72`}
              leading={<CollectionIcon kind={row.kind} />}
              trailing={row.pending ? undefined : <RowChevron />}
              title={<span className="break-words [overflow-wrap:anywhere]">{row.name}</span>}
              subtitle={
                <span className="flex flex-col gap-4 break-words [overflow-wrap:anywhere]">
                  <span>
                    {t(row.kind === 'folder' ? 'library.folder' : 'library.deck')} ·{' '}
                    {t('library.title')}
                    {row.location && ` / ${row.location}`}
                  </span>
                  {row.pending && <span>{t('offline.collection.local')}</span>}
                </span>
              }
              onClick={() =>
                onOpen(row, {
                  focusId: document.activeElement?.matches(':focus-visible') ? row.id : undefined,
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

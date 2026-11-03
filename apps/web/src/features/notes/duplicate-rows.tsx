import { defaultRangeExtractor, useWindowVirtualizer } from '@tanstack/react-virtual';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import { termOf } from '@neuron/shared';
import type { PossibleDuplicateGroup, PossibleDuplicateNote } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { Row, RowChevron } from '../../ui/row';

import type { VirtualItem } from '@tanstack/react-virtual';

export interface DuplicateReturn {
  top: number;
  margin: number;
  focusId: string | undefined;
  measurements: VirtualItem[];
}
type DuplicateRow = PossibleDuplicateGroup | PossibleDuplicateNote;
const rowId = (row: DuplicateRow) => ('key' in row ? row.key : row.id);

/** A measured inspection list. No swipe, selection, status or cleanup actions. */
export function DuplicateRows({
  rows,
  returning,
  onOpen,
}: {
  readonly rows: readonly DuplicateRow[];
  readonly returning: DuplicateReturn | undefined;
  readonly onOpen: (row: DuplicateRow, position: DuplicateReturn) => void;
}) {
  const t = useTranslate();
  const list = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(returning?.margin ?? 0);
  const [focused, setFocused] = useState(returning?.focusId);
  const restored = useRef(false);
  const focusedIndex = useMemo(
    () => rows.findIndex((row) => rowId(row) === focused),
    [rows, focused],
  );
  const virtual = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => ('key' in rows[0]! ? 76 : 150),
    overscan: 5,
    scrollMargin: offset,
    getItemKey: (index) => rowId(rows[index]!),
    initialMeasurementsCache: returning?.measurements ?? [],
    initialOffset: returning?.top ?? 0,
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
    if (restored.current || !returning) return;
    window.scrollTo({ top: returning.top, behavior: 'instant' });
    const row = [
      ...(list.current?.querySelectorAll<HTMLElement>('[data-duplicate-id]') ?? []),
    ].find((node) => node.dataset['duplicateId'] === returning.focusId);
    if (returning.focusId && !row) return;
    row?.querySelector('button')?.focus({ preventScroll: true });
    restored.current = true;
  });
  return (
    <div
      ref={list}
      role="list"
      aria-label={t('duplicates.title')}
      data-duplicate-rows=""
      className="relative min-w-0"
      style={{ height: virtual.getTotalSize() }}
    >
      {virtual.getVirtualItems().map((item) => {
        const row = rows[item.index]!;
        const id = rowId(row);
        const group = 'key' in row;
        return (
          <div
            key={id}
            role="listitem"
            aria-posinset={item.index + 1}
            aria-setsize={rows.length}
            data-index={item.index}
            data-duplicate-id={id}
            ref={virtual.measureElement}
            onFocusCapture={() => setFocused(id)}
            className="absolute top-0 left-0 w-full pb-8"
            style={{ transform: `translateY(${item.start - offset}px)` }}
          >
            <Row
              className="min-h-72"
              trailing={<RowChevron />}
              title={
                <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                  {group ? row.key : termOf(row.fields)}
                </span>
              }
              subtitle={
                group ? (
                  t('duplicates.count', { count: row.count })
                ) : (
                  <span className="flex flex-col gap-4 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                    <span>
                      {String(
                        row.fields['translation'] ?? row.fields['back'] ?? row.fields['note'] ?? '',
                      )}
                    </span>
                    <span>
                      {t(`note.type.${row.noteType}`)} · {row.source || t('duplicates.noSource')}
                    </span>
                    <span>{row.deckPath.join(' / ')}</span>
                    {row.pending && <span>{t('offline.collection.local')}</span>}
                  </span>
                )
              }
              onClick={() =>
                onOpen(row, {
                  top: window.scrollY,
                  margin: offset,
                  focusId: document.activeElement?.matches(':focus-visible') ? id : undefined,
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

import { defaultRangeExtractor, useWindowVirtualizer } from '@tanstack/react-virtual';
import { useLayoutEffect, useRef, useState } from 'react';

import { termOf } from '@neuron/shared';
import type { ContentQualityNote } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { Row, RowChevron } from '../../ui/row';

import type { VirtualItem } from '@tanstack/react-virtual';

export interface QualityReturn {
  top: number;
  margin: number;
  focusId: string | undefined;
  index: number;
  measurements: VirtualItem[];
}

/** Measured read-only rows keep normal page scrolling and native button keyboard behavior. */
export function QualityRows({
  rows,
  returning,
  onOpen,
}: {
  readonly rows: readonly ContentQualityNote[];
  readonly returning: QualityReturn | undefined;
  readonly onOpen: (row: ContentQualityNote, position: QualityReturn) => void;
}) {
  const t = useTranslate();
  const list = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(returning?.margin ?? 0);
  const [focused, setFocused] = useState(returning?.focusId);
  const restored = useRef(false);
  const restoredFocus = useRef<string | undefined>(undefined);
  const found = rows.findIndex((row) => row.id === focused);
  // A corrected Note can leave this category. Keep keyboard focus on its next neighbour.
  const focusIndex =
    found >= 0 ? found : focused ? Math.min(returning?.index ?? 0, rows.length - 1) : -1;
  const virtual = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => 210,
    overscan: 5,
    scrollMargin: offset,
    getItemKey: (index) => rows[index]!.id,
    initialMeasurementsCache: returning?.measurements ?? [],
    initialOffset: returning?.top ?? 0,
    rangeExtractor: (range) => {
      const indices = new Set(defaultRangeExtractor(range));
      if (focusIndex >= 0)
        for (
          let i = Math.max(0, focusIndex - 1);
          i <= Math.min(rows.length - 1, focusIndex + 1);
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
    if (!returning) return;
    if (!restored.current) {
      window.scrollTo({ top: returning.top, behavior: 'instant' });
      restored.current = true;
    }
    const id = rows[focusIndex]?.id;
    if (!id || restoredFocus.current === id) return;
    const row = [...(list.current?.querySelectorAll<HTMLElement>('[data-quality-id]') ?? [])].find(
      (node) => node.dataset['qualityId'] === id,
    );
    if (row) {
      row.querySelector('button')?.focus({ preventScroll: true });
      restoredFocus.current = id;
    }
  });
  return (
    <div
      ref={list}
      role="list"
      aria-label={t('quality.notes')}
      data-quality-rows=""
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
            data-quality-id={row.id}
            ref={virtual.measureElement}
            onFocusCapture={() => setFocused(row.id)}
            className="absolute top-0 left-0 w-full pb-8"
            style={{ transform: `translateY(${item.start - offset}px)` }}
          >
            <Row
              className="min-h-72"
              trailing={<RowChevron />}
              title={
                <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                  {termOf(row.fields)}
                </span>
              }
              subtitle={
                <span className="flex flex-col gap-4 whitespace-pre-wrap break-words text-14 [overflow-wrap:anywhere]">
                  <span>{String(row.fields['translation'] ?? '')}</span>
                  {(['example', 'exampleTranslation', 'definition'] as const).map((field) =>
                    typeof row.fields[field] === 'string' && row.fields[field].trim() ? (
                      <span key={field} className="line-clamp-3">
                        {t(`note.field.${field}`)}: {row.fields[field]}
                      </span>
                    ) : null,
                  )}
                  <span className="text-13">
                    {t(`note.type.${row.noteType}`)} · {row.deckPath.join(' / ')}
                  </span>
                  {row.pending && <span className="text-13">{t('offline.collection.local')}</span>}
                </span>
              }
              onClick={() =>
                onOpen(row, {
                  top: window.scrollY,
                  margin: offset,
                  focusId: document.activeElement?.matches(':focus-visible') ? row.id : undefined,
                  index: item.index,
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

import { defaultRangeExtractor, useWindowVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { ReactNode } from 'react';

/** The Deleted lists share the existing window virtualizer, with measured recovery rows. */
export function DeletedRows<T extends { readonly id: string }>({
  rows,
  children,
  resetKey,
}: {
  readonly rows: readonly T[];
  readonly children: (row: T) => ReactNode;
  readonly resetKey: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [focused, setFocused] = useState<string>();
  const windowed = rows.length > 80;
  const focusedIndex = useMemo(
    () => (focused ? rows.findIndex((row) => row.id === focused) : -1),
    [rows, focused],
  );
  const previousKey = useRef(resetKey);
  const getItemKey = useCallback((index: number) => rows[index]!.id, [rows]);
  const virtual = useWindowVirtualizer({
    count: rows.length,
    enabled: windowed,
    estimateSize: () => 180,
    overscan: 5,
    scrollMargin: offset,
    getItemKey,
    // Keep the focused row (including its dialog) and its neighbours mounted.
    // Tab can then move beyond the current window in either direction.
    rangeExtractor: (range) => {
      const indices = new Set(defaultRangeExtractor(range));
      if (focusedIndex >= 0) {
        for (
          let i = Math.max(0, focusedIndex - 1);
          i <= Math.min(rows.length - 1, focusedIndex + 1);
          i++
        )
          indices.add(i);
      }
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
  }, [windowed]);

  useLayoutEffect(() => {
    if (previousKey.current !== resetKey) {
      const top = list.current ? list.current.getBoundingClientRect().top + window.scrollY : 0;
      if (window.scrollY > top) window.scrollTo({ top, behavior: 'instant' });
      previousKey.current = resetKey;
    }
  }, [resetKey]);

  const items = windowed
    ? virtual.getVirtualItems().map((item) => ({ index: item.index, start: item.start }))
    : rows.map((_, index) => ({ index, start: 0 }));
  return (
    <div
      ref={list}
      role="list"
      className="relative min-w-0"
      style={windowed ? { height: virtual.getTotalSize() } : undefined}
    >
      {items.map((item) => {
        const row = rows[item.index]!;
        return (
          <div
            key={row.id}
            role="listitem"
            aria-posinset={item.index + 1}
            aria-setsize={rows.length}
            data-index={item.index}
            ref={windowed ? virtual.measureElement : undefined}
            onFocusCapture={() => setFocused(row.id)}
            className={windowed ? 'absolute top-0 left-0 w-full pb-8' : 'pb-8'}
            style={windowed ? { transform: `translateY(${item.start - offset}px)` } : undefined}
          >
            {children(row)}
          </div>
        );
      })}
    </div>
  );
}

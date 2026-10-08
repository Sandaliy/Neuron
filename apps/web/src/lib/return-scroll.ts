import { useCallback, useLayoutEffect, useRef } from 'react';

/** Focused learning fixes the main frame, which temporarily removes page scroll. */
export function useReturnScroll(active: boolean): () => void {
  const position = useRef<{ left: number; top: number } | undefined>(undefined);
  useLayoutEffect(() => {
    if (active || !position.current) return;
    // The returning virtual list measures its runway during layout. Restore
    // after that commit so the browser does not clamp against the short frame.
    const target = position.current;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ ...target, behavior: 'instant' });
      position.current = undefined;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active]);
  return useCallback(() => {
    position.current = { left: window.scrollX, top: window.scrollY };
  }, []);
}

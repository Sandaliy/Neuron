import { useRouter, useRouterState } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';

/** A learning visit owns a history entry immediately after its entry screen. */
export function useLearningNavigation(
  mode: 'study' | 'practice',
  searchKey: 'learning' | 'followup' = 'learning',
) {
  const router = useRouter();
  const location = useRouterState({ select: (state) => state.location });
  const active = (location.search as Record<string, unknown>)[searchKey] === mode;
  const opening = useRef(false);
  useEffect(() => {
    opening.current = false;
  }, [location.href]);
  return {
    active,
    entry: (location.search as { entry?: 'resume' | 'setup' }).entry,
    open: (entry?: 'resume' | 'setup') => {
      if (active || opening.current) return;
      opening.current = true;
      void router
        .navigate({
          to: location.pathname,
          search: (search) => ({ ...search, [searchKey]: mode, ...(entry ? { entry } : {}) }),
          state: (state) => ({ ...state, learningOrigin: location.href }),
          resetScroll: false,
        })
        .catch(() => {
          opening.current = false;
        });
    },
    exit: () => {
      const search = { ...location.search } as Record<string, unknown>;
      delete search[searchKey];
      delete search['entry'];
      const origin = router.buildLocation({ to: location.pathname, search }).href;
      if (location.state.learningOrigin === origin) router.history.back();
      else void router.navigate({ to: location.pathname, search, replace: true });
    },
  };
}

declare module '@tanstack/react-router' {
  interface HistoryState {
    learningOrigin?: string;
  }
}

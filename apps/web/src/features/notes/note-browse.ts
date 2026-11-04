import { useRouterState } from '@tanstack/react-router';
import { useMemo } from 'react';

import type { NoteSort, NoteStatus } from '@neuron/shared';

import { useBrowseState } from '../../lib/browse-state';
import { accountEpoch, useOffline } from '../../lib/offline';

import type { NoteCategory } from '../../lib/note-categories';

interface BrowseState {
  search: string;
  typed: string;
  sort: NoteSort;
  status: NoteStatus | '';
  cardState: string;
  tag: string;
  tagFilter: string;
  source: string;
  sourceFilter: string;
  filtersOpen: boolean;
}

const initial: BrowseState = {
  search: '',
  typed: '',
  sort: 'created',
  status: '',
  cardState: '',
  tag: '',
  tagFilter: '',
  source: '',
  sourceFilter: '',
  filtersOpen: false,
};

/** Small visit state lives beside the paginated query, and is cleared with the account. */
export function useNoteBrowse(deckId: string | undefined, category?: NoteCategory) {
  const offline = useOffline();
  const visit = accountEpoch();
  const kind = category?.kind;
  const value = category?.value;
  const entry = useRouterState({
    select: (state) => (category ? state.location.state.__TSR_key : undefined),
  });
  const defaults = useMemo(
    () => ({
      ...initial,
      ...(kind && value ? { [kind]: value, [`${kind}Filter`]: value, filtersOpen: true } : {}),
    }),
    [kind, value],
  );
  const key = useMemo(
    () => ['note-browse', offline.accountId, visit, deckId ?? 'all', kind, value, entry],
    [offline.accountId, visit, deckId, kind, value, entry],
  );
  const [state, update] = useBrowseState(key, defaults);
  return { state, update };
}

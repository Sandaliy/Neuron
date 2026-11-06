import { useRouterState } from '@tanstack/react-router';
import { useMemo } from 'react';

import type { NoteBrowseSort as NoteSort, NoteStatus } from '@neuron/shared';

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
export function useNoteBrowse(
  deckId: string | undefined,
  category?: NoteCategory,
  recent?: 'added' | 'changed',
) {
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
      ...(recent
        ? { sort: (recent === 'added' ? 'created-desc' : 'updated-desc') as NoteSort }
        : {}),
      ...(kind && value ? { [kind]: value, [`${kind}Filter`]: value, filtersOpen: true } : {}),
    }),
    [kind, value, recent],
  );
  const key = useMemo(
    () => ['note-browse', offline.accountId, visit, deckId ?? 'all', kind, value, entry, recent],
    [offline.accountId, visit, deckId, kind, value, entry, recent],
  );
  const [state, update] = useBrowseState(key, defaults);
  return { state, update };
}

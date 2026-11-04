import { useRouter, useRouterState } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';

import type { DeckNode } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { accountEpoch, useOffline } from '../../lib/offline';
import { Button } from '../../ui/button';
import { CollectionPath } from '../library/collection-path';

import type { ReactNode } from 'react';

export function NoteHeader({
  title,
  decks,
  deckId,
  actions,
  readOnly = false,
}: {
  readonly title: string;
  readonly decks: readonly DeckNode[];
  readonly deckId: string;
  readonly actions?: ReactNode;
  readonly readOnly?: boolean;
}) {
  const router = useRouter();
  const origin = useRouterState({ select: (state) => state.location.state.noteSearchOrigin });
  const duplicateOrigin = useRouterState({
    select: (state) => state.location.state.duplicateOrigin,
  });
  const offline = useOffline();
  const t = useTranslate();
  const fromSearch = origin?.accountId === offline.accountId && origin?.visit === accountEpoch();
  const fromDuplicates =
    duplicateOrigin?.accountId === offline.accountId && duplicateOrigin?.visit === accountEpoch();
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {fromSearch || fromDuplicates ? (
        <div className="flex min-w-0 items-center gap-8">
          <Button variant="text" className="shrink-0" onClick={() => router.history.back()}>
            <ChevronLeft size={20} strokeWidth={1.5} aria-hidden="true" />
            {t(fromDuplicates ? 'duplicates.title' : 'notes.find')}
          </Button>
          <CollectionPath tree={decks} id={deckId} />
        </div>
      ) : (
        <CollectionPath tree={decks} id={deckId} trail within />
      )}
      <header className={`flex items-center justify-between gap-12 ${readOnly ? 'min-h-44' : ''}`}>
        <h1 className="font-display text-24 tracking-tight text-primary">{title}</h1>
        {actions}
      </header>
    </div>
  );
}

declare module '@tanstack/react-router' {
  interface HistoryState {
    noteSearchOrigin?: { accountId: string | null; visit: number };
    duplicateOrigin?: { accountId: string | null; visit: number };
  }
}

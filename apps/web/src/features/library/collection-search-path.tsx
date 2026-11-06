import { useRouter, useRouterState } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';

import type { DeckNode } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { accountEpoch, useOffline } from '../../lib/offline';
import { Button } from '../../ui/button';

import { CollectionPath } from './collection-path';

/** The return action belongs only to the collection opened from these results. */
export function CollectionSearchPath({
  tree,
  id,
}: {
  readonly tree: readonly DeckNode[];
  readonly id: string;
}) {
  const router = useRouter();
  const origin = useRouterState({ select: (state) => state.location.state.collectionSearchOrigin });
  const offline = useOffline();
  const t = useTranslate();
  if (
    origin?.id !== id ||
    origin.accountId !== offline.accountId ||
    origin.visit !== accountEpoch()
  )
    return <CollectionPath tree={tree} id={id} trail />;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Button variant="text" className="self-start" onClick={() => router.history.back()}>
        <ChevronLeft size={20} strokeWidth={1.5} aria-hidden="true" />
        {t('library.search.back')}
      </Button>
      <CollectionPath tree={tree} id={id} />
    </div>
  );
}

declare module '@tanstack/react-router' {
  interface HistoryState {
    collectionSearchOrigin?: { id: string; accountId: string | null; visit: number };
    collectionSearchEntry?: { accountId: string | null; visit: number };
  }
}

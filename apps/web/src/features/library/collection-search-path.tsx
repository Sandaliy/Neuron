import { useRouter, useRouterState } from '@tanstack/react-router';

import type { DeckNode } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { accountEpoch, useOffline } from '../../lib/offline';
import { BackLink } from '../../ui/page-header';

import { CollectionBack, CollectionLocation } from './collection-path';

/**
 * Back and location for a Folder or Deck screen.
 *
 * Opened from collection search results, Back returns to those results and the
 * location line says where the collection sits, because the results were not
 * that place. Opened from the hierarchy, Back names the parent and nothing else
 * is needed: the person walked here and knows the way.
 */
export function useCollectionHead(tree: readonly DeckNode[], id: string) {
  const router = useRouter();
  const origin = useRouterState({ select: (state) => state.location.state.collectionSearchOrigin });
  const offline = useOffline();
  const t = useTranslate();
  const fromSearch =
    origin?.id === id && origin.accountId === offline.accountId && origin.visit === accountEpoch();
  return fromSearch
    ? {
        back: <BackLink label={t('library.search.back')} onClick={() => router.history.back()} />,
        location: <CollectionLocation tree={tree} id={id} />,
      }
    : { back: <CollectionBack tree={tree} id={id} />, location: undefined };
}

declare module '@tanstack/react-router' {
  interface HistoryState {
    collectionSearchOrigin?: { id: string; accountId: string | null; visit: number };
    collectionSearchEntry?: { accountId: string | null; visit: number };
  }
}

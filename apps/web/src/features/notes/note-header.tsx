import { useRouter, useRouterState } from '@tanstack/react-router';

import type { DeckNode, MessageKey } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { accountEpoch, useOffline } from '../../lib/offline';
import { BackLink, PageHeader } from '../../ui/page-header';
import { CollectionBack, CollectionLocation } from '../library/collection-path';

import type { ReactNode } from 'react';

/**
 * Where a Note was opened from, if that was a list rather than its Deck.
 *
 * Search, Recent, Tags & Sources and the checks each leave a mark in history
 * state when they open a Note. Back then returns to that list, at its scroll
 * position, and the Deck path moves under the title, because the list was not
 * the Note's place.
 */
function useNoteOrigin(): string | undefined {
  const state = useRouterState({ select: (current) => current.location.state });
  const offline = useOffline();
  const t = useTranslate();
  const current = (origin: { accountId: string | null; visit: number } | undefined) =>
    origin?.accountId === offline.accountId && origin?.visit === accountEpoch();
  const key: MessageKey | undefined = current(state.problemOrigin)
    ? 'problems.title'
    : current(state.qualityOrigin)
      ? 'quality.title'
      : current(state.duplicateOrigin)
        ? 'duplicates.title'
        : current(state.noteSearchOrigin)
          ? state.noteSearchOrigin?.recent
            ? 'notes.recent'
            : 'search.title'
          : undefined;
  // A tag or source list is titled with its value, so Back names the value too.
  if (key === 'search.title' && state.noteSearchOrigin?.category)
    return state.noteSearchOrigin.category;
  return key && t(key);
}

export function NoteHeader({
  title,
  decks,
  deckId,
  actions,
}: {
  readonly title: string;
  readonly decks: readonly DeckNode[];
  readonly deckId: string;
  readonly actions?: ReactNode;
  readonly readOnly?: boolean;
}) {
  const router = useRouter();
  const origin = useNoteOrigin();
  return (
    <PageHeader
      title={title}
      actions={actions}
      back={
        origin ? (
          <BackLink label={origin} onClick={() => router.history.back()} />
        ) : (
          <CollectionBack tree={decks} id={deckId} within />
        )
      }
      location={origin ? <CollectionLocation tree={decks} id={deckId} includeSelf /> : undefined}
    />
  );
}

declare module '@tanstack/react-router' {
  interface HistoryState {
    noteSearchOrigin?: {
      accountId: string | null;
      visit: number;
      recent?: boolean;
      category?: string;
    };
    duplicateOrigin?: { accountId: string | null; visit: number };
    problemOrigin?: { accountId: string | null; visit: number };
    qualityOrigin?: { accountId: string | null; visit: number };
  }
}

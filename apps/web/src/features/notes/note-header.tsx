import type { DeckNode } from '@neuron/shared';

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
  return (
    <>
      <header className={`flex items-center justify-between gap-12 ${readOnly ? 'min-h-44' : ''}`}>
        <h1 className="font-display text-24 tracking-tight text-primary">{title}</h1>
        {actions}
      </header>
      <CollectionPath tree={decks} id={deckId} />
    </>
  );
}

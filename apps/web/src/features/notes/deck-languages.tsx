import { useState } from 'react';

import { missingDeckLanguages } from '@neuron/shared';
import type { DeckNode } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { describe } from '../../lib/api';
import { hasServerAuthority } from '../../lib/capabilities';
import { settingsFor, useDeckActions, useDeckTree } from '../../lib/decks';
import { Button } from '../../ui/button';
import { useToast } from '../../ui/toast';
import { DeckLanguagesDialog } from '../library/deck-dialogs';

/**
 * Says so when a deck does not know its two languages, and sets them.
 *
 * Only decks made before languages were required can be in this state, or one
 * whose folder default was cleared later. Nothing is assumed for them and
 * nothing waits on this: Study, Practice and Import go on as before. The line
 * goes away once both are set, from here or from the deck's settings.
 */
export function DeckLanguages({
  deck,
  available,
}: {
  readonly deck: DeckNode;
  /** Whether the server can take Deck changes now. */
  readonly available: boolean;
}) {
  const t = useTranslate();
  const toast = useToast();
  const tree = useDeckTree();
  const actions = useDeckActions();
  const [open, setOpen] = useState(false);
  const decks = tree.data ?? [];
  const missing = deck.kind === 'deck' && missingDeckLanguages(settingsFor(decks, deck.id)).length;

  function canAct() {
    if (available && hasServerAuthority() && !tree.local) return true;
    toast.show(t('offline.serverRequired'));
    return false;
  }

  return (
    <>
      {missing ? (
        <div data-deck-languages="" className="flex flex-col items-start gap-4">
          <p role="status" className="text-14 text-secondary">
            {t('library.languagesMissing')}
          </p>
          <Button variant="text" onClick={() => canAct() && setOpen(true)}>
            {t('library.setLanguages')}
          </Button>
        </div>
      ) : undefined}

      {/* Mounted while closed so that it closes with its own motion after a save. */}
      <DeckLanguagesDialog
        open={open}
        onOpenChange={setOpen}
        deck={deck}
        decks={decks}
        busy={actions.update.isPending}
        onSave={(settings) => {
          if (!canAct()) return;
          void actions.update
            .mutateAsync({ id: deck.id, settings })
            .then(() => setOpen(false))
            .catch((error: unknown) => toast.show(t(describe(error).key)));
        }}
      />
    </>
  );
}

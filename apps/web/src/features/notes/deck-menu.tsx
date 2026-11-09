import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import type { DeckNode } from '@neuron/shared';
import { uuidV7 } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { describe, request } from '../../lib/api';
import { hasServerAuthority } from '../../lib/capabilities';
import { DECK_TREE_KEY, useDeckActions, useDeckTree } from '../../lib/decks';
import { NOTE_KEY } from '../../lib/notes';
import { Button } from '../../ui/button';
import { Dialog, DialogBody, DialogFooter } from '../../ui/dialog';
import { Menu, MenuItem, MenuSeparator } from '../../ui/menu';
import { ErrorState } from '../../ui/states';
import { useToast } from '../../ui/toast';
import { DeckSettingsDialog } from '../library/deck-dialogs';

/**
 * Everything about a Deck that is not studying it, in one menu.
 *
 * Study skills, the two checks scoped to this Deck, pausing it in Daily Study
 * and restarting it used to be a text button, two links and a menu spread down
 * the head of the screen, each on its own 44-pixel row with nothing to say
 * which belonged together. The screen's own content now starts under the title.
 */
export function DeckMenu({
  deck,
  available,
}: {
  readonly deck: DeckNode;
  /** Whether the server can take Deck changes now. The checks open either way. */
  readonly available: boolean;
}) {
  const deckId = deck.id;
  const navigate = useNavigate();
  const t = useTranslate();
  const client = useQueryClient();
  const toast = useToast();
  const [operation, setOperation] = useState<string>();
  const tree = useDeckTree();
  const actions = useDeckActions();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const participation = actions.update;
  function canAct() {
    if (available && hasServerAuthority() && !tree.local) return true;
    toast.show(t('offline.serverRequired'));
    return false;
  }
  const restart = useMutation({
    mutationFn: (id: string) =>
      request(`/decks/${deckId}/restart-learning`, { method: 'POST', body: { id } }),
    onSuccess: async () => {
      setOperation(undefined);
      toast.show(t('learning.restarted'));
      await Promise.all([
        client.invalidateQueries({ queryKey: DECK_TREE_KEY }),
        client.invalidateQueries({ queryKey: [NOTE_KEY, 'list'] }),
        client.invalidateQueries({ queryKey: ['study-plan'] }),
      ]);
    },
  });
  return (
    <>
      <DeckSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        deck={deck}
        decks={tree.data ?? []}
        busy={actions.update.isPending}
        onSave={(settings) => {
          if (!canAct()) return;
          void actions.update
            .mutateAsync({ id: deck.id, settings })
            .then(() => setSettingsOpen(false))
            .catch((error) => toast.show(t(describe(error).key)));
        }}
      />
      <Menu label={t('deck.menu')}>
        <MenuItem unavailable={!available} onSelect={() => canAct() && setSettingsOpen(true)}>
          {t('study.skills')}
        </MenuItem>
        <MenuItem onSelect={() => void navigate({ to: '/library/duplicates', search: { deckId } })}>
          {t('duplicates.title')}
        </MenuItem>
        <MenuItem onSelect={() => void navigate({ to: '/library/slipping', search: { deckId } })}>
          {t('problems.title')}
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          unavailable={!available}
          disabled={participation.isPending}
          onSelect={() =>
            canAct() &&
            participation.mutate({
              id: deck.id,
              settings: {
                ...deck.settings,
                dailyStudyIncluded: deck.settings?.dailyStudyIncluded === false,
              },
            })
          }
        >
          {t(deck.settings?.dailyStudyIncluded === false ? 'study.included' : 'study.pause')}
        </MenuItem>
        <MenuItem
          unavailable={!available}
          onSelect={() => {
            if (!canAct()) return;
            restart.reset();
            setOperation(uuidV7());
          }}
        >
          {t('learning.restart')}
        </MenuItem>
      </Menu>
      <Dialog
        open={!!operation}
        onOpenChange={(open) => {
          if (!open && !restart.isPending) setOperation(undefined);
        }}
        title={t('learning.restartTitle')}
        description={t('learning.restartBody')}
        dismissable={!restart.isPending}
      >
        <DialogBody>
          {restart.error && (
            <ErrorState message={t(describe(restart.error).key)} retryLabel={t('common.retry')} />
          )}
        </DialogBody>
        <DialogFooter>
          <Button onClick={() => setOperation(undefined)} disabled={restart.isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            busy={restart.isPending}
            onClick={() => {
              if (operation && canAct()) restart.mutate(operation);
            }}
          >
            {t('learning.restart')}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}

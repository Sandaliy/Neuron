import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type { DeckNode } from '@neuron/shared';
import { uuidV7 } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { describe, request } from '../../lib/api';
import { DECK_TREE_KEY, useDeckActions, useDeckTree } from '../../lib/decks';
import { NOTE_KEY } from '../../lib/notes';
import { Button } from '../../ui/button';
import { Dialog, DialogBody, DialogFooter } from '../../ui/dialog';
import { Menu, MenuItem } from '../../ui/menu';
import { ErrorState } from '../../ui/states';
import { useToast } from '../../ui/toast';
import { DeckSettingsDialog } from '../library/deck-dialogs';

export function RestartLearning({
  deck,
  skillsOnly = false,
}: {
  readonly deck: DeckNode;
  readonly skillsOnly?: boolean;
}) {
  const deckId = deck.id;
  const t = useTranslate();
  const client = useQueryClient();
  const toast = useToast();
  const [operation, setOperation] = useState<string>();
  const tree = useDeckTree();
  const actions = useDeckActions();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const participation = actions.update;
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
      <Button
        className="self-start"
        variant="text"
        hidden={!skillsOnly}
        onClick={() => setSettingsOpen(true)}
      >
        {t('study.skills')}
      </Button>
      <DeckSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        deck={deck}
        decks={tree.data ?? []}
        busy={actions.update.isPending}
        onSave={(settings) => {
          void actions.update
            .mutateAsync({ id: deck.id, settings })
            .then(() => setSettingsOpen(false))
            .catch((error) => toast.show(t(describe(error).key)));
        }}
      />
      {!skillsOnly && (
        <Menu label={t('library.settings')}>
          <MenuItem
            disabled={participation.isPending}
            onSelect={() =>
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
            onSelect={() => {
              restart.reset();
              setOperation(uuidV7());
            }}
          >
            {t('learning.restart')}
          </MenuItem>
        </Menu>
      )}
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
              if (operation) restart.mutate(operation);
            }}
          >
            {t('learning.restart')}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}

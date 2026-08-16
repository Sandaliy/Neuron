import { useState } from 'react';

import { BULK_LIMIT } from '@neuron/shared';
import type { DeckNode } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { flatten, useDeckTree } from '../../lib/decks';
import { useDialogState } from '../../lib/dialog-state';
import { useNoteActions } from '../../lib/notes';
import { Button } from '../../ui/button';
import { Dialog, DialogBody, DialogFooter } from '../../ui/dialog';
import { FormField } from '../../ui/form-field';
import { Input } from '../../ui/input';
import { Select } from '../../ui/select';
import { useToast } from '../../ui/toast';

/**
 * What a selection can be told to do.
 *
 * The one that matters most is marking a selection as known. It is how four
 * hundred words already known come out of a list of five thousand before the
 * triage sweep exists, and without it a large import is unusable.
 *
 * A bulk request is capped at five hundred ids, so a selection larger than that
 * is sent in several. They are sent one after another rather than at once: the
 * point is to change a lot of rows, not to open a lot of transactions.
 */
export function NoteSelectionBar({
  ids,
  deckId,
  onSelectAll,
  onClear,
  onDone,
}: {
  readonly ids: readonly string[];
  /** Which deck the list is showing, so moving offers somewhere else first. */
  readonly deckId?: string;
  readonly onSelectAll: () => void;
  readonly onClear: () => void;
  readonly onDone: () => void;
}) {
  const t = useTranslate();
  const toast = useToast();
  const actions = useNoteActions();
  const decks = useDeckTree();
  const [dialog, setDialog] = useState<'none' | 'move' | 'tags' | 'delete'>('none');

  const busy =
    actions.setStatus.isPending ||
    actions.move.isPending ||
    actions.tag.isPending ||
    actions.removeMany.isPending;

  /** Runs one bulk action over the selection, five hundred at a time. */
  async function inChunks(run: (chunk: readonly string[]) => Promise<{ [key: string]: unknown }>) {
    let total = 0;

    for (let start = 0; start < ids.length; start += BULK_LIMIT) {
      const answer = await run(ids.slice(start, start + BULK_LIMIT));

      total += Number(answer['changed'] ?? answer['deleted'] ?? 0);
    }

    setDialog('none');
    onDone();
    toast.show(t('notes.bulkDone', { count: total }));
  }

  return (
    <>
      {/*
        A bar above the tab bar, which is the second floating layer and the last
        one allowed. It only exists while something is selected, so the two are
        never both carrying actions for long.
      */}
      <div
        data-g="bar"
        className="fixed inset-x-16 bottom-[calc(var(--bar-inset)+var(--bar-height)+8px)] z-30 flex flex-wrap items-center gap-8 rounded-24 p-8 sm:mx-auto sm:max-w-[560px]"
      >
        <span className="px-8 text-13 text-primary" data-numeric="">
          {t('notes.selected', { count: ids.length })}
        </span>

        <div className="flex flex-1 flex-wrap justify-end gap-4">
          <Button variant="text" onClick={ids.length === 0 ? onSelectAll : onClear}>
            {ids.length === 0 ? t('notes.selectAll') : t('notes.clearSelection')}
          </Button>

          <Button
            variant="quiet"
            disabled={ids.length === 0 || busy}
            onClick={() =>
              void inChunks((chunk) =>
                actions.setStatus.mutateAsync({ ids: chunk, status: 'known' }),
              )
            }
          >
            {t('notes.bulkStatus')}
          </Button>

          <Button variant="quiet" disabled={ids.length === 0} onClick={() => setDialog('move')}>
            {t('notes.bulkMove')}
          </Button>

          <Button variant="quiet" disabled={ids.length === 0} onClick={() => setDialog('tags')}>
            {t('notes.bulkTags')}
          </Button>

          <Button
            variant="destructive"
            disabled={ids.length === 0}
            onClick={() => setDialog('delete')}
          >
            {t('notes.bulkDelete')}
          </Button>
        </div>
      </div>

      <MoveDialog
        open={dialog === 'move'}
        count={ids.length}
        decks={decks.data ?? []}
        {...(deckId === undefined ? {} : { deckId })}
        busy={busy}
        onClose={() => setDialog('none')}
        onMove={(target) =>
          void inChunks((chunk) => actions.move.mutateAsync({ ids: chunk, deckId: target }))
        }
      />

      <TagsDialog
        open={dialog === 'tags'}
        count={ids.length}
        busy={busy}
        onClose={() => setDialog('none')}
        onApply={(add, remove) =>
          void inChunks((chunk) =>
            actions.tag.mutateAsync({
              ids: chunk,
              ...(add.length === 0 ? {} : { add }),
              ...(remove.length === 0 ? {} : { remove }),
            }),
          )
        }
      />

      {dialog === 'delete' ? (
        <Dialog
          open
          onOpenChange={() => setDialog('none')}
          title={t('notes.bulkDeleteTitle', { count: ids.length })}
          description={t('notes.bulkDeleteBody')}
        >
          <DialogFooter>
            <Button
              variant="destructive"
              full
              busy={busy}
              onClick={() => void inChunks((chunk) => actions.removeMany.mutateAsync(chunk))}
            >
              {t('notes.bulkDelete')}
            </Button>
            <Button variant="text" full onClick={() => setDialog('none')}>
              {t('common.cancel')}
            </Button>
          </DialogFooter>
        </Dialog>
      ) : undefined}
    </>
  );
}

function MoveDialog({
  open,
  count,
  decks,
  deckId,
  busy,
  onClose,
  onMove,
}: {
  readonly open: boolean;
  readonly count: number;
  readonly decks: readonly DeckNode[];
  readonly deckId?: string;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onMove: (deckId: string) => void;
}) {
  const t = useTranslate();
  const all = flatten(decks);
  const [target, setTarget] = useDialogState(
    open,
    all.find((deck) => deck.id !== deckId)?.id ?? all[0]?.id ?? '',
  );

  return (
    <Dialog open={open} onOpenChange={onClose} title={t('notes.bulkMoveTitle', { count })}>
      <DialogBody>
        <FormField label={t('note.deck')}>
          {(props) => (
            <Select {...props} value={target} onChange={(event) => setTarget(event.target.value)}>
              {all.map((deck) => (
                <option key={deck.id} value={deck.id}>
                  {'— '.repeat(deck.path.length) + deck.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      </DialogBody>

      <DialogFooter>
        <Button
          variant="primary"
          full
          busy={busy}
          disabled={target === ''}
          onClick={() => onMove(target)}
        >
          {t('notes.bulkMove')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function TagsDialog({
  open,
  count,
  busy,
  onClose,
  onApply,
}: {
  readonly open: boolean;
  readonly count: number;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onApply: (add: readonly string[], remove: readonly string[]) => void;
}) {
  const t = useTranslate();
  const [add, setAdd] = useDialogState(open, '');
  const [remove, setRemove] = useDialogState(open, '');

  const parse = (value: string) =>
    value
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag !== '');

  return (
    <Dialog open={open} onOpenChange={onClose} title={t('notes.bulkTagsTitle', { count })}>
      <DialogBody>
        <FormField label={t('notes.tagsAdd')} hint={t('note.tagsHint')}>
          {(props) => (
            <Input
              {...props}
              value={add}
              autoComplete="off"
              enterKeyHint="next"
              onChange={(event) => setAdd(event.target.value)}
            />
          )}
        </FormField>

        <FormField label={t('notes.tagsRemove')} hint={t('note.tagsHint')}>
          {(props) => (
            <Input
              {...props}
              value={remove}
              autoComplete="off"
              enterKeyHint="done"
              onChange={(event) => setRemove(event.target.value)}
            />
          )}
        </FormField>
      </DialogBody>

      <DialogFooter>
        <Button
          variant="primary"
          full
          busy={busy}
          disabled={parse(add).length + parse(remove).length === 0}
          onClick={() => onApply(parse(add), parse(remove))}
        >
          {t('notes.tagsApply')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

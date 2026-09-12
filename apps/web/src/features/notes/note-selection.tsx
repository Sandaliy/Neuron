import { useRef, useState } from 'react';

import { BULK_LIMIT } from '@neuron/shared';
import type { DeckNode, Note, MessageKey } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { describe } from '../../lib/api';
import { flatten, useDeckTree } from '../../lib/decks';
import { useDialogState } from '../../lib/dialog-state';
import { useNoteActions } from '../../lib/notes';
import { Button } from '../../ui/button';
import { Dialog, DialogBody, DialogFooter } from '../../ui/dialog';
import { FormField } from '../../ui/form-field';
import { Input } from '../../ui/input';
import { useToast } from '../../ui/toast';
import { CollectionPicker } from '../library/collection-picker';

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
  notes,
  deckId,
  onSelectAll,
  onClear,
  onDone,
}: {
  readonly ids: readonly string[];
  readonly notes: readonly Note[];
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

  const running = useRef(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<unknown>();
  const busy =
    working ||
    actions.setStatus.isPending ||
    actions.move.isPending ||
    actions.tag.isPending ||
    actions.removeMany.isPending;

  /** Runs one bulk action over the selection, five hundred at a time. */
  async function inChunks(
    run: (chunk: readonly string[]) => Promise<{ [key: string]: unknown }>,
    message: MessageKey | 'notes.moved' = 'notes.bulkDone',
  ) {
    if (running.current || ids.length === 0) return;
    running.current = true;
    setWorking(true);
    setError(undefined);
    let total = 0;
    try {
      for (let start = 0; start < ids.length; start += BULK_LIMIT) {
        const answer = await run(ids.slice(start, start + BULK_LIMIT));
        total += Number(answer['changed'] ?? answer['deleted'] ?? 0);
      }
      setDialog('none');
      onDone();
      toast.show(t(message as MessageKey, { count: total }));
    } catch (failure) {
      setDialog('none');
      setError(failure);
    } finally {
      running.current = false;
      setWorking(false);
    }
  }

  return (
    <>
      <div
        className="flex flex-col gap-12 rounded-12 border border-accent bg-card p-16"
        aria-busy={busy}
      >
        <div className="flex items-center justify-between gap-8">
          <span className="text-15 text-primary" data-numeric="">
            {t('notes.selected', { count: ids.length })}
          </span>
          <Button variant="quiet" disabled={busy} onClick={onDone}>
            {t('notes.selectDone')}
          </Button>
        </div>
        <p className="text-14 text-secondary">{t('notes.selectionHint')}</p>
        <Button variant="text" disabled={busy} onClick={ids.length === 0 ? onSelectAll : onClear}>
          {ids.length === 0 ? t('notes.selectAll') : t('notes.clearSelection')}
        </Button>
        {ids.length > 0 && (
          <div className="grid grid-cols-2 gap-8">
            {notes.some((note) => note.status !== 'known') && (
              <Button
                disabled={busy}
                onClick={() =>
                  void inChunks((chunk) =>
                    actions.setStatus.mutateAsync({ ids: chunk, status: 'known' }),
                  )
                }
              >
                {t('notes.bulkStatus')}
              </Button>
            )}
            {notes.some((note) => note.status !== 'active') && (
              <Button
                disabled={busy}
                onClick={() =>
                  void inChunks((chunk) =>
                    actions.setStatus.mutateAsync({ ids: chunk, status: 'active' }),
                  )
                }
              >
                {t('notes.bulkActive')}
              </Button>
            )}
            <Button disabled={busy} onClick={() => setDialog('move')}>
              {t('notes.bulkMove')}
            </Button>
            <Button disabled={busy} onClick={() => setDialog('tags')}>
              {t('notes.bulkTags')}
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => setDialog('delete')}>
              {t('notes.bulkDelete')}
            </Button>
          </div>
        )}
        {busy && (
          <p role="status" className="text-14 text-secondary">
            {t('note.saving')}
          </p>
        )}
        {error !== undefined && (
          <p role="alert" className="text-14 text-error">
            {t(describe(error).key, describe(error).values)} {t('notes.bulkRetryHint')}
          </p>
        )}
      </div>

      <MoveDialog
        open={dialog === 'move'}
        count={ids.length}
        decks={decks.data ?? []}
        {...(deckId === undefined ? {} : { deckId })}
        busy={busy}
        onClose={() => setDialog('none')}
        onMove={(target) =>
          void inChunks(
            (chunk) => actions.move.mutateAsync({ ids: chunk, deckId: target }),
            'notes.moved',
          )
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
              onClick={() =>
                void inChunks((chunk) => actions.removeMany.mutateAsync(chunk), 'notes.bulkDeleted')
              }
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
  const all = flatten(decks).filter((row) => row.kind === 'deck');
  const [target, setTarget] = useDialogState(
    open,
    all.find((deck) => deck.id !== deckId)?.id ?? all[0]?.id ?? '',
  );

  return (
    <Dialog open={open} onOpenChange={onClose} title={t('notes.bulkMoveTitle', { count })}>
      <DialogBody>
        <FormField label={t('note.deck')}>
          {(props) => (
            <CollectionPicker {...props} tree={decks} value={target} onChange={setTarget} />
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

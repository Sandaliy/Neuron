import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { termOf } from '@neuron/shared';
import type { NoteFields } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { flatten, useDeckTree } from '../../lib/decks';
import {
  archiveNoteCreation,
  chooseCreationDeck,
  noteCreations,
  unsentCreation,
} from '../../lib/note-creation';
import { useOffline } from '../../lib/offline';
import { Button } from '../../ui/button';
import { FormField } from '../../ui/form-field';
import { CollectionPicker } from '../library/collection-picker';

import type { PendingNoteCreate } from '../../lib/note-creation';

export function noteCreationsKey(accountId: string | null) {
  return ['note-creation', accountId] as const;
}

/**
 * New Notes saved on this device that the server could not add. Each stays on
 * the device until the learner chooses: send it to a Deck they pick, copy it,
 * or stop sending it. Nothing is placed in another Deck without that choice.
 */
export function PendingCreations() {
  const t = useTranslate();
  const state = useOffline();
  const entries = useQuery({
    queryKey: noteCreationsKey(state.accountId),
    queryFn: () => noteCreations(state.accountId!),
    enabled: state.accountId !== null,
    networkMode: 'always',
  });
  const waiting = (entries.data ?? []).filter(
    (entry) => unsentCreation(entry) && entry.state !== 'pending',
  );
  if (!entries.error && waiting.length === 0) return null;
  return (
    <section aria-label={t('offline.create.savedNotes')} className="flex flex-col gap-12">
      {waiting.length > 0 && (
        <p className="text-14 font-semibold text-primary">{t('offline.create.savedNotes')}</p>
      )}
      <div className="flex flex-col gap-16">
        {entries.error && <p role="alert">{t('offline.changesUnavailable')}</p>}
        {waiting.map((entry) => (
          <SavedCreation key={entry.entityId} entry={entry} />
        ))}
      </div>
    </section>
  );
}

function SavedCreation({ entry }: { readonly entry: PendingNoteCreate }) {
  const t = useTranslate();
  const client = useQueryClient();
  const decks = useDeckTree();
  const tree = decks.data ?? [];
  const [picked, setDeck] = useState('');
  // The first live Deck is offered; nothing moves until the learner confirms it.
  const deck = picked || (flatten(tree).find((row) => row.kind === 'deck')?.id ?? '');
  const choose = useMutation({
    mutationFn: () => chooseCreationDeck(entry.entityId, deck),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['notes', 'list'] }),
  });
  const archive = useMutation({
    mutationFn: () => archiveNoteCreation(entry.entityId),
    onSuccess: () => client.removeQueries({ queryKey: ['notes', entry.entityId], exact: true }),
  });
  const reason =
    entry.state === 'draft'
      ? t('offline.note.draft')
      : entry.outcome?.reason === 'deck_unavailable'
        ? t('offline.create.deckUnavailable')
        : entry.outcome?.reason === 'note_exists'
          ? t('offline.create.exists')
          : t('offline.create.rejected');
  return (
    <div className="flex flex-col gap-8 border-t border-subtle pt-12">
      <p className="text-14 text-primary">{termOf(entry.working.fields as NoteFields)}</p>
      <p role="status" className="text-13 text-secondary">
        {reason}
      </p>
      {entry.state === 'conflict' && (
        <FormField label={t('offline.create.chooseDeck')}>
          {(props) => <CollectionPicker {...props} tree={tree} value={deck} onChange={setDeck} />}
        </FormField>
      )}
      <div className="flex flex-wrap gap-8">
        {entry.state === 'conflict' && (
          <Button
            variant="quiet"
            disabled={deck === ''}
            busy={choose.isPending}
            onClick={() => choose.mutate()}
          >
            {t('offline.create.useDeck')}
          </Button>
        )}
        <Button
          variant="text"
          onClick={() => void navigator.clipboard.writeText(JSON.stringify(entry.working, null, 2))}
        >
          {t('offline.create.copy')}
        </Button>
        {(entry.state === 'conflict' || entry.state === 'rejected') && (
          <Button variant="text" busy={archive.isPending} onClick={() => archive.mutate()}>
            {t('offline.create.archive')}
          </Button>
        )}
      </div>
      {(choose.error || archive.error) && (
        <p role="alert" className="text-13 text-error">
          {t(
            choose.error?.message === 'collection_deck_missing'
              ? 'offline.create.deckMissing'
              : 'offline.renameRetryFailed',
          )}
        </p>
      )}
    </div>
  );
}

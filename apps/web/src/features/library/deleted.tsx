import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';

import { termOf } from '@neuron/shared';
import type { DeletedDeck, DeletedNote } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { describe } from '../../lib/api';
import { useDeckActions } from '../../lib/decks';
import { useNoteActions } from '../../lib/notes';
import { useDeletedDecks, useDeletedNotes } from '../../lib/recovery';
import { Button } from '../../ui/button';
import { DenseRow, Row } from '../../ui/row';
import { Segmented } from '../../ui/segmented';
import { EmptyState, ErrorState, SkeletonRows } from '../../ui/states';
import { useToast } from '../../ui/toast';
type Kind = 'decks' | 'notes';

/** A separate recovery surface: live library and browse never request tombstones. */
export function DeletedScreen() {
  const t = useTranslate();
  const navigate = useNavigate();
  const [kind, setKind] = useState<Kind>('decks');

  return (
    <section data-screen="" className="flex flex-col gap-20">
      <header className="flex items-center gap-8">
        <Button
          variant="text"
          aria-label={t('common.back')}
          onClick={() => void navigate({ to: '/library' })}
        >
          <ArrowLeft size={18} strokeWidth={1.5} aria-hidden="true" />
        </Button>
        <h1 className="font-display text-24 tracking-tight text-primary">{t('deleted.title')}</h1>
      </header>

      <Segmented
        value={kind}
        onChange={setKind}
        label={t('deleted.segmentLabel')}
        options={[
          { value: 'decks', label: t('deleted.decks') },
          { value: 'notes', label: t('deleted.notes') },
        ]}
      />

      {kind === 'decks' ? <DeletedDeckList /> : <DeletedNoteList />}
    </section>
  );
}

function DeletedDeckList() {
  const t = useTranslate();
  const toast = useToast();
  const deleted = useDeletedDecks();
  const actions = useDeckActions();
  const [errors, setErrors] = useState<Record<string, unknown>>({});

  async function restore(deck: DeletedDeck) {
    setErrors((current) => ({ ...current, [deck.id]: undefined }));
    try {
      const result = await actions.restore.mutateAsync(deck.id);
      await deleted.refetch();
      if (result.restored > 0) {
        toast.show(t('deleted.deckRestored', { name: deck.name }));
      }
    } catch (error) {
      setErrors((current) => ({ ...current, [deck.id]: error }));
    }
  }

  if (deleted.isPending) return <SkeletonRows rows={5} />;
  if (deleted.error && !deleted.data) {
    return (
      <ErrorState
        message={t(describe(deleted.error).key, describe(deleted.error).values)}
        retryLabel={t('common.retry')}
        onRetry={() => void deleted.refetch()}
      />
    );
  }
  if (deleted.data?.length === 0) {
    return (
      <EmptyState title={t('deleted.decksEmptyTitle')} description={t('deleted.decksEmptyBody')} />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {deleted.data?.map((deck) => {
        const error = errors[deck.id];
        const blocked = deck.parentDeleted;
        return (
          <div key={deck.id} className="flex flex-col gap-8">
            <Row
              title={deck.name}
              subtitle={
                deck.pathNames.length > 0 ? deck.pathNames.join(' / ') : t('deleted.topLevel')
              }
              trailing={
                <Button
                  variant="quiet"
                  busy={actions.restore.isPending && actions.restore.variables === deck.id}
                  disabled={blocked}
                  onClick={() => void restore(deck)}
                >
                  {t('deleted.restore')}
                </Button>
              }
            />
            {blocked ? (
              <p className="px-16 text-12 text-error">{t('deleted.parentRequired')}</p>
            ) : undefined}
            {error ? (
              <p role="alert" className="px-16 text-12 text-error">
                {t(describe(error).key, describe(error).values)}
              </p>
            ) : undefined}
          </div>
        );
      })}
    </div>
  );
}

function DeletedNoteList() {
  const t = useTranslate();
  const toast = useToast();
  const deleted = useDeletedNotes();
  const actions = useNoteActions();
  const [errors, setErrors] = useState<Record<string, unknown>>({});

  async function restore(note: DeletedNote) {
    setErrors((current) => ({ ...current, [note.id]: undefined }));
    try {
      const result = await actions.restore.mutateAsync(note.id);
      await deleted.refetch();
      if (result.restored) {
        toast.show(
          result.cardsRemainingDeleted > 0
            ? t('deleted.noteRestoredPartial', { count: result.cardsRemainingDeleted })
            : t('deleted.noteRestored'),
        );
      }
    } catch (error) {
      setErrors((current) => ({ ...current, [note.id]: error }));
    }
  }

  if (deleted.isPending) return <SkeletonRows rows={5} />;
  if (deleted.error && !deleted.data) {
    return (
      <ErrorState
        message={t(describe(deleted.error).key, describe(deleted.error).values)}
        retryLabel={t('common.retry')}
        onRetry={() => void deleted.refetch()}
      />
    );
  }
  if (deleted.data?.length === 0) {
    return (
      <EmptyState title={t('deleted.notesEmptyTitle')} description={t('deleted.notesEmptyBody')} />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {deleted.data?.map((note) => {
        const error = errors[note.id];
        const blocked = !note.deckLive;
        return (
          <div key={note.id} className="flex flex-col gap-8 rounded-12 border">
            <DenseRow
              word={termOf(note.fields)}
              meaning={note.deckPath.join(' / ') || t('deleted.unknownDeck')}
              trailing={
                <Button
                  variant="quiet"
                  busy={actions.restore.isPending && actions.restore.variables === note.id}
                  disabled={blocked}
                  onClick={() => void restore(note)}
                >
                  {t('deleted.restore')}
                </Button>
              }
            />
            {blocked ? (
              <p className="px-16 pb-8 text-12 text-error">{t('deleted.deckRequired')}</p>
            ) : undefined}
            {error ? (
              <p role="alert" className="px-16 pb-8 text-12 text-error">
                {t(describe(error).key, describe(error).values)}
              </p>
            ) : undefined}
          </div>
        );
      })}
    </div>
  );
}

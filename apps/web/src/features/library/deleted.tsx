import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ChevronRight, Folder } from 'lucide-react';
import { useRef, useState } from 'react';

import { termOf } from '@neuron/shared';
import type { DeletedDeck, DeletedNote } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { describe } from '../../lib/api';
import { useDeckActions } from '../../lib/decks';
import { useNoteActions } from '../../lib/notes';
import { useDeletedDecks, useDeletedNotes } from '../../lib/recovery';
import { Button } from '../../ui/button';
import { Row, TreeChildren } from '../../ui/row';
import { Segmented } from '../../ui/segmented';
import { EmptyState, ErrorState, SkeletonRows } from '../../ui/states';
import { useToast } from '../../ui/toast';

import { PurgeAction } from './purge-action';
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
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
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

  const rows = deleted.data ?? [];
  const ids = new Set(rows.map((row) => row.id));
  function render(deck: DeletedDeck) {
    const children = rows.filter((row) => row.parentId === deck.id);
    const expanded = !collapsed.has(deck.id);
    const error = errors[deck.id];
    return (
      <div key={deck.id} className="flex flex-col gap-8">
        <div className={deck.context ? 'opacity-60' : ''}>
          <Row
            title={deck.name}
            subtitle={t(deck.context ? 'deleted.liveContext' : 'deleted.originalLocation')}
            leading={
              <>
                {children.length > 0 && (
                  <button
                    type="button"
                    className="flex size-44 shrink-0 items-center justify-center"
                    aria-expanded={expanded}
                    aria-label={t(expanded ? 'library.collapse' : 'library.expand')}
                    onClick={() =>
                      setCollapsed((current) => {
                        const next = new Set(current);
                        if (!next.delete(deck.id)) next.add(deck.id);
                        return next;
                      })
                    }
                  >
                    <ChevronRight
                      size={16}
                      className={expanded ? 'rotate-90' : ''}
                      aria-hidden="true"
                    />
                  </button>
                )}
                {deck.kind === 'folder' && (
                  <Folder size={18} className="shrink-0 text-tertiary" aria-hidden="true" />
                )}
              </>
            }
          />
        </div>
        {!deck.context && (
          <div className="flex flex-wrap gap-8 px-12">
            <Button
              variant="quiet"
              busy={actions.restore.isPending && actions.restore.variables === deck.id}
              disabled={deck.parentDeleted}
              onClick={() => void restore(deck)}
            >
              {t('deleted.restore')}
            </Button>
            <PurgeAction target="decks" id={deck.id} name={deck.name} />
          </div>
        )}
        {!deck.context && deck.parentDeleted && (
          <p className="px-16 text-12 text-secondary">{t('deleted.parentRequired')}</p>
        )}
        {!!error && (
          <p role="alert" className="px-16 text-12 text-error">
            {t(describe(error).key, describe(error).values)}
          </p>
        )}
        {expanded && children.length > 0 && <TreeChildren>{children.map(render)}</TreeChildren>}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-8">
      {rows.filter((row) => row.parentId === null || !ids.has(row.parentId)).map(render)}
    </div>
  );
}

function DeletedNoteList() {
  const t = useTranslate();
  const toast = useToast();
  const deleted = useDeletedNotes();
  const actions = useNoteActions();
  const pending = useRef(new Set<string>());
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, unknown>>({});

  async function restore(note: DeletedNote) {
    if (pending.current.has(note.id)) return;
    pending.current.add(note.id);
    setHidden(new Set(pending.current));
    setErrors((current) => ({ ...current, [note.id]: undefined }));
    try {
      const result = await actions.restore.mutateAsync(note.id);
      const refreshed = await deleted.refetch();
      if (refreshed.error) throw refreshed.error;
      pending.current.delete(note.id);
      setHidden(new Set(pending.current));
      if (result.restored) {
        toast.show(
          result.cardsRemainingDeleted > 0
            ? t('deleted.noteRestoredPartial', { count: result.cardsRemainingDeleted })
            : t('deleted.noteRestored'),
        );
      }
    } catch (error) {
      pending.current.delete(note.id);
      setHidden(new Set(pending.current));
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
      {deleted.data
        ?.filter((note) => !hidden.has(note.id))
        .map((note) => {
          const error = errors[note.id];
          const blocked = !note.deckLive;
          return (
            <div
              key={note.id}
              className="flex flex-col gap-12 rounded-12 border border-subtle bg-card p-12"
            >
              <div className="flex min-w-0 flex-col gap-4">
                <p className="truncate text-15 text-primary">{termOf(note.fields)}</p>
                <p className="truncate text-12 text-secondary">
                  {note.deckPath.join(' / ') || t('deleted.unknownDeck')}
                </p>
              </div>
              <div className="flex flex-wrap gap-8">
                <Button disabled={blocked} onClick={() => void restore(note)}>
                  {t('deleted.restore')}
                </Button>
                <PurgeAction target="notes" id={note.id} name={termOf(note.fields)} />
              </div>
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

import { ChevronRight, Search } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';

import { editorFields, filledPaths, readField, termOf } from '@neuron/shared';
import type { DeletedDeck, DeletedNote } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { describe } from '../../lib/api';
import { useDeckActions } from '../../lib/decks';
import { useNoteActions } from '../../lib/notes';
import { useDeletedDecks, useDeletedNotes } from '../../lib/recovery';
import { Button } from '../../ui/button';
import { CollectionIcon, collectionSurface } from '../../ui/collection';
import { Disclosure } from '../../ui/disclosure';
import { Input } from '../../ui/input';
import { PageHeader } from '../../ui/page-header';
import { Row } from '../../ui/row';
import { Segmented } from '../../ui/segmented';
import { Select } from '../../ui/select';
import { EmptyState, ErrorState, SkeletonRows } from '../../ui/states';
import { useToast } from '../../ui/toast';
import { NoteField } from '../notes/note-field';

import { CollectionBack } from './collection-path';
import {
  browseDeletedDecks,
  indexDeletedDecks,
  indexDeletedNotes,
  matchesDeleted,
  searchText,
  sortDeleted,
} from './deleted-browse';
import { DeletedRows } from './deleted-rows';
import { PurgeAction } from './purge-action';

import type { DeletedSort } from './deleted-browse';

type Kind = 'decks' | 'notes';
interface Browse {
  readonly typed: string;
  readonly sort: DeletedSort;
}
const EMPTY_ROWS: never[] = [];

/** A separate recovery surface: live library and browse never request tombstones. */
export function DeletedScreen() {
  const t = useTranslate();
  const [kind, setKind] = useState<Kind>('decks');
  const [browse, setBrowse] = useState<Record<Kind, Browse>>({
    decks: { typed: '', sort: 'original' },
    notes: { typed: '', sort: 'original' },
  });
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const current = browse[kind];
  const change = (value: Browse) => setBrowse((state) => ({ ...state, [kind]: value }));

  return (
    <section data-screen="" className="flex flex-col gap-20">
      <PageHeader title={t('deleted.title')} back={<CollectionBack tree={[]} id="" />} />
      <Segmented
        value={kind}
        onChange={setKind}
        label={t('deleted.segmentLabel')}
        options={[
          { value: 'decks', label: t('deleted.decks') },
          { value: 'notes', label: t('deleted.notes') },
        ]}
      />
      {kind === 'decks' ? (
        <DeletedDeckList
          browse={current}
          onBrowse={change}
          collapsed={collapsed}
          onCollapse={setCollapsed}
        />
      ) : (
        <DeletedNoteList browse={current} onBrowse={change} />
      )}
    </section>
  );
}

/** Batch local scans while retaining an immediate, controlled input. */
function useSearch(typed: string) {
  const [query, setQuery] = useState(() => searchText(typed.trim()));
  useEffect(() => {
    const timer = setTimeout(() => setQuery(searchText(typed.trim())), 150);
    return () => clearTimeout(timer);
  }, [typed]);
  return query;
}

function BrowseControls({
  browse,
  onChange,
  kind,
  count,
  total,
  query,
}: {
  readonly browse: Browse;
  readonly onChange: (value: Browse) => void;
  readonly kind: Kind;
  readonly count: number;
  readonly total: number;
  readonly query: string;
}) {
  const t = useTranslate();
  const busy = searchText(browse.typed.trim()) !== query;
  return (
    <div className="flex flex-col gap-12">
      <div className="relative">
        <Search
          aria-hidden="true"
          size={16}
          className="pointer-events-none absolute left-12 top-16 text-secondary"
        />
        <Input
          type="search"
          className="pl-40"
          value={browse.typed}
          aria-busy={busy}
          aria-label={t(kind === 'notes' ? 'deleted.searchNotes' : 'deleted.searchDecks')}
          placeholder={t(kind === 'notes' ? 'deleted.searchNotes' : 'deleted.searchDecks')}
          enterKeyHint="search"
          onChange={(event) => onChange({ ...browse, typed: event.target.value })}
        />
      </div>
      <div className="flex flex-wrap items-center gap-12">
        <div className="min-w-0 flex-1">
          <Select
            aria-label={t('notes.sort')}
            value={browse.sort}
            onChange={(event) => onChange({ ...browse, sort: event.target.value as DeletedSort })}
          >
            <option value="original">{t('deleted.sortOriginal')}</option>
            <option value="alpha">{t('notes.sort.alpha')}</option>
            <option value="reverse">{t('deleted.sortReverse')}</option>
            <option value="location">{t('deleted.sortLocation')}</option>
          </Select>
        </div>
        <p role="status" aria-live="polite" aria-busy={busy} className="text-13 text-secondary">
          {t('deleted.results', { count, total })}
        </p>
      </div>
    </div>
  );
}

function SearchEmpty() {
  const t = useTranslate();
  return (
    <EmptyState title={t('deleted.searchEmptyTitle')} description={t('deleted.searchEmptyBody')} />
  );
}

function ReadError({ error, retry }: { readonly error: unknown; readonly retry: () => void }) {
  const t = useTranslate();
  return (
    <ErrorState
      message={t(describe(error).key, describe(error).values)}
      retryLabel={t('common.retry')}
      onRetry={retry}
    />
  );
}

function DeletedDeckList({
  browse,
  onBrowse,
  collapsed,
  onCollapse,
}: {
  readonly browse: Browse;
  readonly onBrowse: (value: Browse) => void;
  readonly collapsed: ReadonlySet<string>;
  readonly onCollapse: (value: ReadonlySet<string>) => void;
}) {
  const t = useTranslate();
  const toast = useToast();
  const deleted = useDeletedDecks();
  const actions = useDeckActions();
  const [errors, setErrors] = useState<Record<string, unknown>>({});
  const [refreshSince, setRefreshSince] = useState<number | null>(null);
  const awaitingRefresh = refreshSince !== null && deleted.dataUpdatedAt <= refreshSince;
  const query = useSearch(browse.typed);
  const index = useMemo(
    () => indexDeletedDecks(deleted.data ?? EMPTY_ROWS, browse.sort),
    [deleted.data, browse.sort],
  );
  const result = useMemo(
    () => browseDeletedDecks(index, query, collapsed),
    [index, query, collapsed],
  );

  async function refresh() {
    const result = await deleted.refetch();
    if (result.isSuccess) setRefreshSince(null);
  }

  async function restore(deck: DeletedDeck) {
    setErrors((current) => ({ ...current, [deck.id]: undefined }));
    try {
      const result = await actions.restore.mutateAsync(deck.id);
      setRefreshSince(deleted.dataUpdatedAt);
      if (result.restored > 0) toast.show(t('deleted.deckRestored', { name: deck.name }));
      await refresh();
    } catch (error) {
      setErrors((current) => ({ ...current, [deck.id]: error }));
      void refresh();
    }
  }

  if (deleted.isPending) return <SkeletonRows rows={5} />;
  if (deleted.error && !deleted.data)
    return <ReadError error={deleted.error} retry={() => void refresh()} />;
  return (
    <>
      <BrowseControls
        browse={browse}
        onChange={onBrowse}
        kind="decks"
        count={result.count}
        total={index.total}
        query={query}
      />
      {deleted.error && <ReadError error={deleted.error} retry={() => void refresh()} />}
      {index.total === 0 ? (
        <EmptyState
          title={t('deleted.decksEmptyTitle')}
          description={t('deleted.decksEmptyBody')}
        />
      ) : result.count === 0 ? (
        <SearchEmpty />
      ) : (
        <DeletedRows rows={result.rows} resetKey={`${query}:${browse.sort}`}>
          {(deck) => {
            const expanded = !!query || !collapsed.has(deck.id);
            const error = errors[deck.id];
            return (
              <div
                className={deck.depth ? 'border-l border-subtle pl-12' : ''}
                style={{ marginLeft: Math.min(deck.depth, 3) * 12 }}
              >
                <div className="flex min-w-0 flex-col gap-8">
                  <div className={deck.context ? 'opacity-60' : ''}>
                    <Row
                      standalone={false}
                      className={`${collectionSurface(deck.kind)} min-h-72 ${deck.kind === 'folder' ? 'py-12' : 'py-8'} gap-4 px-8`}
                      title={
                        <span
                          className={`block whitespace-normal break-words text-17 leading-snug ${deck.kind === 'folder' ? 'font-semibold' : ''}`}
                        >
                          {deck.name}
                        </span>
                      }
                      subtitle={
                        <span className="block whitespace-normal break-words text-13 leading-read text-secondary">
                          {deck.location
                            ? `${t('deleted.liveContext')}: ${deck.location}`
                            : t(deck.context ? 'deleted.liveContext' : 'deleted.originalLocation')}
                        </span>
                      }
                      leading={
                        deck.children ? (
                          <button
                            type="button"
                            disabled={!!query}
                            className="flex min-h-44 w-56 shrink-0 items-center justify-center gap-4 rounded-12 text-secondary hover:bg-fill-neutral"
                            aria-expanded={expanded}
                            aria-label={t(expanded ? 'library.collapse' : 'library.expand')}
                            onClick={() => {
                              const next = new Set(collapsed);
                              if (!next.delete(deck.id)) next.add(deck.id);
                              onCollapse(next);
                            }}
                          >
                            <ChevronRight
                              size={12}
                              className={`shrink-0 transition-transform dur-control ${expanded ? 'rotate-90' : ''}`}
                              aria-hidden="true"
                            />
                            <CollectionIcon kind={deck.kind} />
                          </button>
                        ) : (
                          <span className="flex size-44 shrink-0 items-center justify-center">
                            <CollectionIcon kind={deck.kind} />
                          </span>
                        )
                      }
                    />
                  </div>
                  {!deck.context && (
                    <div className="flex flex-wrap gap-8 px-12">
                      <Button
                        variant="quiet"
                        busy={actions.restore.isPending && actions.restore.variables === deck.id}
                        disabled={deck.parentDeleted || awaitingRefresh || !!deleted.error}
                        onClick={() => void restore(deck)}
                      >
                        {t('deleted.restore')}
                      </Button>
                      {!deck.supporting && !awaitingRefresh && !deleted.error && (
                        <PurgeAction target="decks" id={deck.id} name={deck.name} />
                      )}
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
                </div>
              </div>
            );
          }}
        </DeletedRows>
      )}
    </>
  );
}

function DeletedNoteList({
  browse,
  onBrowse,
}: {
  readonly browse: Browse;
  readonly onBrowse: (value: Browse) => void;
}) {
  const t = useTranslate();
  const toast = useToast();
  const deleted = useDeletedNotes();
  const actions = useNoteActions();
  const pending = useRef(new Set<string>());
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, unknown>>({});
  const query = useSearch(browse.typed);
  const index = useMemo(() => indexDeletedNotes(deleted.data ?? EMPTY_ROWS), [deleted.data]);
  const sorted = useMemo(() => sortDeleted(index, browse.sort), [index, browse.sort]);
  const rows = useMemo(
    () => sorted.filter((note) => !hidden.has(note.id) && matchesDeleted(note.search, query)),
    [sorted, hidden, query],
  );

  async function restore(note: DeletedNote) {
    if (pending.current.has(note.id)) return;
    pending.current.add(note.id);
    setHidden(new Set(pending.current));
    setErrors((current) => ({ ...current, [note.id]: undefined }));
    try {
      const result = await actions.restore.mutateAsync(note.id);
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
  if (deleted.error && !deleted.data)
    return <ReadError error={deleted.error} retry={() => void deleted.refetch()} />;
  return (
    <>
      <BrowseControls
        browse={browse}
        onChange={onBrowse}
        kind="notes"
        count={rows.length}
        total={index.length}
        query={query}
      />
      {deleted.error && <ReadError error={deleted.error} retry={() => void deleted.refetch()} />}
      {index.length === 0 ? (
        <EmptyState
          title={t('deleted.notesEmptyTitle')}
          description={t('deleted.notesEmptyBody')}
        />
      ) : rows.length === 0 ? (
        <SearchEmpty />
      ) : (
        <DeletedRows rows={rows} resetKey={`${query}:${browse.sort}`}>
          {(note) => <DeletedNoteRow note={note} error={errors[note.id]} onRestore={restore} />}
        </DeletedRows>
      )}
    </>
  );
}

/** Scrolling moves the window without rebuilding surviving Note content. */
const DeletedNoteRow = memo(function DeletedNoteRow({
  note,
  error,
  onRestore,
}: {
  readonly note: ReturnType<typeof indexDeletedNotes>[number];
  readonly error: unknown;
  readonly onRestore: (note: DeletedNote) => Promise<void>;
}) {
  const t = useTranslate();
  const meaning = note.fields['translation'] ?? note.fields['back'];
  const fields = useMemo(
    () =>
      editorFields({ noteType: note.noteType, filled: filledPaths(note.fields) })
        .flatMap((section) => section.fields)
        .filter((field) => {
          const value = readField(note.fields, field.path);
          return (
            !['term', 'front', 'back', 'text', 'translation'].includes(field.path) &&
            value !== undefined &&
            value !== ''
          );
        }),
    [note.noteType, note.fields],
  );
  return (
    <div className="flex min-w-0 flex-col gap-12 rounded-12 border border-subtle bg-card p-12">
      <div className="flex min-w-0 flex-col gap-4">
        <p className="whitespace-pre-wrap break-words text-15 text-primary">{note.title}</p>
        {typeof meaning === 'string' && (
          <p className="whitespace-pre-wrap break-words text-14 text-secondary">{meaning}</p>
        )}
        <p className="break-words text-12 text-secondary">
          {note.location || t('deleted.unknownDeck')}
        </p>
      </div>
      {fields.length > 0 && (
        <Disclosure title={t('deleted.inspect')} quiet>
          <div className="flex flex-col gap-12">
            {fields.map((field) => (
              <NoteField
                key={field.path}
                field={field}
                value={readField(note.fields, field.path)}
                readOnly
              />
            ))}
          </div>
        </Disclosure>
      )}
      <div className="flex flex-wrap gap-8">
        <Button disabled={!note.deckLive} onClick={() => void onRestore(note)}>
          {t('deleted.restore')}
        </Button>
        <PurgeAction target="notes" id={note.id} name={termOf(note.fields)} />
      </div>
      {!note.deckLive && (
        <p className="px-16 pb-8 text-12 text-error">{t('deleted.deckRequired')}</p>
      )}
      {!!error && (
        <p role="alert" className="px-16 pb-8 text-12 text-error">
          {t(describe(error).key, describe(error).values)}
        </p>
      )}
    </div>
  );
});

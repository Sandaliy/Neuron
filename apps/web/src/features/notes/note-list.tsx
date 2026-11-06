import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { Plus, Upload, Trash2, Search } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  NOTE_BROWSE_SORTS,
  NOTE_STATUSES,
  termOf,
  isRecentNoteSort,
  recentNoteTime,
} from '@neuron/shared';
import type {
  MessageKey,
  Note,
  NoteBrowseSort as NoteSort,
  NoteStatus,
  RecentNoteSort,
} from '@neuron/shared';

import { useTranslate, useLocale } from '../../i18n/locale';
import { describe } from '../../lib/api';
import { useCapabilities } from '../../lib/capabilities';
import { findDeck, flatten, useDeckTree } from '../../lib/decks';
import { useLearningNavigation } from '../../lib/learning-navigation';
import { noteEdits } from '../../lib/note-outbox';
import { noteListQuery, useNoteActions } from '../../lib/notes';
import { accountEpoch, useOffline } from '../../lib/offline';
import { useReturnScroll } from '../../lib/return-scroll';
import { Button } from '../../ui/button';
import { Chip } from '../../ui/chip';
import { CollectionHeader } from '../../ui/collection-header';
import { Input } from '../../ui/input';
import { ReadOnlySlot } from '../../ui/read-only-slot';
import { DenseRow } from '../../ui/row';
import { Select } from '../../ui/select';
import { ServerControls } from '../../ui/server-controls';
import { EmptyState, ErrorState, SkeletonRows } from '../../ui/states';
import { SwipeDelete } from '../../ui/swipe-delete';
import { useToast } from '../../ui/toast';
import { CollectionPath } from '../library/collection-path';
import { CollectionSearchPath } from '../library/collection-search-path';
import { NoteCategoryBack } from '../library/note-categories';
import { DeckPractice } from '../today/practice';

import { LearningWave } from './learning-wave';
import { useNoteBrowse } from './note-browse';
import { NoteProgressSummary } from './note-progress';
import { NoteSelectionBar } from './note-selection';
import { PracticeEntry } from './practice-entry';
import { RestartLearning } from './restart-learning';
import { DeckTriage, TriageEntry } from './triage';

import type { NoteCategory } from '../../lib/note-categories';
import type { NoteQuery } from '../../lib/notes';

/** How tall a row is. The virtualiser needs a number before it can measure. */
const ROW_HEIGHT = 52;
const dateFormats = {
  en: new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }),
  ru: new Intl.DateTimeFormat('ru', { dateStyle: 'medium', timeStyle: 'short' }),
};

/**
 * A deck's notes, however many there are.
 *
 * Five thousand rows is a normal size for a frequency list, and rendering five
 * thousand elements is not: the browser lays out every one of them on every
 * frame of a scroll. So only what is on screen is in the document, and the
 * scrollbar is the right length because the container is given the full height
 * in pixels. The measurement is in `tests/performance.spec.ts`.
 *
 * Online search retains server pagination; a complete download uses the same
 * browse query locally. Text filters run a beat after typing stops.
 */
export function NoteListScreen({
  deckId,
  category,
  recent,
}: {
  readonly deckId?: string;
  readonly category?: NoteCategory;
  readonly recent?: 'added' | 'changed';
}) {
  const learning = useLearningNavigation('practice');
  const triage = useLearningNavigation('triage');
  const practicing = learning.active;
  const rememberScroll = useReturnScroll(practicing || triage.active);
  const t = useTranslate();
  const offline = useOffline();
  const toast = useToast();
  const { mutateAsync: deleteNote } = useNoteActions().remove;
  const deleting = useRef(new Set<string>());
  const removeNote = useCallback(
    async (id: string) => {
      if (deleting.current.has(id)) return;
      deleting.current.add(id);
      try {
        await deleteNote(id);
        toast.show(t('note.deleted'));
      } catch (error) {
        toast.show(t(describe(error).key, describe(error).values));
      } finally {
        deleting.current.delete(id);
      }
    },
    [deleteNote, toast, t],
  );
  const navigate = useNavigate();
  const decks = useDeckTree();

  const { state, update } = useNoteBrowse(deckId, category, recent);
  const origin = useRouterState({ select: (state) => state.location.state.noteCategoryOrigin });
  const categoryReturn =
    category && origin?.accountId === offline.accountId && origin.visit === accountEpoch();
  const exactTag = (value: string) =>
    category?.kind === 'tag' && category.value === value ? value : value.trim();
  const exactSource = (value: string) =>
    category?.kind === 'source' && category.value === value ? value : value.trim();
  const {
    search,
    typed,
    sort,
    status,
    cardState,
    tag,
    tagFilter,
    source,
    sourceFilter,
    filtersOpen,
  } = state;
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  // A search runs 300 ms after the last keystroke. Every keystroke would be a
  // request per letter over a table scan.
  useEffect(() => {
    const timer = setTimeout(() => {
      update({
        search: typed.trim(),
        tagFilter: category?.kind === 'tag' && category.value === tag ? tag : tag.trim(),
        sourceFilter:
          category?.kind === 'source' && category.value === source ? source : source.trim(),
      });
    }, 300);

    return () => clearTimeout(timer);
  }, [typed, source, tag, update, category?.kind, category?.value]);

  const query: NoteQuery = {
    ...(deckId === undefined ? {} : { deckId }),
    ...(search === '' ? {} : { search }),
    ...(status === '' ? {} : { status }),
    ...(cardState === '' ? {} : { cardState }),
    ...(tagFilter === '' ? {} : { tag: tagFilter }),
    ...(sourceFilter === '' ? {} : { source: sourceFilter }),
    sort,
  };

  const edits = useQuery({
    queryKey: ['note-outbox', offline.accountId],
    queryFn: () => noteEdits(offline.accountId!),
    enabled: offline.available && isRecentNoteSort(sort),
    networkMode: 'always',
  });
  const pendingEdits = useMemo(
    () =>
      new Set(
        (edits.data ?? [])
          .filter((entry) => !['resolved', 'synchronized'].includes(entry.state))
          .map((entry) => entry.entityId),
      ),
    [edits.data],
  );
  const notes = useInfiniteQuery({
    ...noteListQuery(
      query,
      isRecentNoteSort(sort) && offline.available && pendingEdits.size > 0
        ? edits.dataUpdatedAt
        : undefined,
    ),
    placeholderData: keepPreviousData,
    gcTime: 30 * 60_000,
  });
  const capability = useCapabilities(
    !decks.local &&
      notes.data !== undefined &&
      !notes.isPlaceholderData &&
      !notes.data.pages.some((page) => page.local),
  );
  const serverReady = capability.server;
  // A new Note can be saved on the device into a downloaded Deck, and sent later.
  const canCreate = serverReady || capability.localEdits;
  const unavailable = offline.offline && !offline.available;
  const readOnly = !serverReady;

  /** Which deck the screens next to this one should open with. */
  const deckSearch: { deckId?: string } = deckId === undefined ? {} : { deckId };
  // Saved on this device, not yet on the server: no server action reaches them.
  const unsent = useMemo(
    () => new Set(notes.data?.pages.flatMap((page) => page.unsent ?? []) ?? []),
    [notes.data],
  );
  const rows = useMemo(
    () =>
      unavailable
        ? []
        : [
            ...new Map(
              (notes.data?.pages.flatMap((page) => page.items) ?? []).map((note) => [
                note.id,
                note,
              ]),
            ).values(),
          ],
    [unavailable, notes.data],
  );
  const deck = deckId === undefined ? undefined : findDeck(decks.data ?? [], deckId);
  // Build once per tree, never flatten the hierarchy for each virtual row.
  const locations = useMemo(() => {
    if (deckId !== undefined) return undefined;
    const all = flatten(decks.data ?? []);
    const names = new Map(all.map((item) => [item.id, item.name]));
    return new Map(
      all.map((item) => [
        item.id,
        [
          item.name,
          item.path
            .map((id) => names.get(id))
            .filter(Boolean)
            .join(' / '),
        ]
          .filter(Boolean)
          .join(' · '),
      ]),
    );
  }, [deckId, decks.data]);
  const filtered =
    search !== '' || status !== '' || cardState !== '' || tagFilter !== '' || sourceFilter !== '';

  /** Every tag on what has been loaded, for the filter to offer. */
  const tags = useMemo(() => [...new Set(rows.flatMap((note) => note.tags))].sort(), [rows]);

  function clearFilters() {
    update({
      typed: '',
      search: '',
      status: '',
      cardState: '',
      tag: '',
      tagFilter: '',
      source: '',
      sourceFilter: '',
    });
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);

      if (!next.delete(id)) {
        next.add(id);
      }

      return next;
    });
  }

  if (practicing && deckId)
    return (
      <DeckPractice deckId={deckId} entry={learning.entry ?? 'resume'} onFinish={learning.exit} />
    );
  if (triage.active && deckId) return <DeckTriage deckId={deckId} onFinish={triage.exit} />;
  return (
    <section data-screen="" className="flex flex-col gap-16">
      <CollectionHeader
        readOnly={offline.offline}
        title={
          deck?.name ??
          t(deckId === undefined ? (recent ? 'notes.recent' : 'notes.find') : 'notes.title')
        }
        path={
          categoryReturn ? (
            <NoteCategoryBack />
          ) : deckId ? (
            <CollectionSearchPath tree={decks.data ?? []} id={deckId} />
          ) : (
            <CollectionPath tree={decks.data ?? []} id="" trail />
          )
        }
        actions={
          <>
            <ServerControls available={serverReady}>
              {deck && <RestartLearning deck={deck} />}
            </ServerControls>
            <Button
              variant="quiet"
              onClick={() => void navigate({ to: '/import', search: deckSearch })}
            >
              <Upload size={16} strokeWidth={1.5} aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">{t('notes.import')}</span>
            </Button>
            <ServerControls available={canCreate}>
              <Button
                variant="primary"
                onClick={() => void navigate({ to: '/notes/new', search: deckSearch })}
              >
                <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
                {t('notes.newNote')}
              </Button>
            </ServerControls>
          </>
        }
      >
        {deckId === undefined && (
          <p className="text-14 text-secondary">
            {t(recent ? 'notes.recentHint' : 'notes.findHint')}
          </p>
        )}
        {deck && (
          <div className="flex min-h-44 items-center">
            <ReadOnlySlot readOnly={false} inline>
              <ServerControls available={serverReady}>
                <RestartLearning deck={deck} skillsOnly />
              </ServerControls>
            </ReadOnlySlot>
          </div>
        )}
      </CollectionHeader>
      {deckId && (
        <Button
          variant="text"
          className="self-start"
          onClick={() => void navigate({ to: '/library/duplicates', search: { deckId } })}
        >
          {t('duplicates.title')}
        </Button>
      )}
      {deckId && (
        <PracticeEntry
          deckId={deckId}
          onOpen={(entry) => {
            rememberScroll();
            void learning.open(entry);
          }}
        />
      )}
      {deckId && (
        <TriageEntry
          deckId={deckId}
          noteCount={deck?.noteCount}
          onOpen={() => {
            rememberScroll();
            void triage.open();
          }}
        />
      )}
      {deckId && <LearningWave deckId={deckId} />}

      {(deckId === undefined || (!unavailable && (rows.length > 0 || filtered || typed !== ''))) &&
      !selecting ? (
        <div className="flex flex-col gap-12">
          <div className="relative">
            <Search
              aria-hidden="true"
              size={16}
              className="pointer-events-none absolute left-12 top-16 z-10 text-secondary"
            />
            <Input
              className="pl-40"
              type="search"
              busy={
                notes.isFetching ||
                typed.trim() !== search ||
                source.trim() !== sourceFilter ||
                tag.trim() !== tagFilter
              }
              value={typed}
              aria-label={t('notes.search')}
              placeholder={t('notes.searchPlaceholder')}
              enterKeyHint="search"
              maxLength={100}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  update({
                    search: typed.trim(),
                    tagFilter: exactTag(tag),
                    sourceFilter: exactSource(source),
                  });
                  event.currentTarget.blur();
                }
              }}
              onChange={(event) => update({ typed: event.target.value })}
            />
          </div>
          <div className="flex flex-wrap items-center gap-8">
            <div
              className={
                isRecentNoteSort(sort)
                  ? 'min-w-0 basis-full sm:basis-auto sm:flex-1'
                  : 'min-w-0 flex-1'
              }
            >
              <Select
                value={sort}
                aria-label={t('notes.sort')}
                onChange={(event) => update({ sort: event.target.value as NoteSort })}
              >
                {NOTE_BROWSE_SORTS.map((option) => (
                  <option key={option} value={option}>
                    {t(`notes.sort.${option}` as MessageKey)}
                  </option>
                ))}
              </Select>
            </div>
            {isRecentNoteSort(sort) && (
              <Button
                variant="quiet"
                onClick={() => {
                  void notes.refetch();
                  window.scrollTo(0, 0);
                }}
              >
                {t('notes.refreshRecent')}
              </Button>
            )}
            <Button
              variant="quiet"
              aria-expanded={filtersOpen}
              onClick={() => update({ filtersOpen: !filtersOpen })}
            >
              {t('notes.filters')}
              {filtered ? ' ·' : ''}
            </Button>
            {rows.length > 0 && (
              <ReadOnlySlot readOnly={false} inline>
                <Button
                  variant="quiet"
                  onClick={() => {
                    setSelecting(true);
                    setSelected(new Set());
                  }}
                >
                  {t('notes.select')}
                </Button>
              </ReadOnlySlot>
            )}
          </div>
          {filtersOpen && (
            <div className="flex flex-col gap-12 rounded-12 border border-default p-16">
              <p className="text-13 leading-read text-secondary">{t('notes.progressHint')}</p>
              <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
                <Select
                  value={status}
                  aria-label={t('notes.filterStatus')}
                  onChange={(event) => update({ status: event.target.value as NoteStatus | '' })}
                >
                  <option value="">{t('notes.filterStatus')}</option>
                  {NOTE_STATUSES.map((option) => (
                    <option key={option} value={option}>
                      {t(`note.status.${option}` as MessageKey)}
                    </option>
                  ))}
                </Select>
                <Select
                  value={cardState}
                  aria-label={t('notes.filterCardState')}
                  onChange={(event) => update({ cardState: event.target.value })}
                >
                  <option value="">{t('notes.filterCardState')}</option>
                  {(['new', 'learning', 'review', 'relearning'] as const).map((option) => (
                    <option key={option} value={option}>
                      {t(`cardState.${option}` as MessageKey)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
                <Input
                  value={tag}
                  list="note-tags"
                  aria-label={t('notes.filterTag')}
                  placeholder={t('notes.filterTag')}
                  maxLength={60}
                  onChange={(event) => update({ tag: event.target.value })}
                />
                <datalist id="note-tags">
                  {tags.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
                <Input
                  value={source}
                  aria-label={t('notes.filterSource')}
                  placeholder={t('notes.filterSource')}
                  maxLength={200}
                  onChange={(event) => update({ source: event.target.value })}
                />
              </div>
            </div>
          )}
          {filtered && (
            <Button variant="text" onClick={clearFilters}>
              {t('notes.clearFilters')}
            </Button>
          )}
          <p role="status" className="sr-only">
            {notes.isFetching ||
            typed.trim() !== search ||
            exactSource(source) !== sourceFilter ||
            exactTag(tag) !== tagFilter
              ? t('notes.updating')
              : ''}
          </p>
        </div>
      ) : undefined}

      {deckId === undefined && !unavailable && notes.data?.pages.some((page) => page.local) && (
        <p role="status" className="text-13 text-secondary">
          {t('notes.downloadedResults')}
        </p>
      )}
      {isRecentNoteSort(sort) && pendingEdits.size > 0 && (
        <p role="status" className="text-13 text-secondary">
          {t('notes.pendingRecent')}
        </p>
      )}
      {unavailable && (
        <p role="status" className="text-14 text-secondary">
          {t('offline.incomplete')}
        </p>
      )}
      {!unavailable &&
      (notes.isPending ||
        (rows.length === 0 &&
          notes.isFetching &&
          !notes.data?.pages.some((page) => page.local))) ? (
        <SkeletonRows rows={8} />
      ) : undefined}

      {!unavailable && notes.error && rows.length === 0 ? (
        <ErrorState
          message={
            readOnly
              ? t('offline.missing')
              : t(describe(notes.error).key, describe(notes.error).values)
          }
          retryLabel={t('common.retry')}
          onRetry={() => void notes.refetch()}
        />
      ) : undefined}

      {!unavailable &&
      notes.data &&
      rows.length === 0 &&
      (!notes.isFetching || notes.data.pages.some((page) => page.local)) &&
      !notes.isPlaceholderData &&
      !notes.error ? (
        filtered ? (
          <EmptyState
            title={t('notes.noMatchTitle')}
            description={t('notes.noMatchBody')}
            action={
              <Button variant="quiet" onClick={clearFilters}>
                {t('notes.clearFilters')}
              </Button>
            }
          />
        ) : (
          <EmptyState
            title={t('notes.emptyTitle')}
            description={t(readOnly ? 'offline.empty' : 'notes.emptyBody')}
            action={
              canCreate && (
                <Button
                  variant="primary"
                  onClick={() => void navigate({ to: '/notes/new', search: deckSearch })}
                >
                  {t('notes.newNote')}
                </Button>
              )
            }
          />
        )
      ) : undefined}

      {selecting ? (
        <NoteSelectionBar
          available={serverReady}
          ids={[...selected]}
          notes={rows.filter((note) => selected.has(note.id))}
          {...(deckId === undefined ? {} : { deckId })}
          onSelectAll={() =>
            setSelected(new Set(rows.filter((note) => !unsent.has(note.id)).map((note) => note.id)))
          }
          onClear={() => setSelected(new Set())}
          onDone={() => {
            setSelected(new Set());
            setSelecting(false);
          }}
        />
      ) : undefined}
      {rows.length > 0 ? (
        <VirtualNotes
          key={deckId ?? 'all'}
          rows={rows}
          locations={locations}
          unsent={unsent}
          pendingEdits={pendingEdits}
          dateSort={isRecentNoteSort(sort) ? sort : undefined}
          onRemove={removeNote}
          selecting={selecting}
          readOnly={readOnly}
          layoutKey={`${selecting}:${filtersOpen}:${filtered}`}
          selected={selected}
          onToggle={toggle}
          onOpen={(id) =>
            void navigate({
              to: '/notes/$noteId',
              params: { noteId: id },
              ...(deckId === undefined
                ? {
                    state: {
                      noteSearchOrigin: {
                        accountId: offline.accountId,
                        visit: accountEpoch(),
                        ...(recent ? { recent: true } : {}),
                      },
                    },
                  }
                : {}),
            })
          }
          hasMore={notes.hasNextPage}
          onNeedMore={() => {
            if (notes.hasNextPage && !notes.isFetching) {
              void notes.fetchNextPage({ cancelRefetch: false });
            }
          }}
        />
      ) : undefined}
    </section>
  );
}

/**
 * The rows, of which only the ones on screen are in the document.
 *
 * A window virtualiser rather than a scrolling box, because the page itself is
 * what scrolls: the tab bar floats over it and the browser's own toolbar hides
 * and shows with the scroll, and a nested scroller would break both.
 */
function VirtualNotes({
  readOnly,
  unsent,
  pendingEdits,
  dateSort,
  rows,
  locations,
  selecting,
  layoutKey,
  selected,
  onToggle,
  onOpen,
  onRemove,
  hasMore,
  onNeedMore,
}: {
  readonly readOnly: boolean;
  readonly unsent: ReadonlySet<string>;
  readonly pendingEdits: ReadonlySet<string>;
  readonly dateSort: RecentNoteSort | undefined;
  readonly rows: readonly Note[];
  readonly locations: ReadonlyMap<string, string> | undefined;
  readonly selecting: boolean;
  readonly selected: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
  readonly onOpen: (id: string) => void;
  readonly onRemove: (id: string) => Promise<void>;
  readonly layoutKey: string;
  readonly hasMore: boolean;
  readonly onNeedMore: () => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [swipe, setSwipe] = useState<{ selecting: boolean; id: string | null }>({
    selecting,
    id: null,
  });
  if (swipe.selecting !== selecting) setSwipe({ selecting, id: null });
  const revealed = swipe.selecting === selecting ? swipe.id : null;
  const setRevealed = useCallback((id: string | null) => setSwipe({ selecting, id }), [selecting]);
  const [offset, setOffset] = useState(0);

  // Where the list starts down the page. The window virtualiser needs it to
  // work out which rows are on screen.
  useEffect(() => {
    const measure = () =>
      setOffset(list.current ? list.current.getBoundingClientRect().top + window.scrollY : 0);
    measure();
    const observer = new ResizeObserver(measure);
    if (list.current?.parentElement) observer.observe(list.current.parentElement);
    return () => observer.disconnect();
  }, [rows.length, layoutKey, selected.size]);

  const virtual = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => ROW_HEIGHT + (locations ? 24 : 0) + (dateSort ? 24 : 0),
    overscan: 8,
    scrollMargin: offset,
  });
  useEffect(() => virtual.measure(), [virtual, dateSort, locations]);

  const items = virtual.getVirtualItems();
  const last = items.at(-1);

  // The next page is asked for while there are still rows below the fold, so
  // it has usually landed by the time the scroll reaches them.
  useEffect(() => {
    if (hasMore && last && last.index >= rows.length - 50) {
      onNeedMore();
    }
  }, [hasMore, last, rows.length, onNeedMore]);

  return (
    <div
      ref={list}
      data-g="card"
      data-rows=""
      className="overflow-hidden rounded-24 border border-glass"
    >
      <div className="relative w-full" style={{ height: `${virtual.getTotalSize()}px` }}>
        {items.map((item) => {
          const note = rows[item.index];

          if (!note) {
            return undefined;
          }

          return (
            <div
              key={note.id}
              className="absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${item.start - virtual.options.scrollMargin}px)` }}
            >
              <NoteRow
                note={note}
                location={locations ? (locations.get(note.deckId) ?? '') : undefined}
                readOnly={readOnly || unsent.has(note.id)}
                unsent={unsent.has(note.id)}
                pendingEdit={pendingEdits.has(note.id)}
                dateSort={dateSort}
                selecting={selecting}
                selected={selected.has(note.id)}
                onToggle={onToggle}
                onOpen={onOpen}
                onRemove={onRemove}
                revealed={!readOnly && !unsent.has(note.id) && !selecting && revealed === note.id}
                onReveal={setRevealed}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Scroll updates move the window, but do not change the surviving notes. */
const NoteRow = memo(function NoteRow({
  readOnly,
  unsent,
  pendingEdit,
  dateSort,
  note,
  location,
  selecting,
  selected,
  onToggle,
  onOpen,
  onRemove,
  revealed,
  onReveal,
}: {
  readonly readOnly: boolean;
  readonly unsent: boolean;
  readonly pendingEdit: boolean;
  readonly dateSort: RecentNoteSort | undefined;
  readonly note: Note;
  readonly location: string | undefined;
  readonly selecting: boolean;
  readonly selected: boolean;
  readonly onToggle: (id: string) => void;
  readonly onOpen: (id: string) => void;
  readonly onRemove: (id: string) => Promise<void>;
  readonly revealed: boolean;
  readonly onReveal: (id: string | null) => void;
}) {
  const t = useTranslate();
  const { locale } = useLocale();
  const toast = useToast();
  const meaning =
    typeof note.fields['translation'] === 'string'
      ? note.fields['translation']
      : typeof note.fields['back'] === 'string'
        ? note.fields['back']
        : note.tags.join(', ');
  const path = location === '' ? t('notes.locationUnavailable') : location;
  return (
    <>
      <SwipeDelete
        label={t('note.delete')}
        disabled={selecting || readOnly}
        open={revealed}
        onOpen={(open) => onReveal(open ? note.id : null)}
        onDelete={() => {
          onReveal(null);
          return onRemove(note.id);
        }}
      >
        <DenseRow
          selected={selecting ? selected : undefined}
          word={termOf(note.fields)}
          meaning={
            <>
              {meaning}
              {path !== undefined && <span className="sr-only"> · {path}</span>}
            </>
          }
          onClick={() =>
            revealed
              ? onReveal(null)
              : selecting
                ? unsent
                  ? toast.show(t('offline.serverRequired'))
                  : onToggle(note.id)
                : onOpen(note.id)
          }
          trailing={
            <>
              {unsent || (dateSort && pendingEdit) ? (
                <span className="shrink-0 text-12 text-secondary">{t('offline.note.saved')}</span>
              ) : note.status !== 'active' ? (
                <Chip tone="new">{t(`note.status.${note.status}`)}</Chip>
              ) : (
                <NoteProgressSummary counts={note.cardStates} />
              )}
              {selecting && (
                <span
                  aria-hidden="true"
                  data-selected={selected ? '' : undefined}
                  className={[
                    'flex size-20 shrink-0 items-center justify-center rounded-8 border',
                    selected ? 'border-accent bg-fill-accent' : 'border-default',
                  ].join(' ')}
                />
              )}
            </>
          }
        />
        {!selecting && (
          <button
            type="button"
            aria-label={t('note.delete')}
            data-direct-delete=""
            aria-disabled={readOnly || undefined}
            style={{ visibility: revealed ? 'hidden' : undefined }}
            title={t('note.delete')}
            className="flex size-44 shrink-0 items-center justify-center self-center rounded-12 text-tertiary hover:text-error active:bg-fill-error-quiet active:scale-95"
            onClick={() => {
              if (readOnly) {
                toast.show(t('offline.serverRequired'));
                return;
              }
              onReveal(null);
              onRemove(note.id);
            }}
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        )}
      </SwipeDelete>
      {path !== undefined && (
        <p aria-hidden="true" title={path} className="h-24 truncate px-16 text-12 text-secondary">
          {path}
        </p>
      )}
      {dateSort && (
        <p className="h-24 truncate px-16 text-12 text-secondary">
          {t(dateSort === 'created-desc' ? 'notes.addedAt' : 'notes.changedAt')}{' '}
          <time dateTime={recentNoteTime(note, dateSort)} title={recentNoteTime(note, dateSort)}>
            {dateFormats[locale].format(new Date(recentNoteTime(note, dateSort)))}
          </time>
        </p>
      )}
    </>
  );
});

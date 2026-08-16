import { useInfiniteQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { NOTE_SORTS, NOTE_STATUSES, termOf } from '@neuron/shared';
import type { MessageKey, Note, NoteSort, NoteStatus } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { describe, request } from '../../lib/api';
import { findDeck, useDeckTree } from '../../lib/decks';
import { NOTE_KEY, noteQueryString } from '../../lib/notes';
import { Button } from '../../ui/button';
import { Chip } from '../../ui/chip';
import { Input } from '../../ui/input';
import { DenseRow } from '../../ui/row';
import { Select } from '../../ui/select';
import { EmptyState, ErrorState, SkeletonRows } from '../../ui/states';

import { NoteSelectionBar } from './note-selection';

import type { NoteQuery } from '../../lib/notes';

/** How many rows one request brings back. Five thousand notes are five of them. */
const PAGE = 1000;

/** How tall a row is. The virtualiser needs a number before it can measure. */
const ROW_HEIGHT = 52;

/**
 * A deck's notes, however many there are.
 *
 * Five thousand rows is a normal size for a frequency list, and rendering five
 * thousand elements is not: the browser lays out every one of them on every
 * frame of a scroll. So only what is on screen is in the document, and the
 * scrollbar is the right length because the container is given the full height
 * in pixels. The measurement is in `tests/performance.spec.ts`.
 *
 * Searching and filtering happen on the server, because the client does not
 * hold the whole collection and will not until sync lands in phase 8. The
 * search is sent a beat after the typing stops rather than on every keystroke.
 */
export function NoteListScreen({ deckId }: { readonly deckId?: string }) {
  const t = useTranslate();
  const navigate = useNavigate();
  const decks = useDeckTree();

  const [search, setSearch] = useState('');
  const [typed, setTyped] = useState('');
  const [sort, setSort] = useState<NoteSort>('created');
  const [status, setStatus] = useState<NoteStatus | ''>('');
  const [cardState, setCardState] = useState('');
  const [tag, setTag] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  // A search runs 300 ms after the last keystroke. Every keystroke would be a
  // request per letter over a table scan.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(typed), 300);

    return () => clearTimeout(timer);
  }, [typed]);

  const query: NoteQuery = {
    ...(deckId === undefined ? {} : { deckId }),
    ...(search === '' ? {} : { search }),
    ...(status === '' ? {} : { status }),
    ...(cardState === '' ? {} : { cardState }),
    ...(tag === '' ? {} : { tag }),
    sort,
  };

  const notes = useInfiniteQuery({
    queryKey: [NOTE_KEY, 'list', noteQueryString(query)],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      request<{ items: Note[]; nextCursor?: string }>(
        `/notes?${noteQueryString(query, {
          limit: String(PAGE),
          ...(pageParam === undefined ? {} : { cursor: pageParam }),
        })}`,
      ),
    getNextPageParam: (last) => last.nextCursor,
  });

  /** Which deck the screens next to this one should open with. */
  const deckSearch: { deckId?: string } = deckId === undefined ? {} : { deckId };
  const rows = notes.data?.pages.flatMap((page) => page.items) ?? [];
  const deck = deckId === undefined ? undefined : findDeck(decks.data ?? [], deckId);
  const filtered = search !== '' || status !== '' || cardState !== '' || tag !== '';

  /** Every tag on what has been loaded, for the filter to offer. */
  const tags = [...new Set(rows.flatMap((note) => note.tags))].sort();

  function clearFilters() {
    setTyped('');
    setSearch('');
    setStatus('');
    setCardState('');
    setTag('');
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

  return (
    <section data-screen="" className="flex flex-col gap-16">
      <header className="flex items-center justify-between gap-12">
        <div className="flex min-w-0 flex-col gap-4">
          <h1 className="truncate font-display text-24 tracking-tight text-primary">
            {deck?.name ?? t('notes.title')}
          </h1>
          <p className="text-13 text-tertiary" data-numeric="">
            {notes.hasNextPage
              ? t('notes.countMore', { count: rows.length })
              : t('notes.count', { count: rows.length })}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-8">
          <Button
            variant="primary"
            onClick={() => void navigate({ to: '/notes/new', search: deckSearch })}
          >
            <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
            {t('notes.newNote')}
          </Button>
        </div>
      </header>

      <Input
        type="search"
        value={typed}
        aria-label={t('notes.search')}
        placeholder={t('notes.searchPlaceholder')}
        enterKeyHint="search"
        onChange={(event) => setTyped(event.target.value)}
      />

      <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
        <Select
          value={sort}
          aria-label={t('notes.sort')}
          onChange={(event) => setSort(event.target.value as NoteSort)}
        >
          {NOTE_SORTS.map((option) => (
            <option key={option} value={option}>
              {t(`notes.sort.${option}` as MessageKey)}
            </option>
          ))}
        </Select>

        <Select
          value={status}
          aria-label={t('notes.filterStatus')}
          onChange={(event) => setStatus(event.target.value as NoteStatus | '')}
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
          onChange={(event) => setCardState(event.target.value)}
        >
          <option value="">{t('notes.filterCardState')}</option>
          {(['new', 'learning', 'review', 'relearning'] as const).map((option) => (
            <option key={option} value={option}>
              {t(`cardState.${option}` as MessageKey)}
            </option>
          ))}
        </Select>

        <Select
          value={tag}
          aria-label={t('notes.filterTag')}
          onChange={(event) => setTag(event.target.value)}
        >
          <option value="">{t('notes.filterTag')}</option>
          {tags.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex items-center justify-between gap-8">
        <Button
          variant="text"
          onClick={() => {
            setSelecting(!selecting);
            setSelected(new Set());
          }}
        >
          {selecting ? t('notes.selectDone') : t('notes.select')}
        </Button>

        {filtered ? (
          <Button variant="text" onClick={clearFilters}>
            {t('notes.clearFilters')}
          </Button>
        ) : undefined}
      </div>

      {notes.isPending ? <SkeletonRows rows={8} /> : undefined}

      {notes.error && !notes.data ? (
        <ErrorState
          message={t(describe(notes.error).key, describe(notes.error).values)}
          retryLabel={t('common.retry')}
          onRetry={() => void notes.refetch()}
        />
      ) : undefined}

      {notes.data && rows.length === 0 ? (
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
            description={t('notes.emptyBody')}
            action={
              <Button
                variant="primary"
                onClick={() => void navigate({ to: '/notes/new', search: deckSearch })}
              >
                {t('notes.newNote')}
              </Button>
            }
          />
        )
      ) : undefined}

      {rows.length > 0 ? (
        <VirtualNotes
          rows={rows}
          selecting={selecting}
          selected={selected}
          onToggle={toggle}
          onOpen={(id) => void navigate({ to: '/notes/$noteId', params: { noteId: id } })}
          hasMore={notes.hasNextPage}
          onNeedMore={() => {
            if (notes.hasNextPage && !notes.isFetchingNextPage) {
              void notes.fetchNextPage();
            }
          }}
        />
      ) : undefined}

      {selecting ? (
        <NoteSelectionBar
          ids={[...selected]}
          {...(deckId === undefined ? {} : { deckId })}
          onSelectAll={() => setSelected(new Set(rows.map((note) => note.id)))}
          onClear={() => setSelected(new Set())}
          onDone={() => {
            setSelected(new Set());
            setSelecting(false);
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
  rows,
  selecting,
  selected,
  onToggle,
  onOpen,
  hasMore,
  onNeedMore,
}: {
  readonly rows: readonly Note[];
  readonly selecting: boolean;
  readonly selected: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
  readonly onOpen: (id: string) => void;
  readonly hasMore: boolean;
  readonly onNeedMore: () => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);

  // Where the list starts down the page. The window virtualiser needs it to
  // work out which rows are on screen.
  useEffect(() => {
    setOffset(list.current?.offsetTop ?? 0);
  }, [rows.length]);

  const virtual = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    scrollMargin: offset,
  });

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
    <div ref={list} data-g="card" data-rows="" className="overflow-hidden rounded-24 border">
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
                selecting={selecting}
                selected={selected.has(note.id)}
                onToggle={onToggle}
                onOpen={onOpen}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One note: what it says, and what its cards are doing. */
function NoteRow({
  note,
  selecting,
  selected,
  onToggle,
  onOpen,
}: {
  readonly note: Note;
  readonly selecting: boolean;
  readonly selected: boolean;
  readonly onToggle: (id: string) => void;
  readonly onOpen: (id: string) => void;
}) {
  const t = useTranslate();
  const meaning =
    typeof note.fields['translation'] === 'string'
      ? note.fields['translation']
      : typeof note.fields['back'] === 'string'
        ? note.fields['back']
        : note.tags.join(', ');

  return (
    <DenseRow
      word={termOf(note.fields)}
      meaning={meaning}
      onClick={() => (selecting ? onToggle(note.id) : onOpen(note.id))}
      trailing={
        selecting ? (
          <span
            aria-hidden="true"
            data-selected={selected ? '' : undefined}
            className={[
              'flex size-20 shrink-0 items-center justify-center rounded-8 border',
              selected ? 'border-accent bg-fill-accent' : 'border-default',
            ].join(' ')}
          />
        ) : note.status === 'known' ? (
          <Chip tone="plain">{t('note.status.known')}</Chip>
        ) : undefined
      }
    />
  );
}

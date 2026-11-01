import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { List, Search, Undo2 } from 'lucide-react';
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';

import {
  TRIAGE_DECISIONS,
  WAVE_SIZE,
  countTriage,
  nextInTriage,
  normaliseTerm,
  orderTriage,
} from '@neuron/shared';
import type {
  NoteSort,
  TriageChoice,
  TriageCounts,
  TriageDecision,
  TriageItem,
  TriageQueue,
} from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { describe } from '../../lib/api';
import { useOffline } from '../../lib/offline';
import { read, write } from '../../lib/storage';
import { decideTriage, flushTriage, triageQuery, useTriageDecisions } from '../../lib/triage';
import { Button } from '../../ui/button';
import { Card } from '../../ui/card';
import { Input } from '../../ui/input';
import { captureLearningReveal, LearningCard } from '../../ui/learning-card';
import { ModeHeader } from '../../ui/mode-header';
import { Progress } from '../../ui/progress';
import { DenseRow } from '../../ui/row';
import { Select } from '../../ui/select';
import { EmptyState, ErrorState, SkeletonRows } from '../../ui/states';
import { useToast } from '../../ui/toast';

import type { TriageSnapshot } from '../../lib/triage';
import type { ReactNode } from 'react';

/**
 * Triage: going through an imported collection once, deciding for each Note
 * whether it is already known, uncertain, or new.
 *
 * Built for thousands. One tap decides and the next Note is already there; the
 * decision is saved on the device and sent in batches behind the screen. Undo
 * walks back through this visit's decisions, and the list view finds any Note
 * to change its decision later.
 */

const ORDERS: readonly NoteSort[] = ['created', 'rank', 'alpha'];
const FILTERS = ['unsorted', 'known', 'unsure', 'new', 'all'] as const;
type Filter = (typeof FILTERS)[number];
/** Below this, marking Notes one by one in the editor is quicker than a sweep. */
const ENTRY_MINIMUM = 20;
const ROW_HEIGHT = 52;
const EMPTY: readonly TriageItem[] = [];

type Cursor = { readonly id: string } | 'start' | 'end';
interface Visit {
  cursor: Cursor;
  queue: TriageQueue;
  history: { id: string; previous: TriageChoice }[];
}
/** Where a sweep stands, kept while the app is open, so opening a Note and coming back resumes it. */
const visits = new Map<string, Visit>();

const orderKey = (deckId: string) => `neuron.triage.order:${deckId}`;
function storedOrder(deckId: string): NoteSort {
  const value = read(orderKey(deckId));
  return ORDERS.includes(value as NoteSort) ? (value as NoteSort) : 'created';
}

function useChoices(items: readonly TriageItem[], decisions: TriageSnapshot) {
  const choiceOf = useCallback(
    (item: TriageItem) => decisions.pending.get(item.id) ?? item.choice,
    [decisions.pending],
  );
  const counts = useMemo(() => countTriage(items, choiceOf), [items, choiceOf]);
  return { choiceOf, counts };
}

export function DeckTriage({
  deckId,
  onFinish,
}: {
  readonly deckId: string;
  readonly onFinish: () => void;
}) {
  const t = useTranslate();
  const toast = useToast();
  const navigate = useNavigate();
  const client = useQueryClient();
  const offline = useOffline();
  const query = useQuery(triageQuery(deckId));
  const decisions = useTriageDecisions();
  const items = query.data?.items ?? EMPTY;
  const [sort, setSort] = useState<NoteSort>(() => storedOrder(deckId));
  const order = useMemo(() => orderTriage(items, sort), [items, sort]);
  const positions = useMemo(() => new Map(order.map((item, index) => [item.id, index])), [order]);
  const { choiceOf, counts } = useChoices(order, decisions);
  const [visit, setVisit] = useState<Visit>(
    () => visits.get(deckId) ?? { cursor: 'start', queue: 'unsorted', history: [] },
  );
  const [view, setView] = useState<'cards' | 'list'>('cards');
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    visits.set(deckId, visit);
  }, [deckId, visit]);

  const seenSkips = useRef(decisions.skipped);
  useEffect(() => {
    if (decisions.skipped > seenSkips.current)
      toast.show(t('triage.skipped', { count: decisions.skipped - seenSkips.current }));
    seenSkips.current = decisions.skipped;
  }, [decisions.skipped, toast, t]);

  const { queue, cursor, history } = visit;
  const wrap = queue === 'unsorted';
  const first = () => nextInTriage(order, choiceOf, queue, -1, wrap);
  const index =
    cursor === 'end'
      ? // Unsorted is a set, not a pass: it is finished only when it is empty.
        wrap
        ? first()
        : -1
      : cursor === 'start'
        ? first()
        : (positions.get(cursor.id) ?? first());
  const current = index >= 0 ? order[index] : undefined;
  const total = order.length;
  const sorted = total - counts.unsorted;
  const passLeft = useMemo(
    () =>
      queue === 'unsure' && index >= 0
        ? order.slice(index).filter((item) => choiceOf(item) === 'unsure').length
        : 0,
    [queue, index, order, choiceOf],
  );

  function move(next: Cursor, changes: Partial<Visit> = {}) {
    setVisit((value) => ({ ...value, ...changes, cursor: next }));
    setRevealed(false);
  }

  function decide(choice: TriageDecision) {
    if (!current) return;
    const previous = choiceOf(current);
    decideTriage(current.id, choice);
    const after = (item: TriageItem) => (item.id === current.id ? choice : choiceOf(item));
    const next = nextInTriage(order, after, queue, index, wrap);
    move(next >= 0 ? { id: order[next]!.id } : 'end', {
      history: [...history.slice(-499), { id: current.id, previous }],
    });
  }

  function undo() {
    const last = history.at(-1);
    if (!last) return;
    decideTriage(last.id, last.previous);
    move({ id: last.id }, { history: history.slice(0, -1) });
  }

  function finish() {
    flushTriage();
    // The browse list under this screen shows statuses; it reads them again on the way back.
    void client.invalidateQueries({ queryKey: ['notes', 'list'] });
    onFinish();
  }

  function changeOrder(next: NoteSort) {
    setSort(next);
    write(orderKey(deckId), next);
  }

  const sweeping = view === 'cards' && !!query.data && total > 0;
  useEffect(() => {
    if (!sweeping) return;
    const handler = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement ||
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      const decision = TRIAGE_DECISIONS[Number(event.key) - 1];
      if (decision && current) {
        event.preventDefault();
        decide(decision);
      } else if (event.code === 'Space' && current && !revealed) {
        event.preventDefault();
        setRevealed(true);
      } else if (event.key === 'Backspace' && history.length) {
        event.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  if (!query.data) {
    return (
      <section data-screen="" className="flex flex-col gap-16">
        <ModeHeader title={t('triage.title')} exitLabel={t('triage.exit')} onExit={finish} />
        {offline.offline && !offline.available ? (
          <p role="status" className="text-14 text-secondary">
            {t('offline.incomplete')}
          </p>
        ) : query.error ? (
          <ErrorState
            message={t(describe(query.error).key, describe(query.error).values)}
            retryLabel={t('common.retry')}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <SkeletonRows rows={4} />
        )}
      </section>
    );
  }

  if (total === 0)
    return (
      <section data-screen="" className="flex flex-col gap-16">
        <ModeHeader title={t('triage.title')} exitLabel={t('triage.exit')} onExit={finish} />
        <EmptyState
          title={t('triage.emptyTitle')}
          description={t('triage.emptyBody')}
          action={<Button onClick={finish}>{t('common.back')}</Button>}
        />
        <Excluded studied={query.data.studied} setAside={query.data.setAside} />
      </section>
    );

  if (view === 'list')
    return (
      <TriageList
        items={order}
        excluded={<Excluded studied={query.data.studied} setAside={query.data.setAside} />}
        choiceOf={choiceOf}
        sorted={sorted}
        sort={sort}
        onSort={changeOrder}
        onBack={() => setView('cards')}
        onOpen={(id) => {
          move({ id });
          setView('cards');
        }}
      />
    );

  return (
    <section
      data-screen=""
      data-learning-screen=""
      data-triage-screen=""
      className="neu-session flex flex-col gap-16"
    >
      <ModeHeader
        title={t('triage.title')}
        exitLabel={t('triage.exit')}
        onExit={finish}
        value={sorted}
        max={total}
        progressLabel={t('triage.progress')}
        action={
          <div className="flex items-center gap-4">
            <Button
              variant="text"
              className="w-44 text-secondary"
              aria-label={t('triage.undo')}
              title={t('triage.undo')}
              disabled={!history.length}
              onClick={undo}
            >
              <Undo2 size={20} strokeWidth={1.5} aria-hidden="true" />
            </Button>
            <Button
              variant="text"
              className="w-44 text-secondary"
              aria-label={t('triage.list')}
              title={t('triage.list')}
              onClick={() => setView('list')}
            >
              <List size={20} strokeWidth={1.5} aria-hidden="true" />
            </Button>
          </div>
        }
      />
      <div className="neu-practice-progress flex shrink-0 items-baseline justify-between gap-16 text-12 text-secondary">
        <span data-numeric="">
          {t('triage.left', { count: queue === 'unsure' ? passLeft : counts.unsorted })}
        </span>
        <span role="status" className="min-w-0 truncate text-right">
          {decisions.delivery === 'waiting' ? t('triage.waiting') : ''}
        </span>
      </div>
      {current ? (
        <TriageCard
          item={current}
          position={index + 1}
          total={total}
          choice={choiceOf(current)}
          counts={counts}
          revealed={revealed}
          onReveal={() => setRevealed(true)}
          onOpen={() => {
            flushTriage();
            void navigate({ to: '/notes/$noteId', params: { noteId: current.id } });
          }}
          onDecide={decide}
        />
      ) : (
        <TriageDone
          queue={queue}
          counts={counts}
          excluded={<Excluded studied={query.data.studied} setAside={query.data.setAside} />}
          onUnsure={() => move('start', { queue: 'unsure' })}
          onList={() => setView('list')}
          onFinish={finish}
        />
      )}
    </section>
  );
}

/** One Note in the sweep and the three decisions under it, at thumb height. */
export function TriageCard({
  item,
  position,
  total,
  choice,
  counts,
  revealed,
  onReveal,
  onOpen,
  onDecide,
}: {
  readonly item: TriageItem;
  readonly position: number;
  readonly total: number;
  readonly choice: TriageChoice;
  readonly counts: TriageCounts;
  readonly revealed: boolean;
  readonly onReveal: () => void;
  readonly onOpen: () => void;
  readonly onDecide: (choice: TriageDecision) => void;
}) {
  const t = useTranslate();
  return (
    <>
      <LearningCard
        key={item.id}
        identity={item.id}
        context={
          <span className="flex items-baseline justify-between gap-8">
            <span data-numeric="">
              {t('triage.position', { position, total })}
              {item.rank === null ? '' : ` · ${t('triage.rank', { rank: item.rank })}`}
            </span>
            {choice !== 'unsorted' && (
              <span>{t('triage.current', { choice: t(`triage.${choice}`) })}</span>
            )}
          </span>
        }
        prompt={
          <span className="flex flex-col gap-8">
            <span>{item.term}</span>
            {item.detail && <span className="text-17 text-secondary">{item.detail}</span>}
          </span>
        }
        answer={revealed ? <span>{item.meaning}</span> : undefined}
        response={
          <div className="flex shrink-0 items-center justify-between gap-8">
            <Button
              variant="text"
              className={revealed ? 'invisible' : undefined}
              aria-hidden={revealed || undefined}
              tabIndex={revealed ? -1 : undefined}
              onClick={(event) => {
                captureLearningReveal(event.currentTarget);
                onReveal();
              }}
            >
              {t('triage.showMeaning')}
            </Button>
            <Button variant="text" onClick={onOpen}>
              {t('triage.openNote')}
            </Button>
          </div>
        }
      />
      <div className="neu-learning-actions grid grid-cols-3 gap-8">
        {TRIAGE_DECISIONS.map((decision, at) => (
          <Button
            key={decision}
            layout="stacked"
            aria-keyshortcuts={String(at + 1)}
            className="min-w-0 border-strong px-4 py-8 text-primary"
            onClick={() => onDecide(decision)}
          >
            <span>{t(`triage.${decision}`)}</span>
            <span className="text-12 font-normal text-tertiary" data-numeric="">
              {counts[decision]}
            </span>
          </Button>
        ))}
      </div>
    </>
  );
}

export function TriageDone({
  queue,
  counts,
  excluded,
  onUnsure,
  onList,
  onFinish,
}: {
  readonly queue: TriageQueue;
  readonly counts: TriageCounts;
  readonly excluded?: ReactNode;
  readonly onUnsure: () => void;
  readonly onList: () => void;
  readonly onFinish: () => void;
}) {
  const t = useTranslate();
  return (
    <>
      <div className="neu-reveal my-auto flex flex-col items-center gap-16 py-32 text-center">
        <h2 className="text-24 text-primary">
          {t(queue === 'unsure' ? 'triage.unsureDoneTitle' : 'triage.doneTitle')}
        </h2>
        <p className="text-14 text-secondary" data-numeric="">
          {t('triage.doneBody', { known: counts.known, unsure: counts.unsure, new: counts.new })}
        </p>
        <p className="max-w-[38ch] text-14 leading-body text-secondary">
          {t('triage.doneHint', { size: WAVE_SIZE })}
        </p>
        {excluded}
      </div>
      <div className="neu-learning-actions flex flex-col gap-8">
        {queue === 'unsorted' && counts.unsure > 0 && (
          <Button full variant="quiet" onClick={onUnsure}>
            {t('triage.reviewUnsure', { count: counts.unsure })}
          </Button>
        )}
        <Button full variant="quiet" onClick={onList}>
          {t('triage.reviewAll')}
        </Button>
        <Button full variant="primary" onClick={onFinish}>
          {t('triage.done')}
        </Button>
      </div>
    </>
  );
}

function Excluded({ studied, setAside }: { readonly studied: number; readonly setAside: number }) {
  const t = useTranslate();
  if (!studied && !setAside) return null;
  return (
    <div className="flex flex-col gap-4 text-13 text-secondary" data-numeric="">
      {studied > 0 && <p>{t('triage.excludedStudied', { count: studied })}</p>}
      {setAside > 0 && <p>{t('triage.excludedAside', { count: setAside })}</p>}
    </div>
  );
}

/** Every Note in the sweep, to find one and change what was decided about it. */
function TriageList({
  items,
  excluded,
  choiceOf,
  sorted,
  sort,
  onSort,
  onBack,
  onOpen,
}: {
  readonly items: readonly TriageItem[];
  readonly excluded: ReactNode;
  readonly choiceOf: (item: TriageItem) => TriageChoice;
  readonly sorted: number;
  readonly sort: NoteSort;
  readonly onSort: (sort: NoteSort) => void;
  readonly onBack: () => void;
  readonly onOpen: (id: string) => void;
}) {
  const t = useTranslate();
  const [filter, setFilter] = useState<Filter>('all');
  const [typed, setTyped] = useState('');
  const search = useDeferredValue(normaliseTerm(typed));
  const rows = useMemo(
    () =>
      items.filter((item) => {
        const choice = choiceOf(item);
        if (filter !== 'all' && choice !== filter) return false;
        return (
          !search ||
          normaliseTerm(item.term).includes(search) ||
          normaliseTerm(item.meaning).includes(search)
        );
      }),
    [items, choiceOf, filter, search],
  );

  return (
    <section data-screen="" data-triage-list="" className="flex flex-col gap-16">
      <ModeHeader
        title={t('triage.listTitle')}
        exitLabel={t('triage.backToCards')}
        onExit={onBack}
        value={sorted}
        max={items.length}
        progressLabel={t('triage.progress')}
      />
      <div className="relative">
        <Search
          aria-hidden="true"
          size={16}
          className="pointer-events-none absolute top-16 left-12 text-secondary"
        />
        <Input
          className="pl-40"
          type="search"
          value={typed}
          aria-label={t('triage.search')}
          placeholder={t('triage.searchPlaceholder')}
          enterKeyHint="search"
          onChange={(event) => setTyped(event.target.value)}
        />
      </div>
      <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
        <Select
          value={filter}
          aria-label={t('triage.filter')}
          onChange={(event) => setFilter(event.target.value as Filter)}
        >
          {FILTERS.map((option) => (
            <option key={option} value={option}>
              {t(`triage.filter.${option}`)}
            </option>
          ))}
        </Select>
        <Select
          value={sort}
          aria-label={t('triage.order')}
          onChange={(event) => onSort(event.target.value as NoteSort)}
        >
          {ORDERS.map((option) => (
            <option key={option} value={option}>
              {t(`triage.order.${option}`)}
            </option>
          ))}
        </Select>
      </div>
      <p role="status" className="text-12 text-secondary" data-numeric="">
        {t('triage.count', { count: rows.length })}
      </p>
      {excluded}
      {rows.length ? (
        <TriageRows rows={rows} choiceOf={choiceOf} onOpen={onOpen} />
      ) : (
        <EmptyState
          title={t('triage.noMatchTitle')}
          description={t('triage.noMatchBody')}
          action={
            <Button
              variant="quiet"
              onClick={() => {
                setFilter('all');
                setTyped('');
              }}
            >
              {t('notes.clearFilters')}
            </Button>
          }
        />
      )}
    </section>
  );
}

/** Only the rows on screen are in the document, as in the Note list. */
function TriageRows({
  rows,
  choiceOf,
  onOpen,
}: {
  readonly rows: readonly TriageItem[];
  readonly choiceOf: (item: TriageItem) => TriageChoice;
  readonly onOpen: (id: string) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const measure = () =>
      setOffset(list.current ? list.current.getBoundingClientRect().top + window.scrollY : 0);
    measure();
    const observer = new ResizeObserver(measure);
    if (list.current?.parentElement) observer.observe(list.current.parentElement);
    return () => observer.disconnect();
  }, []);
  const virtual = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    scrollMargin: offset,
  });

  return (
    <div
      ref={list}
      data-g="card"
      data-rows=""
      className="overflow-hidden rounded-24 border border-glass"
    >
      <div className="relative w-full" style={{ height: `${virtual.getTotalSize()}px` }}>
        {virtual.getVirtualItems().map((entry) => {
          const item = rows[entry.index];
          if (!item) return undefined;
          return (
            <div
              key={item.id}
              className="absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${entry.start - virtual.options.scrollMargin}px)` }}
            >
              <TriageRow item={item} choice={choiceOf(item)} onOpen={onOpen} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const TriageRow = memo(function TriageRow({
  item,
  choice,
  onOpen,
}: {
  readonly item: TriageItem;
  readonly choice: TriageChoice;
  readonly onOpen: (id: string) => void;
}) {
  const t = useTranslate();
  return (
    <DenseRow
      word={item.term}
      meaning={item.meaning}
      onClick={() => onOpen(item.id)}
      trailing={
        <span
          className={`shrink-0 text-12 ${choice === 'unsorted' ? 'text-tertiary' : 'text-secondary'}`}
        >
          {t(`triage.${choice}`)}
        </span>
      }
    />
  );
});

/**
 * The Deck screen's way in, for a Deck large enough to be worth a sweep.
 *
 * It fetches nothing. Whether to show it comes from the Deck's own Note count,
 * which arrives with the screen, so the card never appears late and pushes the
 * rows down, and it stays put through connectivity changes. Progress is shown
 * once a sweep has been opened in this visit and its list is in the cache.
 */
export function TriageEntry({
  deckId,
  noteCount,
  onOpen,
}: {
  readonly deckId: string;
  readonly noteCount: number | undefined;
  readonly onOpen: () => void;
}) {
  const cached = useQuery({ ...triageQuery(deckId), enabled: false });
  const decisions = useTriageDecisions();
  const items = cached.data?.items ?? EMPTY;
  const { counts } = useChoices(items, decisions);
  if (!cached.data) {
    if ((noteCount ?? 0) < ENTRY_MINIMUM) return null;
    return <TriageEntryCard onOpen={onOpen} />;
  }
  const total = items.length;
  const sorted = total - counts.unsorted;
  if (total === 0 || (total < ENTRY_MINIMUM && sorted === 0)) return null;
  return (
    <TriageEntryCard
      progress={{ sorted, total }}
      waiting={
        decisions.delivery === 'waiting' && items.some((item) => decisions.pending.has(item.id))
      }
      onOpen={onOpen}
    />
  );
}

export function TriageEntryCard({
  progress,
  waiting = false,
  onOpen,
}: {
  /** Known once the sweep's list has been read in this visit. */
  readonly progress?: { readonly sorted: number; readonly total: number };
  readonly waiting?: boolean;
  readonly onOpen: () => void;
}) {
  const t = useTranslate();
  const sorted = progress?.sorted ?? 0;
  return (
    <Card className="flex flex-col gap-16">
      <div className="flex w-full flex-wrap items-center justify-between gap-8">
        <h2 className="text-17 text-primary">{t('triage.title')}</h2>
        {progress && (
          <span className="text-12 text-secondary" data-numeric="">
            {t('triage.sorted', { count: sorted, total: progress.total })}
          </span>
        )}
      </div>
      {progress && (
        <div className="h-4">
          <Progress value={sorted} max={progress.total} label={t('triage.progress')} />
        </div>
      )}
      {sorted === 0 && (
        <p className="text-14 leading-body text-secondary">{t('triage.entryHint')}</p>
      )}
      {waiting && <p className="text-13 text-secondary">{t('triage.waiting')}</p>}
      <Button full variant="quiet" onClick={onOpen}>
        {t(
          !progress
            ? 'triage.open'
            : sorted === 0
              ? 'triage.start'
              : sorted < progress.total
                ? 'triage.continue'
                : 'triage.review',
        )}
      </Button>
    </Card>
  );
}

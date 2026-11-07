import { defaultRangeExtractor, useWindowVirtualizer } from '@tanstack/react-virtual';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import { isRecovering, termOf } from '@neuron/shared';
import type { ProblemCard } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { Button } from '../../ui/button';
import { Card, Panel } from '../../ui/card';
import { Chip } from '../../ui/chip';
import { ServerControls } from '../../ui/server-controls';

import type { Translate } from '../../i18n/locale';
import type { VirtualItem } from '@tanstack/react-virtual';

export interface ProblemReturn {
  top: number;
  margin: number;
  focusId: string | undefined;
  measurements: VirtualItem[];
}

const sameYear = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });
const otherYear = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
export function shortDate(value: string): string {
  const date = new Date(value);
  return (date.getFullYear() === new Date().getFullYear() ? sameYear : otherYear).format(date);
}
const RATING_KEY = {
  again: 'study.again',
  hard: 'study.hard',
  good: 'study.good',
  easy: 'study.easy',
} as const;

function meaningOf(fields: Record<string, unknown>): string {
  const value = fields['translation'] ?? fields['back'] ?? fields['note'] ?? '';
  return typeof value === 'string' ? value : '';
}

/** What the evidence says, in the learner's words. Never a diagnosis. */
function Explanation({ item, t }: { readonly item: ProblemCard; readonly t: Translate }) {
  const evidence = item.evidence;
  if (evidence.kind === 'counters')
    return (
      <p className="text-14 text-primary">
        {t('problems.reason.counters', { count: evidence.lapses, answers: evidence.answers })}
      </p>
    );
  return (
    <div className="flex flex-col gap-8">
      <ul className="flex flex-col gap-4 text-14 text-primary">
        {item.reasons.map((reason) => (
          <li key={reason}>
            {reason === 'repeated_lapses'
              ? t('problems.reason.repeatedLapses', {
                  count: evidence.lapses,
                  answers: evidence.answers,
                })
              : t('problems.reason.frequentAgain', {
                  again: evidence.again,
                  answers: evidence.answers,
                })}
          </li>
        ))}
      </ul>
      <div className="flex min-w-0 flex-col gap-4">
        <span className="text-12 text-secondary">{t('problems.recent')}</span>
        <ol className="flex flex-wrap gap-4" aria-label={t('problems.recent')}>
          {evidence.recent.map((answer, at) => (
            <li key={`${answer.reviewedAt}:${at}`}>
              <Chip tone={answer.rating === 'again' ? 'slipping' : 'new'}>
                <span>{t(RATING_KEY[answer.rating])}</span>
                <span className="sr-only"> {shortDate(answer.reviewedAt)}</span>
              </Chip>
            </li>
          ))}
        </ol>
      </div>
      <p className="text-13 text-secondary">
        {t('problems.lastAgain', { date: shortDate(evidence.lastAgainAt) })}
        {isRecovering(evidence.sinceLastAgain) &&
          ` · ${t('problems.recovering', { count: evidence.sinceLastAgain })}`}
      </p>
      {evidence.startedAt && (
        <p className="text-13 text-secondary">
          {t('problems.since', { date: shortDate(evidence.startedAt) })}
        </p>
      )}
    </div>
  );
}

/** Measured rows: a Card's Note context, the evidence, its actual schedule, two actions. */
export function ProblemCardRows({
  rows,
  returning,
  canAct,
  pending,
  onEdit,
  onSuspend,
}: {
  readonly rows: readonly ProblemCard[];
  readonly returning: ProblemReturn | undefined;
  readonly canAct: boolean;
  readonly pending: string | undefined;
  readonly onEdit: (row: ProblemCard, position: ProblemReturn) => void;
  readonly onSuspend: (row: ProblemCard) => void;
}) {
  const t = useTranslate();
  const list = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(returning?.margin ?? 0);
  const [focused, setFocused] = useState(returning?.focusId);
  const restored = useRef(false);
  const focusedIndex = useMemo(
    () => rows.findIndex((row) => row.card.id === focused),
    [rows, focused],
  );
  const virtual = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => 300,
    overscan: 4,
    scrollMargin: offset,
    getItemKey: (index) => rows[index]!.card.id,
    initialMeasurementsCache: returning?.measurements ?? [],
    initialOffset: returning?.top ?? 0,
    rangeExtractor: (range) => {
      const indices = new Set(defaultRangeExtractor(range));
      if (focusedIndex >= 0)
        for (
          let i = Math.max(0, focusedIndex - 1);
          i <= Math.min(rows.length - 1, focusedIndex + 1);
          i++
        )
          indices.add(i);
      return [...indices].sort((a, b) => a - b);
    },
  });
  useLayoutEffect(() => {
    const measure = () =>
      setOffset(list.current ? list.current.getBoundingClientRect().top + window.scrollY : 0);
    measure();
    const observer = new ResizeObserver(measure);
    if (list.current?.parentElement) observer.observe(list.current.parentElement);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (restored.current || !returning) return;
    window.scrollTo({ top: returning.top, behavior: 'instant' });
    const row = [...(list.current?.querySelectorAll<HTMLElement>('[data-problem-id]') ?? [])].find(
      (node) => node.dataset['problemId'] === returning.focusId,
    );
    if (returning.focusId && !row) return;
    row?.querySelector<HTMLElement>('[data-problem-edit]')?.focus({ preventScroll: true });
    restored.current = true;
  });
  return (
    <div
      ref={list}
      role="list"
      aria-label={t('problems.title')}
      data-problem-rows=""
      className="relative min-w-0"
      style={{ height: virtual.getTotalSize() }}
    >
      {virtual.getVirtualItems().map((item) => {
        const row = rows[item.index]!;
        const id = row.card.id;
        const term = termOf(row.note.fields);
        const meaning = meaningOf(row.note.fields);
        const direction = `${t(`card.direction.${row.card.direction}`)}${
          row.card.direction === 'cloze' && row.card.slot > 0
            ? `, ${t('problems.gap', { number: row.card.slot })}`
            : ''
        }`;
        return (
          <div
            key={id}
            role="listitem"
            aria-posinset={item.index + 1}
            aria-setsize={rows.length}
            data-index={item.index}
            data-problem-id={id}
            ref={virtual.measureElement}
            onFocusCapture={() => setFocused(id)}
            className="absolute top-0 left-0 w-full pb-12"
            style={{ transform: `translateY(${item.start - offset}px)` }}
          >
            <Card className="flex min-w-0 flex-col gap-12 p-16">
              <div className="flex min-w-0 flex-col gap-4">
                <h2 className="whitespace-pre-wrap break-words font-display text-20 text-primary [overflow-wrap:anywhere]">
                  {term}
                </h2>
                {meaning && (
                  <p className="whitespace-pre-wrap break-words text-15 text-secondary [overflow-wrap:anywhere]">
                    {meaning}
                  </p>
                )}
                <p className="break-words text-13 text-secondary [overflow-wrap:anywhere]">
                  {direction} · {row.deckPath.join(' / ')}
                </p>
              </div>
              <Panel className="flex min-w-0 flex-col gap-8 p-12">
                <span className="text-12 text-secondary">{t('problems.why')}</span>
                <Explanation item={row} t={t} />
              </Panel>
              <div className="flex min-w-0 flex-col gap-4">
                <span className="text-12 text-secondary">{t('problems.schedule')}</span>
                <p className="text-14 text-primary">
                  {row.card.suspendedAt
                    ? t('problems.schedule.suspended', { date: shortDate(row.card.suspendedAt) })
                    : t('problems.schedule.studying', { date: shortDate(row.card.due) })}
                </p>
              </div>
              <div className="flex flex-wrap gap-8">
                <Button
                  variant="quiet"
                  data-problem-edit=""
                  onClick={() =>
                    onEdit(row, {
                      top: window.scrollY,
                      margin: offset,
                      // Keyboard return keeps focus; a tap or click returns to the position only.
                      focusId: document.activeElement?.matches(':focus-visible') ? id : undefined,
                      measurements: virtual.takeSnapshot(),
                    })
                  }
                >
                  {t('problems.edit')}
                </Button>
                <ServerControls available={canAct}>
                  <Button
                    variant="text"
                    // Not `busy`: disabling the pressed control would drop keyboard focus.
                    aria-busy={pending === id}
                    onClick={() => onSuspend(row)}
                  >
                    {t(row.card.suspendedAt ? 'problems.resume' : 'problems.suspend')}
                  </Button>
                </ServerControls>
              </div>
            </Card>
          </div>
        );
      })}
    </div>
  );
}

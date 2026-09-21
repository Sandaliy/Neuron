import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { SlidersHorizontal, ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { DEFAULT_ANSWER_SECONDS } from '@neuron/core';
import { dailyStudySessionSchema, studyDecks } from '@neuron/shared';
import type { DeckNode, DailyStudySession } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { describe, request } from '../../lib/api';
import { flatten, useDeckTree } from '../../lib/decks';
import { Button } from '../../ui/button';
import { Card, GroupLabel } from '../../ui/card';
import { Chip } from '../../ui/chip';
import { ReviewTime } from '../../ui/review-time';
import { Row } from '../../ui/row';
import { Select } from '../../ui/select';
import { ErrorState, Skeleton } from '../../ui/states';

import { StudyScreen } from './study';
import { StudyScope } from './study-scope';

/**
 * How long the cards waiting are likely to take.
 *
 * The workload manager in `packages/core` works this out from measured answer
 * times, and measuring needs the review log. The client has no local review log
 * until sync lands in phase 8, so until then this is the same arithmetic over
 * the package's default seconds per answer rather than over this person's.
 *
 * One number rather than one per direction, because the deck tree carries a
 * total and not a breakdown. `recall` is the middle of the five defaults and
 * the direction most of a vocabulary collection is made of.
 *
 * It says "about" on screen for exactly these reasons. When the log is local,
 * `estimateAnswerTimes` replaces the constant and nothing else here changes.
 *
 * @param due cards waiting
 * @returns whole minutes, never less than one when there is anything to do
 */
export function estimateMinutes(due: number): number {
  if (due === 0) {
    return 0;
  }

  return Math.max(1, Math.round((due * DEFAULT_ANSWER_SECONDS.recall) / 60));
}

export function TodayScreen() {
  const t = useTranslate();
  const decks = useDeckTree();
  const [studying, setStudying] = useState<DailyStudySession>();
  const [minutes, setMinutes] = useState('');
  if (studying)
    return (
      <StudyScreen
        initialPlan={studying}
        minutes={minutes}
        onFinish={() => {
          setStudying(undefined);
          void decks.refetch();
        }}
      />
    );
  return (
    <section data-screen="" className="flex flex-col gap-24">
      <header className="flex items-baseline justify-between gap-12">
        <h1 className="text-24 tracking-tight text-primary">{t('today.title')}</h1>
      </header>
      {decks.isPending && <Skeleton className="h-56 w-full" />}
      {decks.error && !decks.data && (
        <ErrorState
          message={t(describe(decks.error).key)}
          retryLabel={t('common.retry')}
          onRetry={() => void decks.refetch()}
        />
      )}
      {decks.data && (
        <Waiting
          minutes={minutes}
          onMinutes={setMinutes}
          decks={decks.data}
          onStart={setStudying}
        />
      )}
    </section>
  );
}
function Waiting({
  decks,
  onStart,
  minutes,
  onMinutes,
}: {
  readonly minutes: string;
  readonly onMinutes: (value: string) => void;
  readonly decks: readonly DeckNode[];
  readonly onStart: (plan: DailyStudySession) => void;
}) {
  const t = useTranslate();
  const navigate = useNavigate();
  const live = studyDecks(flatten(decks));
  const [scope, setScope] = useState<string[]>();
  const [scopeOpen, setScopeOpen] = useState(false);
  const selected =
    scope ??
    live.filter((deck) => deck.settings?.dailyStudyIncluded !== false).map((deck) => deck.id);
  const scopeLabel =
    scope === undefined
      ? t('study.scopeDefault')
      : scope.length === 1
        ? (live.find((deck) => deck.id === scope[0])?.name ?? t('study.scopeCount', { count: 1 }))
        : t('study.scopeCount', { count: scope.length });
  const [direction, setDirection] = useState('');
  const [override, setOverride] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const plan = useQuery({
    queryKey: [
      'study-plan',
      minutes,
      direction,
      override,
      scope,
      live.map((deck) => [deck.id, deck.settings?.dailyStudyIncluded]),
    ],
    queryFn: async ({ signal }) =>
      dailyStudySessionSchema.parse(
        await request('/study/session', {
          method: 'POST',
          signal,
          body: {
            ...(minutes ? { minutes: Number(minutes) } : {}),
            ...(direction ? { direction } : {}),
            ...(override ? { newCards: 'override' } : {}),
            ...(scope === undefined ? {} : { deckIds: scope }),
          },
        }),
      ),
    staleTime: 0,
  });
  const result = plan.data;
  const caughtUp = result?.availableCount === 0 && selected.length > 0;
  const waiting = (result?.deckSummaries ?? []).flatMap((summary) => {
    const deck = live.find((row) => row.id === summary.deckId);
    return deck ? [{ ...deck, ...summary }] : [];
  });
  return (
    <div className="flex flex-col gap-24">
      <Card className="flex flex-col gap-24">
        {selected.length === 0 ? (
          <>
            <h2 className="text-24 text-primary">{t('study.noDecks')}</h2>
            <Button onClick={() => setScopeOpen(true)}>{t('study.chooseDecks')}</Button>
          </>
        ) : plan.error && !result ? (
          <ErrorState
            message={t(describe(plan.error).key)}
            retryLabel={t('common.retry')}
            onRetry={() => void plan.refetch()}
          />
        ) : !result ? (
          <div className="flex flex-col gap-20" aria-label={t('common.loading')} role="status">
            <Skeleton className="h-56 w-[60%]" />
            <Skeleton className="h-20 w-[40%]" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : caughtUp ? (
          <>
            <h2 className="text-24 text-primary">{t('today.caughtUpTitle')}</h2>
            <div className="flex flex-col gap-4" role="status">
              <span className="text-12 text-secondary">{t('today.nextReview')}</span>
              <span className="text-17 text-primary">
                {result.nextDue ? <ReviewTime due={result.nextDue} /> : t('today.noneScheduled')}
              </span>
            </div>
            <Button onClick={() => void navigate({ to: '/library' })}>
              {t('today.practiceDeck')}
            </Button>
          </>
        ) : (
          <>
            <div className="flex items-end justify-between gap-16">
              <div className="flex items-baseline gap-12">
                <span data-numeric="" className="text-56 leading-none tracking-tight text-primary">
                  {result.cards.length}
                </span>
                <span className="text-17 text-secondary">{t('today.ready')}</span>
              </div>
              <span className="pb-4 text-13 text-secondary">
                {t('today.estimate', { minutes: Math.max(1, Math.round(result.estimatedMinutes)) })}
              </span>
            </div>
            <div className="flex gap-32 text-13 text-secondary">
              <span>
                <span data-numeric="" className="mr-4 text-15 text-primary">
                  {result.reviewCount}
                </span>
                {t('study.reviewsMetric')}
              </span>
              <span>
                <span data-numeric="" className="mr-4 text-15 text-primary">
                  {result.newCount}
                </span>
                {t('study.newMetric')}
              </span>
            </div>
            <Button
              variant="primary"
              full
              disabled={!result.cards.length || plan.isFetching}
              onClick={() => onStart(result)}
            >
              {t('today.study')}
            </Button>
          </>
        )}
        {selected.length > 0 && !caughtUp && (
          <div className="flex items-center justify-between gap-12 border-t border-subtle pt-8">
            <span className="truncate text-12 text-secondary">{scopeLabel}</span>
            <Button
              variant="text"
              className="shrink-0 px-8 text-secondary"
              aria-expanded={adjusting}
              onClick={() => setAdjusting(!adjusting)}
            >
              <SlidersHorizontal size={16} aria-hidden="true" />
              {t('today.adjust')}
            </Button>
          </div>
        )}
        {caughtUp && (
          <Button
            variant="text"
            className="self-start px-8 text-secondary"
            onClick={() => setScopeOpen(true)}
          >
            {t('study.scope')}
            <ChevronDown size={14} aria-hidden="true" />
          </Button>
        )}
        {adjusting && !caughtUp && selected.length > 0 && (
          <div className="neu-reveal flex flex-col gap-16 border-t border-subtle pt-16">
            <div className="flex items-center justify-between gap-12">
              <span className="text-14 text-secondary">{t('study.scope')}</span>
              <Button onClick={() => setScopeOpen(true)}>
                {t('study.chooseDecks')}
                <ChevronDown size={14} aria-hidden="true" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-12">
              <label className="flex flex-col gap-8 text-13 text-secondary">
                {t('study.minutes')}
                <Select value={minutes} onChange={(event) => onMinutes(event.target.value)}>
                  <option value="">{t('study.defaultTime')}</option>
                  {[5, 10, 20, 30].map((value) => (
                    <option key={value} value={value}>
                      {t('study.intervalMinutes', { count: value })}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex flex-col gap-8 text-13 text-secondary">
                {t('study.skill')}
                <Select value={direction} onChange={(event) => setDirection(event.target.value)}>
                  <option value="">{t('study.mixed')}</option>
                  <option value="recognition">{t('study.recognition')}</option>
                  <option value="recall">{t('study.recall')}</option>
                </Select>
              </label>
            </div>
            {(result?.newCards.overrideAvailable || override) && (
              <label className="flex min-h-44 items-center gap-8 text-14 text-secondary">
                <input
                  type="checkbox"
                  checked={override}
                  onChange={(event) => setOverride(event.target.checked)}
                />
                {t('study.moreNew')}
              </label>
            )}
          </div>
        )}
      </Card>
      {plan.error && result && (
        <ErrorState
          message={t(describe(plan.error).key)}
          retryLabel={t('common.retry')}
          onRetry={() => void plan.refetch()}
        />
      )}
      {selected.length > 0 && waiting.length > 0 && (
        <div className="flex flex-col gap-12">
          <GroupLabel>{t('study.scopeDefault')}</GroupLabel>
          <div className="flex flex-col gap-8">
            {waiting.map((deck) => (
              <Row
                key={deck.id}
                title={deck.name}
                onClick={() => void navigate({ to: '/notes', search: { deckId: deck.id } })}
                subtitle={
                  deck.due === 0 && deck.fresh === 0 && deck.nextDue
                    ? new Date(deck.nextDue).toLocaleDateString('en', {
                        month: 'short',
                        day: 'numeric',
                      })
                    : t('today.deckCounts', { due: deck.due, fresh: deck.fresh })
                }
                trailing={deck.due > 0 ? <Chip tone="due">{deck.due}</Chip> : undefined}
              />
            ))}
          </div>
        </div>
      )}
      <StudyScope
        open={scopeOpen}
        onOpenChange={setScopeOpen}
        decks={live}
        collections={flatten(decks)}
        selected={scope}
        onApply={setScope}
      />
    </div>
  );
}

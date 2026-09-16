import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { DEFAULT_ANSWER_SECONDS } from '@neuron/core';
import { dailyStudySessionSchema } from '@neuron/shared';
import type { DeckNode, DailyStudySession } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { describe, request } from '../../lib/api';
import { totals, useDeckTree } from '../../lib/decks';
import { Button } from '../../ui/button';
import { Card, GroupLabel } from '../../ui/card';
import { Chip } from '../../ui/chip';
import { Row } from '../../ui/row';
import { Select } from '../../ui/select';
import { ErrorState, Skeleton } from '../../ui/states';

import { StudyScreen } from './study';

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
      <h1 className="font-display text-24 tracking-tight text-primary">{t('today.title')}</h1>

      {decks.isPending ? (
        <div className="flex flex-col gap-12" role="status" aria-label={t('common.loading')}>
          <Skeleton className="h-56 w-[60%]" />
          <Skeleton className="h-20 w-[40%]" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : undefined}

      {/*
        Only when there is nothing to show. A refetch that failed behind
        content already on screen leaves that content alone: the counts are a
        few minutes old rather than gone, which is the better of the two.
      */}
      {decks.error && !decks.data ? (
        <ErrorState
          message={t(describe(decks.error).key, describe(decks.error).values)}
          retryLabel={t('common.retry')}
          onRetry={() => void decks.refetch()}
        />
      ) : undefined}

      {decks.data ? (
        <Waiting
          minutes={minutes}
          onMinutes={setMinutes}
          decks={decks.data}
          onStart={setStudying}
        />
      ) : undefined}
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
  const { due, fresh } = totals(decks);
  const [direction, setDirection] = useState('');
  const [override, setOverride] = useState(false);
  const plan = useQuery({
    queryKey: ['study-plan', minutes, direction, override],
    queryFn: async ({ signal }) =>
      dailyStudySessionSchema.parse(
        await request('/study/session', {
          method: 'POST',
          signal,
          body: {
            ...(minutes ? { minutes: Number(minutes) } : {}),
            ...(direction ? { direction } : {}),
            ...(override ? { newCards: 'override' } : {}),
          },
        }),
      ),
    staleTime: 0,
  });
  const waiting = decks;

  return (
    <div className="flex flex-col gap-24">
      <Card className="flex flex-col gap-20">
        <div className="flex items-baseline gap-12">
          <span
            data-numeric=""
            className="font-display text-56 leading-none tracking-tight text-primary"
          >
            {due}
          </span>

          <div className="flex flex-col gap-4 pb-4">
            <span className="text-15 leading-snug text-primary">{t('today.waitingLabel')}</span>
            {due > 0 ? (
              <span className="text-13 text-tertiary">
                {t('today.estimate', { minutes: estimateMinutes(due) })}
              </span>
            ) : undefined}
          </div>
        </div>

        {fresh > 0 ? (
          <div className="flex flex-col gap-4">
            <span data-numeric="" className="text-15 text-accent">
              {fresh}
            </span>
            <span className="text-12 text-tertiary">{t('today.newLabel')}</span>
          </div>
        ) : undefined}

        {due === 0 && fresh === 0 ? (
          <div role="status" className="rounded-12 bg-raised p-12">
            <p className="text-15 text-primary">{t('today.caughtUpTitle')}</p>
            <p className="text-13 text-secondary">{t('today.caughtUpBody')}</p>
          </div>
        ) : undefined}

        <label className="text-14 text-secondary">
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
        <label className="text-14 text-secondary">
          {t('study.skill')}
          <Select value={direction} onChange={(event) => setDirection(event.target.value)}>
            <option value="">{t('study.mixed')}</option>
            <option value="recognition">{t('study.recognition')}</option>
            <option value="recall">{t('study.recall')}</option>
          </Select>
        </label>
        <p className="text-13 text-secondary">{t('study.oneOff')}</p>
        <div aria-live="polite">
          {plan.isFetching ? (
            <p>{t('common.loading')}</p>
          ) : (
            plan.data && (
              <>
                <p className="text-15 text-primary">
                  {t('study.plan', {
                    minutes: Math.round(plan.data.estimatedMinutes * 10) / 10,
                    reviews: plan.data.reviewCount,
                    fresh: plan.data.newCount,
                  })}
                </p>
                {plan.data.cards.length === plan.data.availableCount && (
                  <p className="text-13 text-secondary">{t('study.allPlanned')}</p>
                )}
                {plan.data.newCards.overrideAvailable && (
                  <label className="flex min-h-44 items-center gap-8 text-14 text-secondary">
                    <input
                      type="checkbox"
                      checked={override}
                      onChange={(event) => setOverride(event.target.checked)}
                    />
                    {t('study.moreNew')}
                  </label>
                )}
                {plan.data.newCards.limitedBy === 'automaticPolicy' && (
                  <p className="text-13 text-secondary">{t('study.policyPause')}</p>
                )}
                {plan.data.nextDue && (
                  <p className="text-13 text-secondary">
                    {t('study.nextReturn', { time: new Date(plan.data.nextDue).toLocaleString() })}
                  </p>
                )}
              </>
            )
          )}
          {plan.error && (
            <ErrorState
              message={t(describe(plan.error).key)}
              retryLabel={t('common.retry')}
              onRetry={() => void plan.refetch()}
            />
          )}
        </div>
        <Button
          variant="primary"
          full
          disabled={!plan.data?.cards.length || plan.isFetching}
          onClick={() => {
            if (plan.data) onStart(plan.data);
          }}
        >
          {t('today.study')}
        </Button>
      </Card>

      {waiting.length > 0 ? (
        <div className="flex flex-col gap-12">
          <GroupLabel>{t('today.waitingIn')}</GroupLabel>

          <div className="flex flex-col gap-8">
            {waiting.map((deck) => (
              <Row
                key={deck.id}
                title={deck.name}
                onClick={() =>
                  void (deck.kind === 'deck'
                    ? navigate({ to: '/notes', search: { deckId: deck.id } })
                    : navigate({ to: '/library', search: { folderId: deck.id } }))
                }
                subtitle={
                  deck.due === 0 && deck.fresh === 0 && deck.nextDue
                    ? t('study.nextReturn', { time: new Date(deck.nextDue).toLocaleString() })
                    : t('today.deckCounts', { due: deck.due, fresh: deck.fresh })
                }
                trailing={deck.due > 0 ? <Chip tone="due">{deck.due}</Chip> : undefined}
              />
            ))}
          </div>
        </div>
      ) : undefined}
    </div>
  );
}

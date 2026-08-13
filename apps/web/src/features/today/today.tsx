import * as Tooltip from '@radix-ui/react-tooltip';

import { DEFAULT_ANSWER_SECONDS } from '@neuron/core';
import type { DeckNode } from '@neuron/shared';

import { useTranslate } from '../../i18n/provider';
import { describe } from '../../lib/api';
import { totals, useDeckTree } from '../../lib/decks';
import { Button } from '../../ui/button';
import { EmptyState, ErrorState, Skeleton } from '../../ui/states';

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

  return (
    <section className="flex flex-col gap-24 py-16">
      <h1 className="text-24 font-semibold text-text">{t('today.title')}</h1>

      {decks.isPending ? (
        <div className="flex flex-col gap-12" role="status" aria-label={t('common.loading')}>
          <Skeleton className="h-32 w-[60%]" />
          <Skeleton className="h-24 w-[40%]" />
          <Skeleton className="h-44 w-full" />
        </div>
      ) : undefined}

      {decks.error ? (
        <ErrorState
          message={t(describe(decks.error).key, describe(decks.error).values)}
          retryLabel={t('common.retry')}
          onRetry={() => void decks.refetch()}
        />
      ) : undefined}

      {decks.data ? <Waiting decks={decks.data} /> : undefined}
    </section>
  );
}

function Waiting({ decks }: { readonly decks: readonly DeckNode[] }) {
  const t = useTranslate();
  const { due } = totals(decks);

  if (due === 0) {
    return <EmptyState title={t('today.emptyTitle')} description={t('today.emptyBody')} />;
  }

  return (
    <div className="flex flex-col gap-24">
      <div className="flex flex-col gap-8 rounded-14 border border-border bg-surface p-24">
        <p className="text-32 font-semibold text-text tabular-nums">{due}</p>
        <p className="text-16 text-text-dim">{t('today.waiting', { count: due })}</p>
        <p className="text-16 text-text">
          {t('today.estimate', { minutes: estimateMinutes(due) })}
        </p>
        <p className="text-14 text-text-dim">{t('today.estimateHint')}</p>
      </div>

      {/*
        The button is disabled and says why.

        A disabled button fires no pointer events, so the tooltip cannot hang
        off it. The span is what the tooltip is attached to, and it takes focus
        so the reason reaches a keyboard as well as a mouse.
      */}
      <Tooltip.Provider delayDuration={200}>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <span tabIndex={0} className="inline-block w-full rounded-10">
              <Button variant="primary" full disabled>
                {t('today.study')}
              </Button>
            </span>
          </Tooltip.Trigger>

          <Tooltip.Portal>
            <Tooltip.Content
              sideOffset={8}
              className="max-w-[280px] rounded-10 border border-border bg-surface px-12 py-8 text-14 text-text"
            >
              {t('today.studyLater')}
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>

      {/* In text as well, because a tooltip never appears on a phone. */}
      <p className="text-14 text-text-dim">{t('today.studyLater')}</p>
    </div>
  );
}

import * as Tooltip from '@radix-ui/react-tooltip';

import { DEFAULT_ANSWER_SECONDS } from '@neuron/core';
import type { DeckNode } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { describe } from '../../lib/api';
import { totals, useDeckTree } from '../../lib/decks';
import { Button } from '../../ui/button';
import { Card, GroupLabel } from '../../ui/card';
import { Chip } from '../../ui/chip';
import { Row } from '../../ui/row';
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

      {decks.data ? <Waiting decks={decks.data} /> : undefined}
    </section>
  );
}

function Waiting({ decks }: { readonly decks: readonly DeckNode[] }) {
  const t = useTranslate();
  const { due, fresh } = totals(decks);

  /*
   * Empty only when there is genuinely nothing.
   *
   * Due and new are two different facts and the screen says both. A collection
   * imported an hour ago has nothing due and plenty new, and telling that
   * person "nothing is waiting" reads as a broken app rather than as a
   * scheduler doing its job.
   */
  if (due === 0 && fresh === 0) {
    return <EmptyState title={t('today.emptyTitle')} description={t('today.emptyBody')} />;
  }

  const waiting = decks.filter((deck) => deck.due > 0 || deck.fresh > 0);

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

        {/*
          The button is disabled and says why.

          A disabled button fires no pointer events, so the tooltip cannot hang
          off it. The span is what the tooltip is attached to, and it takes
          focus so the reason reaches a keyboard as well as a mouse.
        */}
        <Tooltip.Provider delayDuration={200}>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <span tabIndex={0} className="inline-block w-full rounded-12">
                <Button variant="primary" full disabled>
                  {t('today.study')}
                </Button>
              </span>
            </Tooltip.Trigger>

            <Tooltip.Portal>
              <Tooltip.Content
                data-g="panel"
                sideOffset={8}
                className="max-w-[280px] rounded-12 px-12 py-8 text-13 text-primary"
              >
                {t('today.studyLater')}
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </Tooltip.Provider>
      </Card>

      {waiting.length > 0 ? (
        <div className="flex flex-col gap-12">
          <GroupLabel>{t('today.waitingIn')}</GroupLabel>

          <div className="flex flex-col gap-8">
            {waiting.map((deck) => (
              <Row
                key={deck.id}
                title={deck.name}
                subtitle={t('today.deckCounts', { due: deck.due, fresh: deck.fresh })}
                trailing={deck.due > 0 ? <Chip tone="due">{deck.due}</Chip> : undefined}
              />
            ))}
          </div>
        </div>
      ) : undefined}

      {/* In text as well, because a tooltip never appears on a phone. */}
      <p className="text-13 leading-body text-tertiary">{t('today.studyLater')}</p>
    </div>
  );
}

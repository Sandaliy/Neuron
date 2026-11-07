import type { CardDirection } from '@neuron/core';
import type {
  Card,
  DirectionStatus,
  LadderStep,
  MessageKey,
  NoteFields,
  NoteStatus,
  NoteTypeName,
} from '@neuron/shared';
import { directionProgress } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { Button } from '../../ui/button';
import { Disclosure } from '../../ui/disclosure';

import type { ReactNode } from 'react';

/**
 * A Note's directions: which are open, which opens next, and why the rest wait.
 *
 * Drawn from `directionProgress` in packages/shared, the same rule the server
 * applies after an answer, so the screen never promises a direction the server
 * would not open. Opening one by hand stays a single button per locked
 * direction; nothing here is configuration. The ladder itself is a Deck setting.
 */
export function NoteDirections({
  noteType,
  fields,
  status,
  cards,
  ladder,
  available,
  pending,
  onOpen,
  children,
}: {
  readonly noteType: NoteTypeName;
  readonly fields: NoteFields;
  readonly status: NoteStatus;
  readonly cards: readonly Card[];
  readonly ladder: readonly LadderStep[];
  /** Opening needs the server, which makes the Card. */
  readonly available: boolean;
  readonly pending: boolean;
  readonly onOpen: (direction: CardDirection) => void;
  readonly children?: ReactNode;
}) {
  const t = useTranslate();
  const progress = directionProgress({
    noteType,
    fields,
    ladder,
    cards: cards.map((card) => ({
      direction: card.direction,
      slot: card.slot,
      state: card.state,
      stability: card.stability,
      suspended: card.suspendedAt !== null,
    })),
    active: status === 'active',
  });
  const name = (direction: CardDirection) => t(`study.direction.${direction}` as MessageKey);
  const next = progress.directions.find((entry) => entry.kind === 'ready' || entry.kind === 'next');

  return (
    <Disclosure
      quiet
      title={t('study.moreDirections')}
      {...(next
        ? {
            detail: (
              <span className="text-13 text-secondary">
                {t('directions.summary', { direction: name(next.direction) })}
              </span>
            ),
          }
        : {})}
    >
      <div className="flex flex-col gap-12" data-note-directions="">
        <p className="text-13 text-secondary">{t('directions.hint')}</p>
        <ul className="flex flex-col gap-8">
          {progress.directions.map((entry) => (
            <li
              key={entry.direction}
              data-direction={entry.direction}
              data-direction-state={entry.kind}
              className="flex min-h-44 items-center justify-between gap-12"
            >
              <span className="flex min-w-0 flex-col gap-4">
                <span className="text-14 text-primary">{name(entry.direction)}</span>
                <span className="text-13 leading-body text-secondary">
                  {describeStatus(entry, name, t)}
                </span>
              </span>
              {entry.kind !== 'open' && (
                <Button
                  variant="quiet"
                  className="shrink-0 px-12"
                  aria-label={t('directions.openNowLabel', { direction: name(entry.direction) })}
                  disabled={!available || pending}
                  onClick={() => onOpen(entry.direction)}
                >
                  {t('directions.openNow')}
                </Button>
              )}
            </li>
          ))}
        </ul>
        {children}
      </div>
    </Disclosure>
  );
}

function describeStatus(
  entry: DirectionStatus,
  name: (direction: CardDirection) => string,
  t: ReturnType<typeof useTranslate>,
): string {
  switch (entry.kind) {
    case 'open':
      return entry.suspended
        ? t('directions.openSuspended')
        : entry.answered
          ? t('directions.open')
          : t('directions.openNew');
    case 'ready':
      return t('directions.ready');
    case 'next':
      return entry.stability === null
        ? t('directions.nextUnanswered', { after: name(entry.after), threshold: entry.threshold })
        : t('directions.next', {
            after: name(entry.after),
            threshold: entry.threshold,
            // Whole days held so far, never rounded up past the threshold.
            days: Math.min(Math.floor(entry.stability), Math.max(0, entry.threshold - 1)),
          });
    case 'waiting':
      return t('directions.waiting', { after: name(entry.after) });
    case 'paused':
      return entry.reason === 'suspended'
        ? t('directions.pausedSuspended', { after: name(entry.after) })
        : t('directions.pausedInactive');
    case 'manual':
      return t('directions.manual');
  }
}

import type { CardFace, MessageKey, PlannedCard } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { GroupLabel, Panel } from '../../ui/card';
import { Chip } from '../../ui/chip';

/**
 * What this note will actually produce.
 *
 * Drawn from `openingCards` and `reconcileCards` in packages/shared, which are
 * the same functions the server calls when it writes the cards. That is the
 * point of the panel: not an impression of what might happen, but the answer,
 * before anything is saved.
 *
 * A card being added and a card being taken away are marked, because the second
 * one is the only edit that can cost a schedule and it should never be a
 * surprise.
 */
export interface PreviewCard extends PlannedCard {
  /** What is about to happen to it. */
  readonly change: 'keeps' | 'adds' | 'removes';
  /** How many answers are on it, when it already exists. */
  readonly reps?: number;
}

export function CardPreview({ cards }: { readonly cards: readonly PreviewCard[] }) {
  const t = useTranslate();

  return (
    <section className="flex flex-col gap-12">
      <GroupLabel>{t('note.preview')}</GroupLabel>

      {cards.length === 0 ? (
        <p className="text-14 leading-body text-secondary">{t('note.previewEmpty')}</p>
      ) : (
        <ul className="flex flex-col gap-8">
          {cards.map((card) => (
            <li key={`${card.change}:${card.direction}:${card.slot}`}>
              <Panel className="flex flex-col gap-8">
                <div className="flex items-center justify-between gap-8">
                  <span className="text-13 text-secondary">
                    {t(`card.direction.${card.direction}` as MessageKey)}
                  </span>

                  {card.change === 'adds' ? (
                    <Chip tone="new">{t('note.willAdd')}</Chip>
                  ) : card.change === 'removes' ? (
                    <Chip tone="slipping">{t('note.willRemove')}</Chip>
                  ) : card.reps !== undefined && card.reps > 0 ? (
                    <span className="text-12 text-tertiary" data-numeric="">
                      {t('note.reviewsOnCard', { count: card.reps })}
                    </span>
                  ) : undefined}
                </div>

                <Face label={t('note.previewFront')} faces={card.front} />
                <Face label={t('note.previewBack')} faces={card.back} />
              </Panel>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** One side of a card: its label, and the lines the fields put on it. */
function Face({ label, faces }: { readonly label: string; readonly faces: readonly CardFace[] }) {
  return (
    <div className="flex gap-12">
      <span className="w-52 shrink-0 text-12 text-tertiary">{label}</span>
      <span className="min-w-0 flex-1 text-14 leading-body text-primary">
        {faces.length === 0 ? (
          <span className="text-tertiary">&mdash;</span>
        ) : (
          faces.map((face) => face.value).join(' · ')
        )}
      </span>
    </div>
  );
}

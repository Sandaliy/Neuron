import type { CardStateCounts, MessageKey } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';

/** Progress describes independent Cards, never due dates or Note mastery. */
export function NoteProgressSummary({ counts }: { readonly counts: CardStateCounts | undefined }) {
  const t = useTranslate();
  if (!counts)
    return <span className="shrink-0 text-12 text-secondary">{t('note.status.active')}</span>;

  const values = (['new', 'learning', 'relearning', 'review'] as const)
    .map((state) => ({ state, count: counts[state] }))
    .filter(({ count }) => count > 0);
  const started = counts.learning + counts.relearning + counts.review;
  const label: MessageKey =
    values.length === 0
      ? 'notes.cardSummaryNone'
      : counts.new > 0 && started > 0
        ? 'notes.partlyStarted'
        : counts.learning + counts.relearning > 0
          ? 'cardState.learning'
          : counts.review > 0
            ? 'cardState.review'
            : 'cardState.new';
  const description = values.length
    ? values.map(({ state, count }) => t(`notes.progress.${state}`, { count })).join(', ')
    : t(label);

  return (
    <span aria-label={description} title={description} className="shrink-0 text-12 text-secondary">
      {t(label)}
    </span>
  );
}

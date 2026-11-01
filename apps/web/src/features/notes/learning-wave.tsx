import type { DailyStudySession, DeckWave } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { useAccount } from '../../lib/account';
import { useLastWavePlan } from '../../lib/learning-waves';
import { Card } from '../../ui/card';
import { Progress } from '../../ui/progress';

/**
 * The Deck's wave now entering Study, from the last plan Today made.
 *
 * Like the triage entry beside it, it requests nothing, so it never arrives
 * late or moves with connectivity. Before Today has planned in this visit
 * there is nothing to show. A Deck no larger than one wave, or with every Note
 * started, has no card either. Loading and failure belong to Today; this card
 * only explains the plan Today already has.
 */
export function LearningWave({ deckId }: { readonly deckId: string }) {
  const account = useAccount();
  const plan = useLastWavePlan(account.data?.id);
  const wave = plan?.waves.find((row) => row.deckId === deckId);
  if (!plan || !wave || !showsWave(wave)) return null;
  return <LearningWaveCard wave={wave} decision={plan.newCards} />;
}

/** Whether a Deck's wave is worth a card of its own. */
export function showsWave(wave: DeckWave) {
  return wave.count > 1 && wave.number > 0;
}

export function LearningWaveCard({
  wave,
  decision,
}: {
  readonly wave: DeckWave;
  readonly decision: Pick<DailyStudySession['newCards'], 'allowed' | 'reason'>;
}) {
  const t = useTranslate();
  // Room the throttle gave away elsewhere today reads as used, not as a reason.
  const paused = decision.allowed > 0 ? 'withinBudget' : decision.reason;
  const days = wave.today > 0 ? Math.ceil(wave.waiting / wave.today) : 0;
  return (
    <Card className="flex flex-col gap-16">
      <div className="flex w-full flex-wrap items-center justify-between gap-8">
        <h2 className="text-17 text-primary">
          {t('waves.title', { number: wave.number, count: wave.count })}
        </h2>
        <span className="text-12 text-secondary" data-numeric="">
          {t('waves.started', { started: wave.started, size: wave.size })}
        </span>
      </div>
      <div className="h-4">
        <Progress value={wave.started} max={wave.size} label={t('waves.progress')} />
      </div>
      <div className="flex flex-col gap-8 text-14 leading-body text-secondary">
        <p>
          {t('waves.waiting', { count: wave.waiting })}
          {wave.unsure > 0 && ` ${t('waves.unsure', { count: wave.unsure })}`}
        </p>
        <p className="text-primary">
          {wave.today > 0
            ? t('waves.today', { count: wave.today })
            : t(`waves.paused.${paused}` as const)}
        </p>
        <p>
          {wave.today === 0
            ? t('waves.next')
            : days <= 1
              ? t('waves.nextDay')
              : t('waves.nextDays', { count: days })}
        </p>
        <p>{wave.later > 0 ? t('waves.later', { count: wave.later }) : t('waves.last')}</p>
      </div>
    </Card>
  );
}

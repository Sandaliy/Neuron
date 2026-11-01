import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { DailyStudySession, DeckWave } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { useAccount } from '../../lib/account';
import { lastWavePlan, wavePlanQuery } from '../../lib/learning-waves';
import { useOffline } from '../../lib/offline';
import { Card } from '../../ui/card';
import { Progress } from '../../ui/progress';

/**
 * The Deck's wave now entering Study, read from the default Daily Study plan.
 *
 * A Deck no larger than one wave has nothing to cut up, and a Deck whose every
 * Note has started has nothing waiting, so neither shows the card. While a
 * newer plan is made the last one stands in; with none at all, or when no plan
 * can be made, the card is simply not there. Today owns those states, and this
 * card only explains the plan Today already has.
 */
export function LearningWave({ deckId }: { readonly deckId: string }) {
  const account = useAccount();
  const offline = useOffline();
  const client = useQueryClient();
  const local = offline.offline;
  const plan = useQuery({
    ...wavePlanQuery(account.data, local),
    enabled: !!account.data && (!local || offline.available),
    placeholderData: () => lastWavePlan(client, account.data?.id),
  });
  const wave = plan.data?.waves.find((row) => row.deckId === deckId);
  if (!plan.data || !wave || !showsWave(wave)) return null;
  return <LearningWaveCard wave={wave} decision={plan.data.newCards} />;
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
        <h2 className="text-17 text-primary" data-numeric="">
          {t('waves.title', { number: wave.number, count: wave.count })}
        </h2>
        <span className="text-12 text-secondary" data-numeric="">
          {t('waves.started', { started: wave.started, size: wave.size })}
        </span>
      </div>
      <div className="h-4">
        <Progress value={wave.started} max={wave.size} label={t('waves.progress')} />
      </div>
      <div className="flex flex-col gap-8 text-14 leading-body text-secondary" data-numeric="">
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

import { useQuery } from '@tanstack/react-query';

import { practiceResultSchema } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { request } from '../../lib/api';
import { Progress } from '../../ui/progress';

export function PracticeEntry({
  deckId,
  onOpen,
}: {
  readonly deckId: string;
  readonly onOpen: () => void;
}) {
  const t = useTranslate();
  const summary = useQuery({
    queryKey: ['practice-summary', deckId],
    queryFn: async () => practiceResultSchema.parse(await request(`/decks/${deckId}/practice`)),
    staleTime: 0,
  });
  const run = summary.data?.run;
  const statuses = Object.values(run?.statuses ?? {});
  const known = statuses.filter((status) => status === 'known').length;
  const complete = !!run && !run.queue.length && statuses.every((status) => status === 'known');
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-48 w-full flex-col gap-8 rounded-12 border border-subtle bg-sunken p-16 text-left transition-colors hover:bg-raised active:bg-selected"
    >
      <span className="flex w-full items-center justify-between gap-12">
        <span className="text-15 text-primary">
          {t(complete ? 'practice.cleared' : run ? 'practice.resume' : 'practice.title')}
        </span>
        {run && (
          <span className="text-12 text-secondary" data-numeric="">
            {t('practice.knownCount', { known, total: statuses.length })}
          </span>
        )}
      </span>
      {run && <Progress value={known} max={statuses.length} label={t('practice.title')} />}
    </button>
  );
}

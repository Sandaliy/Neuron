import { useQuery } from '@tanstack/react-query';
import { SlidersHorizontal } from 'lucide-react';

import { practiceFieldLabel, practiceFields, practiceResultSchema } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { request, describe } from '../../lib/api';
import { Button } from '../../ui/button';
import { Card } from '../../ui/card';
import { Progress } from '../../ui/progress';
import { ErrorState, Skeleton } from '../../ui/states';

export function PracticeEntry({
  deckId,
  onOpen,
}: {
  readonly deckId: string;
  readonly onOpen: (entry: 'resume' | 'setup') => void;
}) {
  const t = useTranslate();
  const summary = useQuery({
    queryKey: ['practice-summary', deckId],
    queryFn: async () => practiceResultSchema.parse(await request(`/decks/${deckId}/practice`)),
    staleTime: 0,
  });
  const run = summary.data?.run;
  const statuses = Object.values(run?.statuses ?? {});
  const classified = statuses.filter((status) => status !== 'unseen').length;
  return (
    <Card className="flex flex-col gap-16">
      <span className="flex w-full items-center justify-between gap-12">
        <span className="text-15 text-primary">{t('practice.title')}</span>
        {run && (
          <span className="text-12 text-secondary" data-numeric="">
            {t('practice.classified', { count: classified, total: statuses.length })}
          </span>
        )}
      </span>
      {run && (
        <span className="text-12 text-secondary">
          {t('practice.recipe', {
            mode: t(`practice.mode.${run.response ?? 'reveal'}`),
            front: practiceFields(run.front)
              .map((field) => t(practiceFieldLabel(field)))
              .join(' + '),
            back: practiceFields(run.back)
              .map((field) => t(practiceFieldLabel(field)))
              .join(' + '),
          })}
        </span>
      )}
      {summary.isPending ? (
        <Skeleton className="h-44 w-full" />
      ) : summary.error ? (
        <ErrorState
          message={t(describe(summary.error).key)}
          retryLabel={t('common.retry')}
          onRetry={() => void summary.refetch()}
        />
      ) : (
        <>
          {run && <Progress value={classified} max={statuses.length} label={t('practice.title')} />}
          <Button full variant="primary" onClick={() => onOpen('resume')}>
            {t(run ? 'practice.resume' : 'practice.start')}
          </Button>
          <Button
            variant="text"
            className="self-start px-0 text-13 text-secondary"
            onClick={() => onOpen('setup')}
          >
            <SlidersHorizontal size={16} aria-hidden="true" />
            {t('practice.settings')}
          </Button>
        </>
      )}
    </Card>
  );
}

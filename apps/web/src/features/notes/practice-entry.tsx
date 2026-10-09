import { useQuery } from '@tanstack/react-query';
import { SlidersHorizontal } from 'lucide-react';

import { useTranslate } from '../../i18n/locale';
import { describe } from '../../lib/api';
import { practiceQuery } from '../../lib/practice';
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
  const summary = useQuery(practiceQuery(deckId));
  const run = summary.data?.run;
  const statuses = Object.values(run?.statuses ?? {});
  const classified = statuses.filter((status) => status !== 'unseen').length;
  return (
    <Card className="flex flex-col gap-16">
      <div className="flex w-full flex-wrap items-center justify-between gap-8">
        <h2 className="text-17 text-primary">{t('practice.title')}</h2>
        {run && (
          <span className="text-12 text-secondary" data-numeric="">
            {t('practice.classified', { count: classified, total: statuses.length })}
          </span>
        )}
      </div>
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
          <div className="flex flex-col gap-8">
            <Button full variant="primary" onClick={() => onOpen('resume')}>
              {t(run ? 'practice.resume' : 'practice.start')}
            </Button>
            <Button variant="quiet" className="text-13" onClick={() => onOpen('setup')}>
              <SlidersHorizontal size={16} aria-hidden="true" />
              {t('practice.settings')}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

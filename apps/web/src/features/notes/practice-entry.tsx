import { useQuery } from '@tanstack/react-query';
import { SlidersHorizontal } from 'lucide-react';
import { useEffect } from 'react';

import { useTranslate } from '../../i18n/locale';
import { describe } from '../../lib/api';
import { useCapabilities } from '../../lib/capabilities';
import { useOffline } from '../../lib/offline';
import { practiceQuery } from '../../lib/practice';
import { adoptPractice, practiceRecordKey, readPractice } from '../../lib/practice-outbox';
import { Button } from '../../ui/button';
import { Card } from '../../ui/card';
import { Progress } from '../../ui/progress';
import { ErrorState } from '../../ui/states';
import { useToast } from '../../ui/toast';

/**
 * The Deck's Practice as this device knows it. The server's reconciled answer is shown while
 * nothing on the device is newer; otherwise, and whenever the server is away, the device's own.
 */
function usePracticeSummary(deckId: string) {
  const offline = useOffline();
  const capability = useCapabilities();
  const accountId = offline.accountId;
  const server = useQuery({ ...practiceQuery(deckId), enabled: capability.server });
  const local = useQuery({
    queryKey: practiceRecordKey(accountId, deckId),
    queryFn: async () => (await readPractice(accountId!, deckId)) ?? null,
    enabled: accountId !== null && !offline.signedOut,
    networkMode: 'always',
    retry: false,
  });
  useEffect(() => {
    if (server.data && accountId)
      void adoptPractice(accountId, deckId, server.data).catch(() => undefined);
  }, [server.data, accountId, deckId]);
  const record = local.data ?? undefined;
  const deviceAhead =
    !!record &&
    (record.pending.length > 0 ||
      !!record.conflict ||
      !server.data ||
      record.confirmed.version > server.data.version);
  return {
    run: deviceAhead ? (record.device ?? record.confirmed.run) : (server.data?.run ?? null),
    pending: !record && capability.server && server.isPending,
    error: record ? undefined : server.error,
    retry: () => void server.refetch(),
  };
}

export function PracticeEntry({
  deckId,
  onOpen,
}: {
  readonly deckId: string;
  readonly onOpen: (entry: 'resume' | 'setup') => void;
}) {
  const t = useTranslate();
  const toast = useToast();
  const capability = useCapabilities();
  // Practice runs from the downloaded collection just as well as from the server.
  const available = capability.server || capability.localCollection;
  const open = (entry: 'resume' | 'setup') => {
    if (!available) {
      toast.show(t('offline.serverRequired'));
      return;
    }
    onOpen(entry);
  };
  const summary = usePracticeSummary(deckId);
  const run = summary.run;
  const statuses = Object.values(run?.statuses ?? {});
  /*
   * Known is the number that means progress. A sitting where every Note was
   * answered once used to read "12 / 12 classified" with a full bar, which
   * looked finished while half of them were still being learned. The bar and
   * the headline count Known only; what is still being learned or not reached
   * yet is said beside it.
   */
  const known = statuses.filter((status) => status === 'known').length;
  const learning = statuses.filter((status) => status === 'learning').length;
  const unseen = statuses.length - known - learning;
  const total = statuses.length;
  return (
    <Card className="flex flex-col gap-16">
      <div className="flex w-full flex-wrap items-baseline justify-between gap-8">
        <h2 className="text-17 text-primary">{t('practice.title')}</h2>
        {run && total > 0 && (
          <span className="text-13 text-primary tabular-nums">
            {known === total
              ? t('practice.allKnown', { total })
              : t('practice.knownSummary', { known, total })}
          </span>
        )}
      </div>
      {summary.error ? (
        <ErrorState
          message={t(describe(summary.error).key)}
          retryLabel={t('common.retry')}
          onRetry={summary.retry}
        />
      ) : undefined}
      <>
        {run && total > 0 && (
          <div className="flex flex-col gap-8">
            <Progress value={known} max={total} label={t('practice.knownProgress')} />
            {known < total && (
              <p className="text-13 text-secondary tabular-nums">
                {[
                  learning > 0 ? t('practice.learningSummary', { count: learning }) : '',
                  unseen > 0 ? t('practice.unseenSummary', { count: unseen }) : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
          </div>
        )}
        <div className="flex flex-col gap-8">
          <Button
            full
            variant="primary"
            aria-disabled={!available || undefined}
            disabled={available && (summary.pending || !!summary.error)}
            onClick={() => open('resume')}
          >
            {t(run ? 'practice.resume' : 'practice.start')}
          </Button>
          <Button
            variant="quiet"
            className="text-13"
            aria-disabled={!available || undefined}
            disabled={available && (summary.pending || !!summary.error)}
            onClick={() => open('setup')}
          >
            <SlidersHorizontal size={16} aria-hidden="true" />
            {t('practice.settings')}
          </Button>
        </div>
      </>
    </Card>
  );
}

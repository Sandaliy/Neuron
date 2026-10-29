import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { useTranslate } from '../../i18n/locale';
import { useAccount } from '../../lib/account';
import { exportLifecycle } from '../../lib/lifecycle';
import { retryConnection, retryDownload, useOffline } from '../../lib/offline';
import { checkDownloadedStudy } from '../../lib/offline-study';
import { useShellCache } from '../../lib/pwa';
import { Button } from '../../ui/button';
import { Card, GroupLabel } from '../../ui/card';
import { Dialog, DialogBody, DialogFooter } from '../../ui/dialog';
import { Disclosure } from '../../ui/disclosure';

import { PendingNotes } from './pending-notes';
import { PendingRenames } from './pending-renames';
import { PendingReviews } from './pending-reviews';
import { SyncSummary } from './sync-summary';

export function OfflineAccess() {
  const t = useTranslate();
  const state = useOffline();
  const shell = useShellCache();
  const account = useAccount();
  const readiness = useQuery({
    queryKey: [
      'downloaded-study-readiness',
      state.accountId,
      state.revision,
      account.data?.revision,
    ],
    queryFn: ({ signal }) => checkDownloadedStudy(account.data!, signal),
    enabled: state.available && !!account.data,
    networkMode: 'always',
    retry: false,
    staleTime: 30_000,
  });
  const [details, setDetails] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const busy = state.download === 'downloading';
  const failed = state.failure !== null;
  const historyNeedsRecovery = readiness.data?.offlineStudy.limit === 'history';
  const canRebuild =
    historyNeedsRecovery ||
    (failed && ['database', 'transaction', 'recovery'].includes(state.failure!.stage));
  return (
    <section aria-label={t('offline.access')} className="flex flex-col gap-12">
      <GroupLabel>{t('offline.access')}</GroupLabel>
      <Card className="flex flex-col gap-12">
        <SyncSummary />
        <p role="status" className="text-13 text-secondary">
          {t(
            !state.available
              ? 'offline.study.waitingDownload'
              : readiness.isPending || (readiness.isFetching && !readiness.data)
                ? 'offline.study.checking'
                : readiness.error
                  ? 'offline.study.unavailable'
                  : readiness.data?.offlineStudy.limit
                    ? `offline.study.${readiness.data.offlineStudy.limit}`
                    : 'offline.study.verified',
          )}
        </p>
        {historyNeedsRecovery && (
          <p className="text-13 text-secondary">{t('offline.study.historyRecovery')}</p>
        )}
        {!!readiness.data?.offlineStudy.diagnostics.excludedCards && (
          <p className="text-13 text-tertiary">
            {t('offline.study.excluded', {
              count: readiness.data.offlineStudy.diagnostics.excludedCards,
            })}
          </p>
        )}
        {failed && (
          <p className="text-13 text-secondary">{t(`offline.failure.${state.failure!.stage}`)}</p>
        )}
        {failed && (
          <p className="text-13 text-tertiary">
            {t(
              state.offline
                ? state.available
                  ? 'offline.savedAvailable'
                  : 'offline.incomplete'
                : 'offline.onlineAvailable',
            )}
          </p>
        )}
        {!state.offline && (failed || historyNeedsRecovery) && (
          <div className="flex flex-wrap gap-8">
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() =>
                void retryDownload().then(() => readiness.refetch({ cancelRefetch: false }))
              }
            >
              {t('common.retry')}
            </Button>
            {canRebuild && (
              <Button variant="text" disabled={busy} onClick={() => setConfirm(true)}>
                {t('offline.rebuild')}
              </Button>
            )}
          </div>
        )}
        {import.meta.env.PROD && !shell.ready && (
          <p className="text-13 text-tertiary">{t('offline.shellPending')}</p>
        )}
        {shell.waiting && <p className="text-13 text-tertiary">{t('offline.update')}</p>}
        <PendingRenames />
        <PendingNotes />
        <PendingReviews />
        <Disclosure
          title={t('offline.details')}
          open={details}
          onOpenChange={setDetails}
          reveal="progressive"
        >
          <div className="flex flex-col gap-12">
            <p role="status" className="text-13 text-secondary">
              {t(
                state.available
                  ? 'offline.ready'
                  : busy
                    ? 'offline.downloading'
                    : failed
                      ? 'offline.unavailable'
                      : 'offline.pending',
              )}
            </p>
            {state.offline && (
              <p className="text-13 text-secondary">
                {t(
                  state.connectivity === 'unreachable'
                    ? 'offline.session'
                    : 'offline.connectionUncertain',
                )}
              </p>
            )}
            <Button
              variant="quiet"
              aria-label={t('offline.reconnect')}
              busy={state.checking}
              onClick={() => void retryConnection()}
            >
              {t('offline.reconnect')}
            </Button>
            <p className="text-13 text-secondary">{t('offline.readOnly')}</p>
            <Button variant="text" className="self-start" onClick={exportLifecycle}>
              {t('offline.diagnostics')}
            </Button>
          </div>
        </Disclosure>
        <SyncSummary>
          <PendingRenames history />
          <PendingNotes history />
          <PendingReviews history />
        </SyncSummary>
      </Card>
      {state.failure?.code === 'collection_pending_work' && (
        <p role="alert" className="text-13 text-secondary">
          {t('offline.rebuildBlocked')}
        </p>
      )}
      <Dialog open={confirm} onOpenChange={setConfirm} title={t('offline.rebuild')}>
        <DialogBody>
          <p className="text-14 text-secondary">{t('offline.rebuildConfirm')}</p>
        </DialogBody>
        <DialogFooter>
          <Button variant="quiet" onClick={() => setConfirm(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setConfirm(false);
              void retryDownload(true).then(() => readiness.refetch({ cancelRefetch: false }));
            }}
          >
            {t('offline.rebuildAction')}
          </Button>
        </DialogFooter>
      </Dialog>
    </section>
  );
}

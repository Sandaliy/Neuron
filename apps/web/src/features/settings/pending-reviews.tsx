import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { useTranslate } from '../../i18n/locale';
import { useOffline } from '../../lib/offline';
import { reviewEvents, retryReviews, archiveReviewSession } from '../../lib/review-outbox';
import { Button } from '../../ui/button';
import { Card, GroupLabel } from '../../ui/card';
import { Dialog, DialogBody, DialogFooter } from '../../ui/dialog';

import { SavedWork } from './saved-work';

export function PendingReviews() {
  const t = useTranslate();
  const state = useOffline();
  const events = useQuery({
    queryKey: ['review-outbox', state.accountId],
    queryFn: () => reviewEvents(state.accountId!),
    enabled: !!state.accountId,
    networkMode: 'always',
  });
  const retry = useMutation({ mutationFn: retryReviews });
  const [archiveId, setArchiveId] = useState<string>();
  const archive = useMutation({
    mutationFn: archiveReviewSession,
    onSuccess: () => setArchiveId(undefined),
  });
  if (!events.error && !events.data?.length) return null;
  return (
    <section aria-label={t('offline.reviews')} className="flex flex-col gap-12">
      <GroupLabel>{t('offline.reviews')}</GroupLabel>
      <Card className="flex flex-col gap-12">
        {events.error && <p role="alert">{t('offline.changesUnavailable')}</p>}
        <SavedWork
          entries={events.data ?? []}
          title={t('offline.recentActivity')}
          label={(entry) =>
            t(entry.event.type === 'answer' ? 'offline.reviewAnswer' : 'study.undo')
          }
          render={(entry) => (
            <div key={entry.operationId} className="flex flex-col gap-8">
              <p className="text-14 text-primary">
                {t(entry.event.type === 'answer' ? 'offline.reviewAnswer' : 'study.undo')}
              </p>
              <p
                role={entry.state === 'rejected' ? 'alert' : 'status'}
                className="text-13 text-secondary"
              >
                {t(
                  entry.state === 'archived'
                    ? entry.acknowledgement
                      ? 'offline.reviewArchivedConfirmed'
                      : 'offline.reviewArchived'
                    : entry.state === 'synchronized'
                      ? 'offline.workSaved'
                      : entry.state === 'rejected'
                        ? 'offline.reviewRejected'
                        : 'offline.reviewPending',
                )}
              </p>
              {entry.failure && (
                <p className="text-13 text-secondary">
                  {t(
                    entry.failure === 'review_id_reused'
                      ? 'offline.reviewIdReused'
                      : entry.failure === 'card_not_found' || entry.failure === 'not_found'
                        ? 'offline.reviewMissing'
                        : 'offline.reviewInterrupted',
                  )}
                </p>
              )}
              {['pending', 'rejected'].includes(entry.state) && (
                <Button
                  variant="quiet"
                  disabled={!state.validated || state.offline}
                  busy={retry.isPending}
                  onClick={() => retry.mutate()}
                >
                  {t('common.retry')}
                </Button>
              )}
              {entry.state === 'rejected' && (
                <Button variant="text" onClick={() => setArchiveId(entry.sessionId)}>
                  {t('offline.archiveReviews')}
                </Button>
              )}
              <Button
                variant="text"
                onClick={() => void navigator.clipboard.writeText(JSON.stringify(entry, null, 2))}
              >
                {t('offline.copyRecovery')}
              </Button>
            </div>
          )}
        />
        {(retry.error || archive.error) && <p role="alert">{t('offline.reviewInterrupted')}</p>}
      </Card>
      <Dialog
        open={!!archiveId}
        onOpenChange={() => setArchiveId(undefined)}
        title={t('offline.archiveReviews')}
      >
        <DialogBody>
          <p className="text-14 text-secondary">{t('offline.archiveReviewConfirm')}</p>
        </DialogBody>
        <DialogFooter>
          <Button variant="quiet" onClick={() => setArchiveId(undefined)}>
            {t('common.cancel')}
          </Button>
          <Button busy={archive.isPending} onClick={() => archiveId && archive.mutate(archiveId)}>
            {t('offline.archiveReviews')}
          </Button>
        </DialogFooter>
      </Dialog>
    </section>
  );
}

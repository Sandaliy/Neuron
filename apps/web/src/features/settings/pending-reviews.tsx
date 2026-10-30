import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { useTranslate } from '../../i18n/locale';
import { useOffline } from '../../lib/offline';
import { reviewEvents, retryReviews, archiveReviewSession } from '../../lib/review-outbox';
import { Button } from '../../ui/button';
import { Dialog, DialogBody, DialogFooter } from '../../ui/dialog';

import { workIsSettled } from './saved-work';

import type { PendingReview } from '../../lib/review-outbox';

/** Which sentence explains a delivery that did not succeed. */
function explain(failure: string | undefined) {
  if (failure === 'review_id_reused') return 'offline.reviewIdReused' as const;
  if (failure === 'card_not_found' || failure === 'not_found') return 'offline.reviewMissing';
  return 'offline.reviewInterrupted' as const;
}

/**
 * Durable Study delivery, as one piece of work rather than one row per event.
 *
 * A sitting answered with no network holds an immutable event per answer, and
 * drawn one at a time they became a screen of identical headings each with its
 * own Try again, all of which retried the same queue. Worse, the one answer the
 * server actually refused was indistinguishable from the fifteen that were
 * simply waiting their turn.
 *
 * So only the refused ones are listed, grouped by the reason they were refused,
 * and each action appears once; the waiting ones are a count in the section's
 * status. Nothing is discarded: every event keeps its record, and the recovery
 * copy carries all of them.
 */
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
  const saved = (events.data ?? []).filter((entry) => !workIsSettled(entry));
  const attention = saved.filter((entry) => !['pending', 'archived'].includes(entry.state));
  // Waiting answers are counted in the section's status; this lists decisions.
  if (!events.error && !attention.length) return null;
  // One line per distinct reason, however many events share it.
  const reasons = [
    ...new Set(attention.filter((entry) => entry.failure).map((entry) => explain(entry.failure))),
  ];
  const sessions = [...new Set(attention.map((entry) => entry.sessionId))];
  const copy = (entries: PendingReview[]) =>
    void navigator.clipboard.writeText(JSON.stringify(entries, null, 2));
  return (
    <section aria-label={t('offline.reviews')} className="flex flex-col gap-12">
      <p className="text-14 font-semibold text-primary">{t('offline.reviews')}</p>
      <div className="flex flex-col gap-12">
        {events.error && <p role="alert">{t('offline.changesUnavailable')}</p>}
        <p role="alert" className="text-14 text-primary">
          {t(attention.length === 1 ? 'offline.reviewRejected' : 'offline.reviewsAttention', {
            count: attention.length,
          })}
        </p>
        {reasons.map((reason) => (
          <p key={reason} className="text-13 text-secondary">
            {t(reason)}
          </p>
        ))}
        <div className="flex flex-wrap gap-8">
          <Button
            variant="quiet"
            disabled={!state.validated || state.offline}
            busy={retry.isPending}
            onClick={() => retry.mutate()}
          >
            {t('common.retry')}
          </Button>
          {sessions.map((sessionId) => (
            <Button key={sessionId} variant="text" onClick={() => setArchiveId(sessionId)}>
              {t('offline.archiveReviews')}
            </Button>
          ))}
          <Button variant="text" onClick={() => copy(saved)}>
            {t('offline.copyRecovery')}
          </Button>
        </div>
        {(retry.error || archive.error) && <p role="alert">{t('offline.reviewInterrupted')}</p>}
      </div>
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

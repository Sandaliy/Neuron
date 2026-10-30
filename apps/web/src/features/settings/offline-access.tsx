import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, CloudOff, Download } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { MessageKey } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { useAccount } from '../../lib/account';
import { deliverRenames, renames } from '../../lib/collection-outbox';
import { exportLifecycle } from '../../lib/lifecycle';
import { noteEdits, retryNoteEdits } from '../../lib/note-outbox';
import { retryConnection, retryDownload, useOffline } from '../../lib/offline';
import { checkDownloadedStudy } from '../../lib/offline-study';
import { useShellCache } from '../../lib/pwa';
import { retryReviews, reviewEvents } from '../../lib/review-outbox';
import { Button } from '../../ui/button';
import { Card, GroupLabel } from '../../ui/card';
import { Dialog, DialogBody, DialogFooter } from '../../ui/dialog';
import { Disclosure } from '../../ui/disclosure';
import { Spinner } from '../../ui/spinner';

import { PendingNotes } from './pending-notes';
import { PendingRenames } from './pending-renames';
import { PendingReviews } from './pending-reviews';
import { workIsSettled } from './saved-work';

import type { ReactNode } from 'react';

/**
 * Offline & sync, from the learner's side.
 *
 * One status says whether everything is saved, is on its way, is waiting for a
 * connection, or needs a decision. Only the last shows any items, and only the
 * items that need deciding, each with its own way out. Work that has already
 * reached the account is not listed: it needs nothing from anyone, and a list
 * of identical "Study answer" rows was most of what made this section hard to
 * read. Those records stay on the device; they are just not shown.
 *
 * What works offline, the connection check and diagnostics sit behind one
 * disclosure, because they answer questions people rarely have.
 */
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
  const work = useSavedWork();
  const send = useMutation({
    mutationFn: () => Promise.allSettled([retryReviews(), retryNoteEdits(), deliverRenames()]),
  });
  const [details, setDetails] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const section = useRef<HTMLElement>(null);
  // Today links here when saved answers need a decision.
  useEffect(() => {
    if (window.location.hash === '#sync') section.current?.scrollIntoView({ block: 'start' });
  }, []);
  const busy = state.download === 'downloading';
  const failed = state.failure !== null;
  const limit = readiness.data?.offlineStudy.limit;
  const canRebuild =
    limit === 'history' ||
    (failed && ['database', 'transaction', 'recovery'].includes(state.failure!.stage));
  const online = state.validated && !state.offline;

  let status: {
    icon: ReactNode;
    title: string;
    detail?: string;
    note?: string;
    action?: ReactNode;
  };
  /*
   * A broken offline copy comes first: it is what explains everything else
   * that cannot be read, and it says the app still works online.
   */
  if (failed)
    status = {
      icon: <Alert />,
      title: t('offline.unavailable'),
      detail: t(`offline.failure.${state.failure!.stage}` as MessageKey),
      note: t(
        state.offline
          ? state.available
            ? 'offline.savedAvailable'
            : 'offline.incomplete'
          : 'offline.onlineAvailable',
      ),
    };
  else if (work.error) status = { icon: <Alert />, title: t('offline.changesUnavailable') };
  else if (work.attention > 0)
    status = {
      icon: <Alert />,
      title: t('offline.status.attention', { count: work.attention }),
      detail: t('offline.status.attentionDetail'),
    };
  else if (work.waiting > 0 && !online)
    status = {
      icon: <Quiet icon={<CloudOff size={20} strokeWidth={1.5} />} />,
      title: t('offline.status.waitingOffline', { count: work.waiting }),
      detail: t('offline.status.safeDetail'),
    };
  else if (work.waiting > 0)
    status = {
      icon: work.stalled ? (
        <Alert />
      ) : (
        <span className="flex size-20 items-center justify-center text-secondary">
          <Spinner />
        </span>
      ),
      title: t(work.stalled ? 'offline.status.stalled' : 'offline.status.saving', {
        count: work.waiting,
      }),
      ...(work.stalled ? { detail: t('offline.status.safeDetail') } : {}),
      // Not every outbox records why a send failed, so a waiting change can
      // always be sent again by hand. It sends the same saved changes.
      action: (
        <Button variant="quiet" busy={send.isPending} onClick={() => send.mutate()}>
          {t('today.delivery.sendNow')}
        </Button>
      ),
    };
  else if (busy || !state.available)
    status = {
      icon: <Quiet icon={<Download size={20} strokeWidth={1.5} />} />,
      title: t('offline.status.saved'),
      detail: t(busy ? 'offline.downloading' : 'offline.study.waitingDownload'),
    };
  else
    status = {
      icon: <Quiet icon={<CheckCircle2 size={20} strokeWidth={1.5} />} />,
      title: t('offline.status.saved'),
      detail: t(
        readiness.isPending || (readiness.isFetching && !readiness.data)
          ? 'offline.study.checking'
          : readiness.error
            ? 'offline.study.unavailable'
            : limit
              ? (`offline.study.${limit}` as MessageKey)
              : 'offline.study.verified',
      ),
    };

  return (
    <section
      id="sync"
      ref={section}
      aria-label={t('offline.access')}
      className="flex scroll-mt-24 flex-col gap-12"
    >
      <GroupLabel>{t('offline.access')}</GroupLabel>
      <Card className="flex flex-col gap-16">
        <div role="status" className="flex items-start gap-12">
          <span className="shrink-0">{status.icon}</span>
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <p className="text-15 text-primary">{status.title}</p>
            {status.detail && <p className="text-13 text-secondary">{status.detail}</p>}
            {status.note && <p className="text-13 text-secondary">{status.note}</p>}
            {failed && work.error && (
              <p className="text-13 text-secondary">{t('offline.changesUnavailable')}</p>
            )}
          </div>
        </div>
        {work.kept > 0 && <p className="text-13 text-secondary">{t('offline.reviewArchived')}</p>}
        {status.action && <div className="flex">{status.action}</div>}
        {online && (failed || limit === 'history') && (
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
        {shell.waiting && <p className="text-13 text-secondary">{t('offline.update')}</p>}
        {work.attention > 0 && (
          <div className="flex flex-col gap-16 border-t border-subtle pt-16">
            <PendingReviews />
            <PendingNotes />
            <PendingRenames />
          </div>
        )}
        <div className="border-t border-subtle pt-4">
          <Disclosure quiet title={t('offline.works')} open={details} onOpenChange={setDetails}>
            <div className="flex flex-col gap-12 text-13 text-secondary">
              <p>{t('offline.works.available')}</p>
              <p>{t('offline.works.needsConnection')}</p>
              {state.available && <p>{t('offline.ready')}</p>}
              {state.offline && (
                <p>
                  {t(
                    state.connectivity === 'unreachable'
                      ? 'offline.session'
                      : 'offline.connectionUncertain',
                  )}
                </p>
              )}
              {import.meta.env.PROD && !shell.ready && <p>{t('offline.shellPending')}</p>}
              <div className="flex flex-wrap items-center gap-8">
                <Button
                  variant="quiet"
                  aria-label={t('offline.reconnect')}
                  busy={state.checking}
                  onClick={() => void retryConnection()}
                >
                  {t('offline.reconnect')}
                </Button>
                <Button variant="text" onClick={exportLifecycle}>
                  {t('offline.diagnostics')}
                </Button>
              </div>
            </div>
          </Disclosure>
        </div>
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

function Quiet({ icon }: { readonly icon: ReactNode }) {
  return <span className="flex size-20 items-center justify-center text-secondary">{icon}</span>;
}

function Alert() {
  return (
    <span className="flex size-20 items-center justify-center text-primary">
      <AlertCircle size={20} strokeWidth={1.5} aria-hidden="true" />
    </span>
  );
}

/**
 * Every saved change on this device, counted the way the learner thinks of it:
 * how many are on their way, whether the way is blocked, and how many need a
 * decision. Archived Study sessions were a decision already made, so they count
 * as settled.
 */
function useSavedWork() {
  const state = useOffline();
  const options = { enabled: !!state.accountId, networkMode: 'always' as const };
  const names = useQuery({
    queryKey: ['outbox', state.accountId],
    queryFn: () => renames(state.accountId!),
    ...options,
  });
  const notes = useQuery({
    queryKey: ['note-outbox', state.accountId],
    queryFn: () => noteEdits(state.accountId!),
    ...options,
  });
  const reviews = useQuery({
    queryKey: ['review-outbox', state.accountId],
    queryFn: () => reviewEvents(state.accountId!),
    ...options,
  });
  const entries: { state: string; failure?: string | undefined; acknowledgement?: unknown }[] = [
    ...(names.data ?? []),
    ...(notes.data ?? []),
    ...(reviews.data ?? []),
  ];
  const open = entries.filter((entry) => !workIsSettled(entry) && entry.state !== 'archived');
  const waiting = open.filter((entry) => entry.state === 'pending');
  return {
    // Answers kept for recovery were never synchronized; the status says so.
    kept: entries.filter((entry) => entry.state === 'archived' && !workIsSettled(entry)).length,
    error: !!(names.error || notes.error || reviews.error),
    waiting: waiting.length,
    stalled: waiting.some((entry) => entry.failure !== undefined),
    attention: open.length - waiting.length,
  };
}

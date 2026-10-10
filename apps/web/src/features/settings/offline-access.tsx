import { useState } from 'react';

import { useTranslate } from '../../i18n/locale';
import { retryConnection, retryDownload, useOffline } from '../../lib/offline';
import { useShellCache } from '../../lib/pwa';
import { Button } from '../../ui/button';
import { Card, GroupLabel } from '../../ui/card';
import { Dialog, DialogBody, DialogFooter } from '../../ui/dialog';

export function OfflineAccess() {
  const t = useTranslate();
  const state = useOffline();
  const shell = useShellCache();
  const [confirm, setConfirm] = useState(false);
  const busy = state.download === 'downloading';
  const failed = state.failure !== null;
  const canRebuild =
    failed && ['database', 'transaction', 'recovery'].includes(state.failure!.stage);
  return (
    <section aria-label={t('offline.access')} className="flex flex-col gap-12">
      <GroupLabel>{t('offline.access')}</GroupLabel>
      <Card className="flex flex-col gap-12">
        <p role="status" className="text-14 text-secondary">
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
        {state.offline && (
          <>
            <p className="text-13 text-secondary">{t('offline.readOnly')}</p>
            <p className="text-13 text-tertiary">{t('offline.session')}</p>
            <Button variant="quiet" onClick={() => void retryConnection()}>
              {t('offline.reconnect')}
            </Button>
          </>
        )}
        {!state.offline && failed && (
          <div className="flex flex-wrap gap-8">
            <Button variant="quiet" disabled={busy} onClick={() => void retryDownload()}>
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
      </Card>
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
              void retryDownload(true);
            }}
          >
            {t('offline.rebuildAction')}
          </Button>
        </DialogFooter>
      </Dialog>
    </section>
  );
}

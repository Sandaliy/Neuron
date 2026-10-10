import { useTranslate } from '../i18n/locale';
import { retryConnection, retryDownload, useOffline } from '../lib/offline';
import { useShellCache } from '../lib/pwa';
import { Button } from '../ui/button';

export function OfflineStatus() {
  const t = useTranslate();
  const state = useOffline();
  const shell = useShellCache();
  return (
    <>
      {state.offline ? (
        <div role="status" className="mb-20 flex flex-col gap-8 rounded-12 bg-sunken p-16 text-14">
          <p className="font-semibold">{t('offline.title')}</p>
          <p className="text-secondary">{t('offline.readOnly')}</p>
          <p className="text-secondary">{t('offline.session')}</p>
          <Button variant="quiet" onClick={() => void retryConnection()}>
            {t('common.retry')}
          </Button>
          {import.meta.env.PROD && !shell.ready && (
            <p className="text-secondary">{t('offline.shellPending')}</p>
          )}
        </div>
      ) : state.download === 'downloading' || state.download === 'unavailable' ? (
        <div role="status" className="mb-20 flex flex-col gap-8 text-14 text-secondary">
          <p>
            {t(state.download === 'downloading' ? 'offline.downloading' : 'offline.unavailable')}
          </p>
          {state.download === 'unavailable' && (
            <>
              <Button variant="quiet" onClick={() => void retryDownload()}>
                {t('common.retry')}
              </Button>
              <Button
                variant="text"
                onClick={() => void retryDownload(true).catch(() => undefined)}
              >
                {t('offline.rebuild')}
              </Button>
            </>
          )}
        </div>
      ) : null}
      {!state.offline && shell.waiting && (
        <p role="status" className="mb-20 text-14 text-secondary">
          {t('offline.update')}
        </p>
      )}
    </>
  );
}

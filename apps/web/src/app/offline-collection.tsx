import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';

import { OfflineAccess } from '../features/settings/offline-access';
import { useTranslate } from '../i18n/locale';
import { revokeOffline, useOffline } from '../lib/offline';
import { Button } from '../ui/button';

/** Offline entry points for screens whose operations require the server. */
export function OfflineCollection() {
  const t = useTranslate();
  const navigate = useNavigate();
  const client = useQueryClient();
  const state = useOffline();
  const location = useRouterState({ select: (state) => state.location });
  if (location.pathname === '/')
    return (
      <section data-screen="" className="flex flex-col gap-24">
        <header className="flex flex-col gap-4">
          <time className="text-12 text-secondary" dateTime={new Date().toISOString()}>
            {new Intl.DateTimeFormat('en', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            }).format(new Date())}
          </time>
          <h1 className="text-32 tracking-tight text-primary">{t('today.title')}</h1>
        </header>
        <p className="text-14 text-secondary">
          {t(state.available ? 'offline.readOnly' : 'offline.incomplete')}
        </p>
        <Button onClick={() => void navigate({ to: '/library' })}>{t('library.title')}</Button>
      </section>
    );
  if (location.pathname === '/settings')
    return (
      <section data-screen="" className="flex flex-col gap-24">
        <h1 className="font-display text-24 tracking-tight text-primary">{t('settings.title')}</h1>
        <OfflineAccess />
        <Button
          variant="quiet"
          onClick={() => {
            revokeOffline(true);
            client.clear();
            void navigate({ to: '/sign-in' });
          }}
        >
          {t('common.signOut')}
        </Button>
      </section>
    );
  if (!state.available)
    return (
      <section data-screen="" className="flex flex-col gap-20">
        <h1 className="font-display text-24 tracking-tight text-primary">
          {t(location.pathname === '/library' ? 'library.title' : 'notes.title')}
        </h1>
        <p role="status" className="text-14 text-secondary">
          {t('offline.incomplete')}
        </p>
      </section>
    );
  return (
    <section className="flex flex-col gap-20">
      <p className="text-14 text-secondary">{t('offline.readOnly')}</p>
      <Button onClick={() => void navigate({ to: '/library' })}>{t('library.title')}</Button>
    </section>
  );
}

import { useTranslate } from '../i18n/locale';
import { useOffline } from '../lib/offline';

/** Anchored to navigation, outside document flow and keyboard/dialog surfaces. */
export function OfflineStatus() {
  const t = useTranslate();
  const state = useOffline();
  if (!state.offline) return null;
  return (
    <span
      role="status"
      className="pointer-events-none absolute right-16 bottom-full mb-8 rounded-8 bg-sunken px-8 py-4 text-13 text-secondary"
    >
      {t('offline.title')}
    </span>
  );
}

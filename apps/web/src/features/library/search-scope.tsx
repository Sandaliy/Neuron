import { useNavigate } from '@tanstack/react-router';

import { useTranslate } from '../../i18n/locale';
import { accountEpoch, useOffline } from '../../lib/offline';
import { Segmented } from '../../ui/segmented';

/**
 * One search in the Library, over Notes or over Folders and Decks.
 *
 * They were two separate entries on the Library screen that looked the same
 * and searched different things. Now the Library has one way in, and this
 * switch decides what the field searches. Switching replaces the history entry,
 * so Back still leaves search for the Library in one step.
 */
export function SearchScope({ value }: { readonly value: 'notes' | 'collections' }) {
  const t = useTranslate();
  const navigate = useNavigate();
  const offline = useOffline();
  return (
    <Segmented
      value={value}
      label={t('search.scope')}
      options={[
        { value: 'notes', label: t('search.notes') },
        { value: 'collections', label: t('search.collections') },
      ]}
      onChange={(next) =>
        void (next === 'notes'
          ? navigate({ to: '/notes', replace: true })
          : navigate({
              to: '/library/find',
              replace: true,
              state: {
                collectionSearchEntry: { accountId: offline.accountId, visit: accountEpoch() },
              },
            }))
      }
    />
  );
}

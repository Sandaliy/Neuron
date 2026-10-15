import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { API_ERROR_CODES } from '@neuron/shared';
import type { MessageKey, ApiErrorCode } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import {
  deliverRenames,
  renames,
  saveRename,
  keepServerVersion,
} from '../../lib/collection-outbox';
import { retryDownload, useOffline } from '../../lib/offline';
import { Button } from '../../ui/button';

import { SavedWork, workIsSettled } from './saved-work';

export function PendingRenames({ history = false }: { readonly history?: boolean }) {
  const t = useTranslate();
  const state = useOffline();
  const client = useQueryClient();
  const entries = useQuery({
    queryKey: ['outbox', state.accountId],
    queryFn: () => renames(state.accountId!),
    enabled: state.accountId !== null,
    networkMode: 'always',
    placeholderData: () => undefined,
  });
  const retry = useMutation({
    mutationFn: async () => {
      await retryDownload();
      await client.invalidateQueries({ queryKey: ['decks'] });
    },
  });
  const resolve = useMutation({
    mutationFn: async (entry: NonNullable<typeof entries.data>[number]) => {
      await retryDownload();
      await saveRename(entry.entityId, entry.payload.name, entry.operationId);
      await deliverRenames();
      await retryDownload();
      await client.invalidateQueries({ queryKey: ['decks'] });
    },
  });
  const keep = useMutation({ mutationFn: keepServerVersion });
  const saved = (entries.data ?? []).filter((entry) => workIsSettled(entry) === history);
  if (!entries.error && saved.length === 0) return null;
  return (
    <section aria-label={t('offline.savedChanges')} className="flex flex-col gap-12">
      {saved.length > 0 && (
        <p className={history ? 'text-12 text-secondary' : 'text-14 font-semibold text-primary'}>
          {t('offline.savedChanges')}
        </p>
      )}
      <div className="flex flex-col gap-12">
        {entries.error && (
          <p role="alert" className="text-13 text-secondary">
            {t('offline.changesUnavailable')}
          </p>
        )}
        {!entries.error && saved.length === 0 && (
          <p className="text-13 text-secondary">{t('offline.noChanges')}</p>
        )}
        <SavedWork
          entries={saved}
          title={t('offline.savedChanges')}
          label={(entry) => entry.payload.name}
          render={(entry) => (
            <div key={entry.operationId} className="flex flex-col gap-8">
              <p className="text-14 text-primary">{entry.payload.name}</p>
              <p className="text-13 text-secondary">{t(`offline.rename.${entry.state}`)}</p>
              {entry.failure && API_ERROR_CODES.includes(entry.failure as ApiErrorCode) && (
                <p className="text-13 text-secondary">
                  {t(`error.${entry.failure}` as MessageKey)}
                </p>
              )}
              {entry.state === 'conflict' && (
                <p className="text-13 text-secondary">
                  {t(
                    entry.outcome?.reason === 'deleted_remotely'
                      ? 'offline.renameDeleted'
                      : 'offline.renameChanged',
                  )}
                </p>
              )}
              <p className="text-12 text-tertiary">
                {t('offline.originalName', { name: String(entry.base.row['name']) })}
              </p>
              <div className="flex flex-wrap gap-8">
                <Button
                  variant="text"
                  onClick={() => void navigator.clipboard.writeText(entry.payload.name)}
                >
                  {t('offline.copyName')}
                </Button>
                {entry.state === 'pending' && (
                  <Button
                    variant="quiet"
                    disabled={!state.validated || state.offline}
                    busy={retry.isPending}
                    onClick={() => retry.mutate()}
                  >
                    {t('common.retry')}
                  </Button>
                )}
                {entry.state === 'conflict' && entry.outcome?.reason === 'changed_remotely' && (
                  <Button
                    variant="quiet"
                    disabled={!state.validated || state.offline}
                    busy={resolve.isPending}
                    onClick={() => resolve.mutate(entry)}
                  >
                    {t('offline.applySavedName')}
                  </Button>
                )}
                {['conflict', 'rejected'].includes(entry.state) && (
                  <Button
                    variant="text"
                    busy={keep.isPending}
                    onClick={() => keep.mutate(entry.operationId)}
                  >
                    {t('offline.keepServerVersion')}
                  </Button>
                )}
              </div>
            </div>
          )}
        />
        {(retry.error || resolve.error || keep.error) && (
          <p role="alert" className="text-13 text-secondary">
            {t('offline.renameRetryFailed')}
          </p>
        )}
      </div>
    </section>
  );
}

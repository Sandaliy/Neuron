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
import { findDeck, useDeckTree } from '../../lib/decks';
import { retryDownload, useOffline } from '../../lib/offline';
import { Button } from '../../ui/button';

import { workIsSettled } from './saved-work';

export function PendingRenames() {
  const t = useTranslate();
  const state = useOffline();
  const client = useQueryClient();
  const decks = useDeckTree();
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
  // Waiting renames are counted in the section's status; only decisions are listed.
  const saved = (entries.data ?? []).filter(
    (entry) => !workIsSettled(entry) && entry.state !== 'pending',
  );
  if (!entries.error && saved.length === 0) return null;
  return (
    <section aria-label={t('offline.savedChanges')} className="flex flex-col gap-12">
      {saved.length > 0 && (
        <p className="text-14 font-semibold text-primary">{t('offline.savedChanges')}</p>
      )}
      <div className="flex flex-col gap-12">
        {entries.error && (
          <p role="alert" className="text-13 text-secondary">
            {t('offline.changesUnavailable')}
          </p>
        )}
        {saved.map((entry) => {
          const changed =
            entry.state === 'conflict' && entry.outcome?.reason === 'changed_remotely';
          // The name the other device chose, once the download has it.
          const other = findDeck(decks.data ?? [], entry.entityId)?.name;
          const otherName = other && other !== entry.payload.name ? other : undefined;
          return (
            <div key={entry.operationId} className="flex flex-col gap-8">
              <p className="text-14 text-primary">{entry.payload.name}</p>
              <p className="text-13 text-secondary">
                {entry.state !== 'conflict'
                  ? t(`offline.rename.${entry.state}`)
                  : !changed
                    ? t('offline.renameDeleted')
                    : otherName
                      ? t('offline.renameChangedTo', { name: otherName })
                      : t('offline.renameChanged')}
              </p>
              {entry.failure && API_ERROR_CODES.includes(entry.failure as ApiErrorCode) && (
                <p className="text-13 text-secondary">
                  {t(`error.${entry.failure}` as MessageKey)}
                </p>
              )}
              <p className="text-12 text-tertiary">
                {t('offline.originalName', { name: String(entry.base.row['name']) })}
              </p>
              {/* One button for the main choice; the alternatives are text beside it. */}
              <div className="flex flex-wrap items-center gap-x-20 gap-y-8">
                {changed && (
                  <Button
                    disabled={!state.validated || state.offline}
                    busy={resolve.isPending}
                    onClick={() => resolve.mutate(entry)}
                  >
                    {t('offline.applySavedName')}
                  </Button>
                )}
                {entry.state === 'pending' && (
                  <Button
                    disabled={!state.validated || state.offline}
                    busy={retry.isPending}
                    onClick={() => retry.mutate()}
                  >
                    {t('common.retry')}
                  </Button>
                )}
                {['conflict', 'rejected'].includes(entry.state) && (
                  <Button
                    variant={changed ? 'text' : 'quiet'}
                    busy={keep.isPending}
                    onClick={() => keep.mutate(entry.operationId)}
                  >
                    {changed
                      ? otherName
                        ? t('offline.keepOtherName', { name: otherName })
                        : t('offline.keepServerVersion')
                      : t('offline.discardName')}
                  </Button>
                )}
                <Button
                  variant="text"
                  onClick={() => void navigator.clipboard.writeText(entry.payload.name)}
                >
                  {t('offline.copyName')}
                </Button>
              </div>
            </div>
          );
        })}
        {(retry.error || resolve.error || keep.error) && (
          <p role="alert" className="text-13 text-secondary">
            {t('offline.renameRetryFailed')}
          </p>
        )}
      </div>
    </section>
  );
}

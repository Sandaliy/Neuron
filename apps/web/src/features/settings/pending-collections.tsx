import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { useTranslate } from '../../i18n/locale';
import { describe } from '../../lib/api';
import { deckCreations, deckCreationsQueryKey, resolveDeckCreation } from '../../lib/deck-creation';
import { creationAncestors, flatten, useDeckTree } from '../../lib/decks';
import { accountEpoch, offlineState, retryDownload, useOffline } from '../../lib/offline';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Select } from '../../ui/select';
import { collectionPath } from '../library/collection-picker';

import type { PendingDeckCreate } from '../../lib/deck-creation';

export function PendingCollections() {
  const state = useOffline();
  const entries = useQuery({
    queryKey: deckCreationsQueryKey(state.accountId),
    queryFn: () => deckCreations(state.accountId!),
    enabled: !!state.accountId,
    networkMode: 'always',
  });
  return (entries.data ?? [])
    .filter((entry) => ['conflict', 'rejected'].includes(entry.state))
    .map((entry) => <PendingCollection key={entry.payload.operationId} entry={entry} />);
}

function PendingCollection({ entry }: { readonly entry: PendingDeckCreate }) {
  const t = useTranslate();
  const state = useOffline();
  const decks = useDeckTree();
  const [parent, setParent] = useState(entry.payload.parentId ?? '');
  const [name, setName] = useState(entry.payload.name);
  const recover = useMutation({
    mutationFn: async (destination: string | null | undefined) => {
      const visit = accountEpoch();
      const observed = creationAncestors(decks.data ?? [], destination ?? null);
      if (destination !== undefined) await retryDownload();
      if (visit !== accountEpoch() || state.accountId !== offlineState().accountId)
        throw new Error('collection_account_changed');
      await resolveDeckCreation(entry.payload.entityId, destination, name, observed);
    },
  });
  const reason = entry.outcome?.status === 'conflict' ? entry.outcome.reason : 'rejected';
  const folders = flatten(decks.data ?? []).filter((row) => row.kind === 'folder' && row.rev > 0);
  return (
    <section aria-label={entry.payload.name} className="flex flex-col gap-8">
      <p className="text-14 font-semibold text-primary">{entry.payload.name}</p>
      <p className="text-13 text-secondary">{t(`offline.collection.${reason}`)}</p>
      <p className="text-13 text-secondary">
        {t('offline.collection.originalParent', {
          name: entry.ancestors.map((row) => row.name).join(' / ') || t('library.moveRoot'),
        })}
      </p>
      {entry.state === 'conflict' && reason !== 'identity_exists' && (
        <>
          <label htmlFor={`name-${entry.payload.entityId}`} className="text-13 text-secondary">
            {t('library.deckName')}
          </label>
          <Input
            id={`name-${entry.payload.entityId}`}
            value={name}
            maxLength={200}
            onChange={(event) => setName(event.target.value)}
          />
          <label htmlFor={`parent-${entry.payload.entityId}`} className="text-13 text-secondary">
            {t('offline.collection.chooseParent')}
          </label>
          <Select
            id={`parent-${entry.payload.entityId}`}
            value={parent}
            onChange={(event) => setParent(event.target.value)}
          >
            <option value="">{t('library.moveRoot')}</option>
            {folders.map((row) => (
              <option key={row.id} value={row.id}>
                {[collectionPath(decks.data ?? [], row), row.name].filter(Boolean).join(' / ')}
              </option>
            ))}
          </Select>
          <Button
            variant="quiet"
            disabled={
              !name.trim() ||
              !state.validated ||
              state.offline ||
              (parent !== '' && !folders.some((row) => row.id === parent))
            }
            busy={recover.isPending}
            onClick={() => recover.mutate(parent || null)}
          >
            {t('offline.collection.saveHere')}
          </Button>
        </>
      )}
      <div className="flex flex-wrap gap-8">
        <Button
          variant="text"
          onClick={() => void navigator.clipboard.writeText(entry.payload.name)}
        >
          {t('offline.copyName')}
        </Button>
        <Button variant="text" busy={recover.isPending} onClick={() => recover.mutate(undefined)}>
          {t('offline.collection.archive')}
        </Button>
      </div>
      {recover.error && (
        <p role="alert" className="text-13 text-secondary">
          {t(describe(recover.error).key, describe(recover.error).values)}
        </p>
      )}
    </section>
  );
}

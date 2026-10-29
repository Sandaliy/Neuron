import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { useTranslate } from '../../i18n/locale';
import { renames } from '../../lib/collection-outbox';
import { noteEdits } from '../../lib/note-outbox';
import { useOffline } from '../../lib/offline';
import { reviewEvents } from '../../lib/review-outbox';
import { Disclosure } from '../../ui/disclosure';

import { workIsSettled } from './saved-work';

import type { ReactNode } from 'react';

export function SyncSummary({ children }: { readonly children?: ReactNode }) {
  const t = useTranslate();
  const state = useOffline();
  const [open, setOpen] = useState(false);
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
  const entries = [...(names.data ?? []), ...(notes.data ?? []), ...(reviews.data ?? [])];
  const unresolved = entries.filter(
    (entry) =>
      !['synchronized', 'resolved'].includes(entry.state) &&
      !(entry.state === 'archived' && 'acknowledgement' in entry && entry.acknowledgement),
  );
  /*
   * Work that is merely queued is not work that needs the owner. Counting the
   * whole queue as needing attention told someone with one refused answer and
   * fifteen waiting ones that sixteen things were wrong.
   */
  const blocked = unresolved.filter((entry) => entry.state !== 'pending');
  if (children)
    return entries.some(workIsSettled) ? (
      <Disclosure
        title={<span className="font-normal text-secondary">{t('offline.recentActivity')}</span>}
        open={open}
        onOpenChange={setOpen}
        reveal="progressive"
      >
        {open && <div className="flex flex-col gap-16">{children}</div>}
      </Disclosure>
    ) : null;
  return (
    <p role="status" className="text-14 text-primary">
      {t(
        names.error || notes.error || reviews.error
          ? 'offline.changesUnavailable'
          : names.isPending || notes.isPending || reviews.isPending
            ? 'offline.checkingWork'
            : blocked.length
              ? blocked.length === 1
                ? 'offline.workAttentionOne'
                : 'offline.workAttention'
              : unresolved.length
                ? unresolved.length === 1
                  ? 'offline.workPendingOne'
                  : 'offline.workPending'
                : 'offline.workSaved',
        { count: blocked.length || unresolved.length },
      )}
    </p>
  );
}

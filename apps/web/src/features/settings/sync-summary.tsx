import { useQuery } from '@tanstack/react-query';

import { useTranslate } from '../../i18n/locale';
import { renames } from '../../lib/collection-outbox';
import { noteEdits } from '../../lib/note-outbox';
import { useOffline } from '../../lib/offline';
import { reviewEvents } from '../../lib/review-outbox';

export function SyncSummary() {
  const t = useTranslate();
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
  const entries = [...(names.data ?? []), ...(notes.data ?? []), ...(reviews.data ?? [])];
  const unresolved = entries.filter(
    (entry) =>
      !['synchronized', 'resolved'].includes(entry.state) &&
      !(entry.state === 'archived' && 'acknowledgement' in entry && entry.acknowledgement),
  );
  if (!entries.length && !names.error && !notes.error && !reviews.error) return null;
  return (
    <p role="status" className="text-14 text-secondary">
      {t(
        names.error || notes.error || reviews.error
          ? 'offline.changesUnavailable'
          : names.isPending || notes.isPending || reviews.isPending
            ? 'offline.checkingWork'
            : unresolved.some((entry) => !['pending'].includes(entry.state))
              ? 'offline.workAttention'
              : unresolved.length
                ? 'offline.workPending'
                : 'offline.workSaved',
        { count: unresolved.length },
      )}
    </p>
  );
}

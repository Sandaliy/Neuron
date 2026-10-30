import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { useTranslate } from '../../i18n/locale';
import { findDeck, useDeckTree } from '../../lib/decks';
import { useOffline } from '../../lib/offline';
import {
  discardPractice,
  practiceHeld,
  practiceOutboxKey,
  practiceRecords,
} from '../../lib/practice-outbox';
import { Button } from '../../ui/button';

/** Every Deck's saved Practice on this device, kept current as deliveries settle. */
export function usePracticeRecords() {
  const state = useOffline();
  return useQuery({
    queryKey: practiceOutboxKey(state.accountId),
    queryFn: () => practiceRecords(state.accountId!),
    enabled: state.accountId !== null,
    networkMode: 'always',
  });
}

/**
 * Practice that needs the learner: a run kept on two devices, or saved Practice for a Deck the
 * server no longer has. The choice between runs is made on the Practice screen, where both are
 * described; this only leads there.
 */
export function PendingPractice() {
  const t = useTranslate();
  const state = useOffline();
  const navigate = useNavigate();
  const decks = useDeckTree();
  const records = usePracticeRecords();
  const discard = useMutation({
    mutationFn: (deckId: string) => discardPractice(state.accountId!, deckId),
  });
  const decisions = (records.data ?? []).filter(
    (record) => record.conflict || practiceHeld(record),
  );
  if (!records.error && decisions.length === 0) return null;
  return (
    <section aria-label={t('offline.practice.savedChanges')} className="flex flex-col gap-12">
      <p className="text-14 font-semibold text-primary">{t('offline.practice.savedChanges')}</p>
      {records.error && (
        <p role="alert" className="text-13 text-secondary">
          {t('offline.changesUnavailable')}
        </p>
      )}
      {decisions.map((record) => (
        <div key={record.deckId} className="flex flex-col gap-8">
          <p className="text-14 text-primary">
            {findDeck(decks.data ?? [], record.deckId)?.name ?? t('practice.title')}
          </p>
          <p className="text-13 text-secondary">
            {t(record.conflict ? 'offline.practice.conflict' : 'offline.practice.unavailable')}
          </p>
          <div className="flex flex-wrap gap-8">
            {record.conflict ? (
              <Button
                variant="quiet"
                onClick={() =>
                  void navigate({
                    to: '/notes',
                    search: { deckId: record.deckId, learning: 'practice' },
                  })
                }
              >
                {t('offline.practice.open')}
              </Button>
            ) : (
              <Button
                variant="text"
                busy={discard.isPending}
                onClick={() => discard.mutate(record.deckId)}
              >
                {t('offline.practice.discard')}
              </Button>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}

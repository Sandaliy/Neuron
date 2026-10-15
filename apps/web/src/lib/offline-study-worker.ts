import type { DailyStudySessionRequest, Me } from '@neuron/shared';

import { COLLECTION_VERSION, committed, openCollection, result } from './collection-db';
import { planDownloadedStudy } from './offline-study-snapshot';

import type { CollectionMeta, CollectionRow } from './collection-db';

/** Collection cloning, schema validation, replay and forecast never occupy the UI thread. */
self.onmessage = async (
  message: MessageEvent<{
    id: number;
    accountId: string;
    request: Partial<DailyStudySessionRequest>;
    now: string;
    knownAccount?: Me;
  }>,
) => {
  const { id, accountId, request, now } = message.data;
  let db: IDBDatabase | undefined;
  try {
    db = await openCollection(accountId);
    const entities = ['decks', 'notes', 'cards', 'reviews'] as const;
    const tx = db.transaction(['meta', 'outbox', 'review-outbox', ...entities]);
    const done = committed(tx);
    const [meta, account, reviewSequence, edits, events, rows] = await Promise.all([
      result<CollectionMeta | undefined>(tx.objectStore('meta').get('sync')),
      result<unknown>(tx.objectStore('meta').get('account')),
      result<number | undefined>(tx.objectStore('meta').get('review-sequence')),
      result<unknown[]>(tx.objectStore('outbox').getAll()),
      result<unknown[]>(tx.objectStore('review-outbox').getAll()),
      Promise.all(
        entities.map((entity) => result<CollectionRow[]>(tx.objectStore(entity).getAll())),
      ),
      done,
    ]);
    if (!meta?.complete || meta.format !== COLLECTION_VERSION)
      throw new Error('offline_study_incomplete');
    const started = performance.now();
    const plan = planDownloadedStudy(
      {
        account,
        cursor: meta.cursor,
        complete: meta.complete,
        reviewSequence: reviewSequence ?? 0,
        edits,
        events,
        decks: rows[0]!,
        notes: rows[1]!,
        cards: rows[2]!,
        reviews: rows[3]!,
      },
      accountId,
      request,
      new Date(now),
      message.data.knownAccount,
    );
    self.postMessage({ id, plan, planningMs: performance.now() - started });
  } catch (error) {
    const code =
      error instanceof Error &&
      [
        'offline_study_incomplete',
        'offline_study_history',
        'offline_study_settings',
        'offline_study_account',
      ].includes(error.message)
        ? error.message
        : 'offline_study_unavailable';
    self.postMessage({ id, error: code });
  } finally {
    db?.close();
  }
};

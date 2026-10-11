import {
  cardSchema,
  reviewResultSchema,
  submitReviewSchema,
  undoReviewSchema,
  undoReviewResultSchema,
} from '@neuron/shared';
import type { Card, ReviewResult } from '@neuron/shared';

import { ApiFailure, request } from './api';
import { committed, openCollection, result, COLLECTION_VERSION } from './collection-db';
import { accountEpoch, offlineState } from './offline';

import type { CollectionMeta } from './collection-db';

export type ReviewIntent =
  | {
      type: 'answer';
      payload: {
        id: string;
        cardId: string;
        rating: 'again' | 'hard' | 'good' | 'easy';
        reviewedAt: string;
        durationMs: number;
      };
    }
  | { type: 'undo'; payload: { id: string; reviewId: string; reviewedAt: string } };
function validateEvent(event: ReviewIntent) {
  if (event.type === 'answer') submitReviewSchema.parse(event.payload);
  else if (event.type === 'undo') undoReviewSchema.parse(event.payload);
  else throw new Error('review_invalid_outbox');
}
// Keep timestamps as their original JSON strings, including after validation.
export interface PendingReview {
  kind: 'review-event';
  operationId: string;
  accountId: string;
  sessionId: string;
  sequence: number;
  predecessor: string | null;
  event: ReviewIntent;
  before: Card;
  state: 'pending' | 'rejected' | 'synchronized' | 'archived';
  failure?: string | undefined;
  acknowledgement?:
    ReviewResult | { id: string; reviewId: string; cancellationId: string; card: Card };
}
type Change = { accountId: string; saved: boolean; entry?: PendingReview };
const listeners = new Set<(change: Change) => void>();
const channel =
  typeof BroadcastChannel === 'undefined'
    ? undefined
    : new BroadcastChannel('neuron.reviews.changed');
function changed(change: Change) {
  listeners.forEach((listener) => listener(change));
  channel?.postMessage({ accountId: change.accountId, saved: change.saved });
}
channel?.addEventListener('message', (event: MessageEvent<Change>) => {
  if (typeof event.data?.accountId === 'string' && typeof event.data.saved === 'boolean')
    listeners.forEach((listener) => listener(event.data));
});
export function onReviewOutboxChange(listener: (change: Change) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function validate(value: unknown, accountId: string): PendingReview {
  const entry = value as PendingReview;
  if (
    !entry ||
    entry.kind !== 'review-event' ||
    !Number.isSafeInteger(entry.sequence) ||
    entry.sequence < 1 ||
    !['pending', 'rejected', 'synchronized', 'archived'].includes(entry.state)
  )
    throw new Error('review_invalid_outbox');
  cardSchema.parse(entry.before);
  validateEvent(entry.event);
  undoReviewSchema.parse({ id: entry.sessionId, reviewId: entry.operationId });
  if (entry.predecessor)
    undoReviewSchema.parse({ id: entry.predecessor, reviewId: entry.operationId });
  if (entry.acknowledgement)
    (entry.event.type === 'answer' ? reviewResultSchema : undoReviewResultSchema).parse(
      entry.acknowledgement,
    );
  const parsed = entry;
  if (
    parsed.accountId !== accountId ||
    parsed.operationId !== parsed.event.payload.id ||
    (parsed.event.type === 'answer' && parsed.event.payload.cardId !== parsed.before.id) ||
    (parsed.state === 'synchronized' && !parsed.acknowledgement) ||
    (parsed.acknowledgement &&
      (parsed.acknowledgement.id !== parsed.operationId ||
        parsed.acknowledgement.card.id !== parsed.before.id ||
        (parsed.event.type === 'answer' &&
          (!('cardId' in parsed.acknowledgement) ||
            parsed.acknowledgement.cardId !== parsed.before.id)) ||
        (parsed.event.type === 'undo' &&
          (!('reviewId' in parsed.acknowledgement) ||
            parsed.acknowledgement.reviewId !== parsed.event.payload.reviewId))))
  )
    throw new Error('review_invalid_outbox');
  return entry;
}
export async function reviewEvents(accountId: string): Promise<PendingReview[]> {
  const db = await openCollection(accountId);
  try {
    const entries = await result<unknown[]>(
      db.transaction('review-outbox').objectStore('review-outbox').getAll(),
    );
    return entries
      .map((entry) => validate(entry, accountId))
      .sort((a, b) => a.sequence - b.sequence);
  } finally {
    db.close();
  }
}

/** The UI may advance only after this transaction's complete event. */
export async function saveReviewIntent(
  accountId: string,
  sessionId: string,
  event: ReviewIntent,
  before: Card,
): Promise<void> {
  validateEvent(event);
  const visit = accountEpoch();
  const active = () =>
    visit === accountEpoch() && offlineState().accountId === accountId && !offlineState().signedOut;
  if (!active()) throw new Error('review_account_changed');
  const db = await openCollection(accountId);
  try {
    const tx = db.transaction(['meta', 'review-outbox'], 'readwrite', { durability: 'strict' });
    const done = committed(tx);
    const store = tx.objectStore('review-outbox');
    const metaRead = tx.objectStore('meta').get('sync');
    const sequenceRead = tx.objectStore('meta').get('review-sequence');
    const headRead = tx.objectStore('meta').get(`review-head:${sessionId}`);
    const closedRead = tx.objectStore('meta').get(`review-closed:${sessionId}`);
    const targetRead = store.get(event.type === 'undo' ? event.payload.reviewId : event.payload.id);
    const read = store.get(event.payload.id);
    read.onsuccess = () => {
      try {
        if (!active()) throw new Error('review_account_changed');
        if (closedRead.result) throw new Error('review_session_archived');
        const meta: CollectionMeta = metaRead.result ?? {
          cursor: 0,
          complete: false,
          format: COLLECTION_VERSION,
        };
        const previousSequence: number = sequenceRead.result ?? 0;
        const sequence = previousSequence + 1;
        if (
          meta.format !== COLLECTION_VERSION ||
          !Number.isSafeInteger(previousSequence) ||
          previousSequence < 0 ||
          !Number.isSafeInteger(sequence)
        )
          throw new Error('review_invalid_outbox');
        if (read.result) {
          const duplicate = validate(read.result, accountId);
          if (
            JSON.stringify(duplicate.event) !== JSON.stringify(event) ||
            duplicate.sessionId !== sessionId
          )
            throw new Error('review_id_reused');
          return;
        }
        if (event.type === 'undo') {
          const target = validate(targetRead.result, accountId);
          if (
            target.sessionId !== sessionId ||
            target.event.type !== 'answer' ||
            target.before.id !== before.id
          )
            throw new Error('review_missing_answer');
        }
        const predecessor: string | null = headRead.result ?? null;
        const entry: PendingReview = {
          kind: 'review-event',
          operationId: event.payload.id,
          accountId,
          sessionId,
          sequence,
          predecessor,
          event,
          before,
          state: 'pending',
        };
        validate(entry, accountId);
        store.add(entry);
        tx.objectStore('meta').put(entry.operationId, `review-head:${sessionId}`);
        // Collection rebuild may replace sync metadata, but never this counter.
        tx.objectStore('meta').put(sequence, 'review-sequence');
      } catch {
        tx.abort();
      }
    };
    await done;
    if (!active()) throw new Error('review_account_changed');
    changed({ accountId, saved: true });
  } finally {
    db.close();
  }
}

let delivery: Promise<void> | undefined;
let controller: AbortController | undefined;
let wake = false;
export function cancelReviewDelivery() {
  controller?.abort();
}
async function settle(entry: PendingReview, patch: Partial<PendingReview>, active: () => boolean) {
  const db = await openCollection(entry.accountId);
  try {
    const tx = db.transaction('review-outbox', 'readwrite', { durability: 'strict' });
    const done = committed(tx);
    const store = tx.objectStore('review-outbox');
    const read = store.get(entry.operationId);
    let settled: PendingReview | undefined;
    read.onsuccess = () => {
      if (!active()) {
        tx.abort();
        return;
      }
      try {
        const current = validate(read.result, entry.accountId);
        settled =
          current.state === 'synchronized'
            ? current
            : current.state === 'archived'
              ? patch.acknowledgement
                ? { ...current, acknowledgement: patch.acknowledgement, failure: undefined }
                : current
              : { ...current, ...patch };
        store.put(settled);
      } catch {
        tx.abort();
      }
    };
    await done;
    if (active() && settled) changed({ accountId: entry.accountId, saved: false, entry: settled });
  } finally {
    db.close();
  }
}

/** One causal stream. An uncertain response never removes or changes an intent. */
export function deliverReviews(): Promise<void> {
  if (delivery) {
    wake = true;
    return delivery;
  }
  const accountId = offlineState().accountId;
  const visit = accountEpoch();
  const active = () =>
    visit === accountEpoch() &&
    offlineState().accountId === accountId &&
    offlineState().validated &&
    !offlineState().offline &&
    !offlineState().signedOut;
  if (!accountId || !active()) return Promise.resolve();
  const own = (async () => {
    while (active()) {
      const db = await openCollection(accountId);
      let entry: PendingReview | undefined;
      let predecessor: PendingReview | undefined;
      try {
        const store = db.transaction('review-outbox').objectStore('review-outbox');
        const [pending, rejected] = await Promise.all([
          result<PendingReview[]>(store.index('state').getAll('pending')),
          result<PendingReview[]>(store.index('state').getAll('rejected')),
        ]);
        entry = [...pending, ...rejected]
          .map((item) => validate(item, accountId))
          .sort((a, b) => a.sequence - b.sequence)[0];
        if (entry?.predecessor) {
          const previous = await result(
            db.transaction('review-outbox').objectStore('review-outbox').get(entry.predecessor),
          );
          if (previous) predecessor = validate(previous, accountId);
        }
      } finally {
        db.close();
      }
      if (!active() || !entry || entry.state === 'rejected') return;
      if (entry.predecessor && predecessor?.state !== 'synchronized') {
        await settle(entry, { state: 'rejected', failure: 'missing_predecessor' }, active);
        return;
      }
      const ownController = new AbortController();
      controller = ownController;
      // A suspended/lost request cannot hold the delivery coordinator forever.
      const timeout = setTimeout(() => ownController.abort(), 15_000);
      try {
        const raw = await request(entry.event.type === 'answer' ? '/reviews' : '/reviews/undo', {
          method: 'POST',
          body: entry.event.payload,
          signal: ownController.signal,
        });
        const acknowledgement =
          entry.event.type === 'answer'
            ? reviewResultSchema.parse(raw)
            : undoReviewResultSchema.parse(raw);
        if (
          acknowledgement.id !== entry.operationId ||
          acknowledgement.card.id !== entry.before.id ||
          (entry.event.type === 'answer' &&
            (!('cardId' in acknowledgement) ||
              acknowledgement.cardId !== entry.event.payload.cardId)) ||
          (entry.event.type === 'undo' &&
            (!('reviewId' in acknowledgement) ||
              acknowledgement.reviewId !== entry.event.payload.reviewId))
        )
          throw new Error('invalid_acknowledgement');
        if (!active()) return;
        await settle(entry, { state: 'synchronized', acknowledgement, failure: undefined }, active);
      } catch (error) {
        if (!active()) return;
        const rejected =
          error instanceof ApiFailure && [400, 403, 404, 409, 422].includes(error.status);
        await settle(
          entry,
          {
            state: rejected ? 'rejected' : 'pending',
            failure:
              error instanceof ApiFailure
                ? error.code
                : ownController.signal.aborted
                  ? 'interrupted'
                  : 'invalid_acknowledgement',
          },
          active,
        );
        wake = false;
        return;
      } finally {
        clearTimeout(timeout);
      }
    }
  })()
    .catch(() => undefined)
    .finally(() => {
      if (delivery === own) {
        delivery = undefined;
        if (wake) {
          wake = false;
          void deliverReviews();
        }
      }
    });
  delivery = own;
  return own;
}
export async function retryReviews() {
  const accountId = offlineState().accountId;
  const visit = accountEpoch();
  if (!accountId || !offlineState().validated || offlineState().offline) return;
  const active = () =>
    visit === accountEpoch() &&
    offlineState().accountId === accountId &&
    offlineState().validated &&
    !offlineState().offline;
  for (const entry of await reviewEvents(accountId))
    if (entry.state === 'rejected')
      await settle(entry, { state: 'pending', failure: undefined }, active);
  await deliverReviews();
}
export async function requireDeliveredReviews(accountId: string) {
  await deliverReviews();
  if (
    (await reviewEvents(accountId)).some(
      (entry) => !['synchronized', 'archived'].includes(entry.state),
    )
  )
    throw new Error('review_delivery_pending');
}

/** Deliberate recovery closes an ended sitting without inventing a server acknowledgement. */
export async function archiveReviewSession(sessionId: string) {
  const accountId = offlineState().accountId;
  const visit = accountEpoch();
  if (!accountId) throw new Error('review_account_changed');
  const active = () => visit === accountEpoch() && offlineState().accountId === accountId;
  const db = await openCollection(accountId);
  try {
    const tx = db.transaction(['meta', 'review-outbox'], 'readwrite', { durability: 'strict' });
    const done = committed(tx);
    const store = tx.objectStore('review-outbox');
    const read = store.getAll();
    read.onsuccess = () => {
      try {
        if (!active()) throw new Error('review_account_changed');
        const session = (read.result as unknown[])
          .map((item) => validate(item, accountId))
          .filter((entry) => entry.sessionId === sessionId);
        if (!session.some((entry) => entry.state === 'rejected'))
          throw new Error('review_archive_requires_rejection');
        for (const entry of session)
          if (entry.state !== 'synchronized') store.put({ ...entry, state: 'archived' });
        tx.objectStore('meta').put(true, `review-closed:${sessionId}`);
      } catch {
        tx.abort();
      }
    };
    await done;
    if (active()) changed({ accountId, saved: true });
  } finally {
    db.close();
  }
}

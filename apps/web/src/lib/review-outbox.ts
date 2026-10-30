import {
  reviewBatchResultSchema,
  reviewResultSchema,
  undoReviewResultSchema,
} from '@neuron/shared';
import type { Card } from '@neuron/shared';

import { ApiFailure, request } from './api';
import { committed, openCollection, result, COLLECTION_VERSION } from './collection-db';
import { accountEpoch, offlineState } from './offline';
import { validateEvent, validateReviewIntent as validate } from './review-intent';

import type { CollectionMeta } from './collection-db';
import type { PendingReview, ReviewIntent } from './review-intent';

export type { PendingReview, ReviewIntent } from './review-intent';

type Change = {
  accountId: string;
  saved: boolean;
  entry?: PendingReview;
  /** A whole delivered run, settled in one transaction and announced once. */
  entries?: PendingReview[];
};
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

/**
 * How many answers travel in one request.
 *
 * The endpoint accepts five hundred. A lower number keeps one request's body,
 * its server transaction and its timeout to a size a phone on a slow
 * connection can actually finish, and a long backlog simply takes a few
 * requests instead of one that cannot complete.
 */
const BATCH_LIMIT = 50;

type AnswerReview = PendingReview & { event: Extract<ReviewIntent, { type: 'answer' }> };
const isAnswer = (entry: PendingReview): entry is AnswerReview => entry.event.type === 'answer';

let delivery: Promise<void> | undefined;
let controller: AbortController | undefined;
let wake = false;

/*
 * A delivery that ended without an answer from the server is tried again by
 * itself. It used to wait for the app to come back to the foreground or for
 * Retry in Settings, and Today told the learner to go and press it, so a
 * single dropped request on reconnection held new Study until they did. The
 * retry sends the same frozen payloads with the same identities, which is
 * exactly what Retry does. A refusal is not retried: that needs a decision.
 */
const RETRY_DELAYS = [2_000, 5_000, 15_000, 30_000, 60_000];
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryAttempt = 0;
function scheduleRetry() {
  clearTimeout(retryTimer);
  const delay = RETRY_DELAYS[Math.min(retryAttempt, RETRY_DELAYS.length - 1)]!;
  retryAttempt += 1;
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    void deliverReviews();
  }, delay);
}

export function cancelReviewDelivery() {
  controller?.abort();
  clearTimeout(retryTimer);
  retryTimer = undefined;
  retryAttempt = 0;
}
/**
 * What a stored entry becomes once a delivery has an answer for it.
 *
 * A synchronized entry is finished and never moves again. An archived one was
 * closed by deliberate recovery, so a late acknowledgement is recorded against
 * it without reopening it.
 */
function merge(current: PendingReview, patch: Partial<PendingReview>): PendingReview {
  if (current.state === 'synchronized') return current;
  if (current.state === 'archived')
    return patch.acknowledgement
      ? { ...current, acknowledgement: patch.acknowledgement, failure: undefined }
      : current;
  return { ...current, ...patch };
}

/**
 * Settles one delivered run in a single transaction and announces it once.
 *
 * A run settled entry by entry makes the screen rearrange itself once per
 * answer while it drains, and costs a database open each time. The whole run
 * reached the server together, so it leaves the outbox together too.
 */
async function settleAll(
  accountId: string,
  patches: Map<string, Partial<PendingReview>>,
  active: () => boolean,
) {
  const db = await openCollection(accountId);
  try {
    const tx = db.transaction('review-outbox', 'readwrite', { durability: 'strict' });
    const done = committed(tx);
    const store = tx.objectStore('review-outbox');
    const settled: PendingReview[] = [];
    for (const [operationId, patch] of patches) {
      const read = store.get(operationId);
      read.onsuccess = () => {
        if (!active()) {
          tx.abort();
          return;
        }
        try {
          const next = merge(validate(read.result, accountId), patch);
          store.put(next);
          settled.push(next);
        } catch {
          tx.abort();
        }
      };
    }
    await done;
    if (active() && settled.length)
      changed({
        accountId,
        saved: false,
        ...(settled.length === 1 ? { entry: settled[0] } : {}),
        entries: settled,
      });
  } finally {
    db.close();
  }
}

function settle(entry: PendingReview, patch: Partial<PendingReview>, active: () => boolean) {
  return settleAll(entry.accountId, new Map([[entry.operationId, patch]]), active);
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
    /*
     * Set when the server refuses a whole batch.
     *
     * The refusal names the body, not the answer inside it that caused it, so
     * the run is taken apart and delivered one entry at a time until the
     * offending one is rejected on its own.
     */
    let solo = false;
    while (active()) {
      const db = await openCollection(accountId);
      let queued: PendingReview[];
      let predecessor: PendingReview | undefined;
      try {
        const store = db.transaction('review-outbox').objectStore('review-outbox');
        const [pending, rejected] = await Promise.all([
          result<PendingReview[]>(store.index('state').getAll('pending')),
          result<PendingReview[]>(store.index('state').getAll('rejected')),
        ]);
        queued = [...pending, ...rejected]
          .map((item) => validate(item, accountId))
          .sort((a, b) => a.sequence - b.sequence);
        const first = queued[0];
        if (first?.predecessor) {
          const previous = await result(
            db.transaction('review-outbox').objectStore('review-outbox').get(first.predecessor),
          );
          if (previous) predecessor = validate(previous, accountId);
        }
      } finally {
        db.close();
      }
      const entry = queued[0];
      if (!active() || !entry || entry.state === 'rejected') return;
      if (entry.predecessor && predecessor?.state !== 'synchronized') {
        await settle(entry, { state: 'rejected', failure: 'missing_predecessor' }, active);
        return;
      }
      /*
       * The leading run of answers travels as one request.
       *
       * A sitting answered with no network holds one immutable event per
       * answer, and one request each multiplies the round trip by the number of
       * answers: the phone that waited forty seconds was paying for seventeen
       * of them in a row. An Undo cancels a specific answer, so it ends the run
       * and goes on its own, which is what keeps the causal chain readable.
       *
       * Only an unbroken predecessor chain is batched, so a gap is still
       * delivered and judged one entry at a time.
       */
      const answers = !solo && isAnswer(entry) ? [entry] : [];
      if (answers.length)
        for (const next of queued.slice(1)) {
          if (
            answers.length >= BATCH_LIMIT ||
            next.state !== 'pending' ||
            !isAnswer(next) ||
            next.predecessor !== answers[answers.length - 1]!.operationId
          )
            break;
          answers.push(next);
        }
      const batched = answers.length > 1;
      const run: PendingReview[] = batched ? answers : [entry];
      const ownController = new AbortController();
      controller = ownController;
      // A suspended/lost request cannot hold the delivery coordinator forever.
      const timeout = setTimeout(() => ownController.abort(), 15_000 + (run.length - 1) * 250);
      try {
        const raw = await request(
          batched ? '/reviews/batch' : entry.event.type === 'answer' ? '/reviews' : '/reviews/undo',
          {
            method: 'POST',
            body: batched
              ? { reviews: run.map((item) => item.event.payload) }
              : entry.event.payload,
            signal: ownController.signal,
          },
        );
        const patches = new Map<string, Partial<PendingReview>>();
        if (batched) {
          const outcome = reviewBatchResultSchema.parse(raw);
          const skipped = new Map(outcome.skipped.map((item) => [item.id, item]));
          const acknowledged = new Map(outcome.results.map((item) => [item.id, item]));
          for (const item of answers) {
            const refusal = skipped.get(item.operationId);
            if (refusal) {
              if (refusal.cardId !== item.event.payload.cardId)
                throw new Error('invalid_acknowledgement');
              patches.set(item.operationId, { state: 'rejected', failure: refusal.reason });
              continue;
            }
            const acknowledgement = acknowledged.get(item.operationId);
            if (
              !acknowledgement ||
              acknowledgement.card.id !== item.before.id ||
              acknowledgement.cardId !== item.event.payload.cardId
            )
              throw new Error('invalid_acknowledgement');
            patches.set(item.operationId, {
              state: 'synchronized',
              acknowledgement,
              failure: undefined,
            });
          }
        } else {
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
          patches.set(entry.operationId, {
            state: 'synchronized',
            acknowledgement,
            failure: undefined,
          });
        }
        if (!active()) return;
        await settleAll(accountId, patches, active);
        retryAttempt = 0;
        // A server that refused part of the run leaves that entry recoverable
        // rather than quietly delivering what causally followed it.
        if ([...patches.values()].some((patch) => patch.state === 'rejected')) return;
      } catch (error) {
        if (!active()) return;
        const rejected =
          error instanceof ApiFailure && [400, 403, 404, 409, 422].includes(error.status);
        const failure =
          error instanceof ApiFailure
            ? error.code
            : ownController.signal.aborted
              ? 'interrupted'
              : 'invalid_acknowledgement';
        // A refused batch is retried one entry at a time, so the answer the
        // server objected to is the one that stops, not the whole sitting.
        await settleAll(
          accountId,
          new Map([
            [
              entry.operationId,
              { state: !batched && rejected ? 'rejected' : 'pending', failure } as const,
            ],
          ]),
          active,
        );
        wake = false;
        if (batched && rejected) {
          solo = true;
          continue;
        }
        if (!rejected) scheduleRetry();
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

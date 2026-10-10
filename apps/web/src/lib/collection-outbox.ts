import {
  deckSchema,
  renameDeckCommandSchema,
  renameDeckResultSchema,
  uuidV7,
} from '@neuron/shared';
import type { Deck, RenameDeckCommand, RenameDeckResult } from '@neuron/shared';

import { ApiFailure, request } from './api';
import { committed, openCollection, result } from './collection-db';
import { accountEpoch, offlineState } from './offline';

import type { CollectionMeta, CollectionRow } from './collection-db';

export interface PendingRename {
  operationId: string;
  accountId: string;
  entityId: string;
  payload: RenameDeckCommand;
  base: CollectionRow;
  state: 'pending' | 'conflict' | 'rejected' | 'synchronized' | 'resolved';
  outcome?: RenameDeckResult;
  failure?: string;
}
const listeners = new Set<() => void>();
export const onOutboxChange = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const channel =
  typeof BroadcastChannel === 'undefined'
    ? undefined
    : new BroadcastChannel('neuron.collection.changed');
const notify = () => listeners.forEach((listener) => listener());
channel?.addEventListener('message', notify);
function changed() {
  notify();
  channel?.postMessage('changed');
}

export function validateRenames(input: unknown, accountId: string): PendingRename[] {
  if (!Array.isArray(input)) throw new Error('collection_invalid_outbox');
  return input.map((entry: PendingRename) => {
    const payload = renameDeckCommandSchema.parse(entry.payload);
    if (
      entry.accountId !== accountId ||
      payload.accountId !== accountId ||
      entry.operationId !== payload.operationId ||
      entry.base?.entity !== 'decks' ||
      entry.base.id !== entry.entityId ||
      entry.base.rev !== payload.baseRev ||
      entry.base.row['rev'] !== payload.baseRev ||
      entry.base.deleted ||
      entry.base.purged ||
      !['pending', 'synchronized', 'conflict', 'rejected', 'resolved'].includes(entry.state)
    )
      throw new Error('collection_invalid_outbox');
    const base = deckSchema.parse({ ...entry.base.row, path: [] });
    if (base.id !== entry.entityId) throw new Error('collection_invalid_outbox');
    if (entry.outcome) {
      const outcome = renameDeckResultSchema.parse(entry.outcome);
      if (outcome.operationId !== entry.operationId) throw new Error('collection_invalid_outbox');
    }
    if (
      entry.state === 'synchronized' &&
      (entry.outcome?.status !== 'applied' || entry.outcome.revision <= payload.baseRev)
    )
      throw new Error('collection_invalid_outbox');
    return entry;
  });
}

export async function renames(accountId: string): Promise<PendingRename[]> {
  const db = await openCollection(accountId);
  try {
    return validateRenames(
      await result(db.transaction('outbox').objectStore('outbox').getAll()),
      accountId,
    );
  } finally {
    db.close();
  }
}

/** Intent is the local name overlay: both become durable in this single transaction. */
export async function saveRename(id: string, name: string, resolveId?: string, observed?: Deck) {
  const accountId = offlineState().accountId;
  const visit = accountEpoch();
  if (!accountId || offlineState().signedOut) throw new Error('collection_no_account');
  const db = await openCollection(accountId);
  try {
    const tx = db.transaction(['meta', 'decks', 'outbox'], 'readwrite');
    const done = committed(tx);
    const store = tx.objectStore('outbox');
    let failure: unknown;
    let written: PendingRename | undefined;
    const reads = [
      tx.objectStore('meta').get('sync'),
      tx.objectStore('decks').get(id),
      store.getAll(),
    ];
    // All requests are queued before awaiting, keeping WebKit's transaction active.
    reads.at(-1)!.onsuccess = () => {
      try {
        const meta = reads[0]!.result as CollectionMeta | undefined;
        const storedBase = reads[1]!.result as CollectionRow | undefined;
        // The dialog's observed server row owns the compare-and-set, even if a
        // background pull advanced this device while that dialog was open.
        const base = observed
          ? {
              entity: 'decks' as const,
              id,
              rev: observed.rev,
              deleted: false,
              purged: false,
              row: { ...deckSchema.parse(observed) },
            }
          : storedBase;
        const entries = validateRenames(reads[2]!.result, accountId);
        if (visit !== accountEpoch() || offlineState().accountId !== accountId)
          throw new Error('collection_account_changed');
        if (
          !meta?.complete ||
          meta.format !== 1 ||
          !storedBase ||
          storedBase.deleted ||
          storedBase.purged ||
          !base ||
          base.id !== id
        )
          throw new Error('collection_incomplete');
        if (
          entries.some(
            (entry) =>
              entry.entityId === id &&
              (entry.state === 'pending' ||
                (entry.state === 'synchronized' && entry.outcome!.revision > base.rev)),
          )
        )
          throw new Error('collection_rename_pending');
        if (resolveId) {
          const previous = entries.find((entry) => entry.operationId === resolveId);
          if (
            !previous ||
            previous.entityId !== id ||
            !['conflict', 'rejected'].includes(previous.state)
          )
            throw new Error('collection_invalid_resolution');
          store.put({ ...previous, state: 'resolved' });
        }
        const payload = renameDeckCommandSchema.parse({
          accountId,
          operationId: uuidV7(),
          baseRev: base.rev,
          name,
        });
        written = {
          operationId: payload.operationId,
          accountId,
          entityId: id,
          payload,
          base,
          state: 'pending',
        };
        store.add(written);
        tx.objectStore('meta').put(
          { ...meta, outboxVersion: (meta.outboxVersion ?? 0) + 1 },
          'sync',
        );
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    try {
      await done;
    } catch (error) {
      throw failure ?? error;
    }
    changed();
    return written!;
  } finally {
    db.close();
  }
}

async function settle(entry: PendingRename, outcome?: RenameDeckResult, failure?: string) {
  const db = await openCollection(entry.accountId);
  try {
    const tx = db.transaction(['meta', 'outbox'], 'readwrite');
    const done = committed(tx);
    const store = tx.objectStore('outbox');
    const metaRead = tx.objectStore('meta').get('sync');
    const read = store.get(entry.operationId);
    read.onsuccess = () => {
      try {
        const current = read.result as PendingRename | undefined;
        if (!current || current.state !== 'pending') return;
        const meta = metaRead.result as CollectionMeta | undefined;
        if (!meta) {
          tx.abort();
          return;
        }
        store.put({
          ...current,
          state: outcome?.status === 'applied' ? 'synchronized' : outcome ? 'conflict' : 'rejected',
          ...(outcome ? { outcome } : {}),
          ...(failure ? { failure } : {}),
        });
        tx.objectStore('meta').put(
          { ...meta, outboxVersion: (meta.outboxVersion ?? 0) + 1 },
          'sync',
        );
      } catch {
        tx.abort();
      }
    };
    await done;
    changed();
  } finally {
    db.close();
  }
}

let delivering: Promise<void> | undefined;
let deliveryController: AbortController | undefined;
export function cancelRenameDelivery() {
  deliveryController?.abort();
  delivering = undefined;
}
/** No timers/retry rewriting: reconnection, focus and explicit Retry resume exact deliveries. */
export function deliverRenames() {
  if (delivering) return delivering;
  const accountId = offlineState().accountId;
  const visit = accountEpoch();
  const active = () =>
    visit === accountEpoch() &&
    offlineState().accountId === accountId &&
    offlineState().validated &&
    !offlineState().offline &&
    !offlineState().signedOut;
  if (!accountId || !active()) return Promise.resolve();
  const controller = new AbortController();
  deliveryController = controller;
  const own = (async () => {
    for (const entry of await renames(accountId)) {
      if (!active()) return;
      if (entry.state !== 'pending') continue;
      if (
        entry.accountId !== accountId ||
        entry.payload.accountId !== accountId ||
        entry.operationId !== entry.payload.operationId
      )
        throw new Error('collection_invalid_outbox');
      try {
        const outcome = renameDeckResultSchema.parse(
          await request(`/decks/${entry.entityId}/rename`, {
            method: 'POST',
            body: entry.payload,
            signal: controller.signal,
          }),
        );
        if (
          outcome.operationId !== entry.operationId ||
          (outcome.status === 'applied' && outcome.revision <= entry.payload.baseRev) ||
          (outcome.status === 'conflict' && !outcome.reason)
        )
          throw new Error('collection_invalid_acknowledgement');
        // A completed acknowledgement belongs to the originating database even
        // if the visit ended. request() rejects late cross-account responses.
        await settle(entry, outcome);
      } catch (error) {
        if (error instanceof ApiFailure && [400, 403, 404, 409, 422].includes(error.status)) {
          await settle(entry, undefined, error.code);
          continue;
        }
        // Session expiry, storage/ack failure and transport failure leave intent intact.
        return;
      }
    }
  })().finally(() => {
    if (delivering === own) delivering = undefined;
  });
  delivering = own;
  return own;
}

/** Pending and acknowledged-but-not-yet-pulled names survive server read reconciliation. */
export function renameOverlay(
  entries: PendingRename[],
  id: string,
  rev: number,
): string | undefined {
  return entries
    .filter(
      (entry) =>
        entry.entityId === id &&
        (entry.state === 'pending' ||
          (entry.state === 'synchronized' && (entry.outcome?.revision ?? 0) > rev)),
    )
    .sort((a, b) => a.operationId.localeCompare(b.operationId))
    .at(-1)?.payload.name;
}

/** Explicit recovery retains the original payload and base row in the archive. */
export async function keepServerVersion(operationId: string) {
  const accountId = offlineState().accountId;
  const visit = accountEpoch();
  if (!accountId) throw new Error('collection_no_account');
  const db = await openCollection(accountId);
  try {
    const tx = db.transaction(['meta', 'outbox'], 'readwrite');
    const done = committed(tx);
    const meta = tx.objectStore('meta').get('sync');
    const store = tx.objectStore('outbox');
    const read = store.get(operationId);
    read.onsuccess = () => {
      try {
        const entry = read.result as PendingRename | undefined;
        if (
          visit !== accountEpoch() ||
          accountId !== offlineState().accountId ||
          !entry ||
          !['conflict', 'rejected'].includes(entry.state)
        ) {
          tx.abort();
          return;
        }
        store.put({ ...entry, state: 'resolved' });
        const saved = meta.result as CollectionMeta;
        tx.objectStore('meta').put(
          { ...saved, outboxVersion: (saved.outboxVersion ?? 0) + 1 },
          'sync',
        );
      } catch {
        tx.abort();
      }
    };
    await done;
    changed();
  } finally {
    db.close();
  }
}

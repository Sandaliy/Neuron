import {
  cardSchema,
  deckSchema,
  noteSchema,
  pullSyncResultSchema,
  SYNC_ENTITIES,
} from '@neuron/shared';
import type { PullSyncResult } from '@neuron/shared';

export const COLLECTION_VERSION = 1;
export const collectionName = (accountId: string) => `neuron.collection:${accountId}`;
export interface CollectionMeta {
  cursor: number;
  complete: boolean;
  format: number;
}
export type CollectionRow = PullSyncResult['changes'][number];

export function openCollection(accountId: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(collectionName(accountId), COLLECTION_VERSION);
    let settled = false;
    const fail = (error: unknown) => {
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };
    const timeout = setTimeout(() => fail(new Error('collection_open_timeout')), 5000);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('meta');
      for (const entity of SYNC_ENTITIES) {
        const store = db.createObjectStore(entity, { keyPath: 'id' });
        store.createIndex('rev', 'rev');
        if (entity === 'notes' || entity === 'cards') store.createIndex('deckId', 'row.deckId');
        if (entity === 'cards' || entity === 'reviews')
          store.createIndex('noteOrCardId', entity === 'cards' ? 'row.noteId' : 'row.cardId');
      }
    };
    request.onerror = () => fail(request.error);
    request.onblocked = () => fail(new Error('collection_blocked'));
    request.onsuccess = () => {
      const db = request.result;
      if (settled) {
        db.close();
        return;
      }
      clearTimeout(timeout);
      settled = true;
      db.onversionchange = () => db.close();
      if (!['meta', ...SYNC_ENTITIES].every((store) => db.objectStoreNames.contains(store))) {
        db.close();
        reject(new Error('collection_incompatible'));
        return;
      }
      resolve(db);
    };
  });
}

export function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('collection_read_timeout')), 10000);
    request.onsuccess = () => {
      clearTimeout(timeout);
      resolve(request.result);
    };
    request.onerror = () => {
      clearTimeout(timeout);
      reject(request.error);
    };
  });
}

export function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      try {
        tx.abort();
      } catch {
        /* Already finished. */
      }
      reject(new Error('collection_transaction_timeout'));
    }, 10000);
    tx.oncomplete = () => {
      clearTimeout(timeout);
      resolve();
    };
    tx.onabort = () => {
      clearTimeout(timeout);
      reject(tx.error ?? new Error('collection_aborted'));
    };
    tx.onerror = () => {
      clearTimeout(timeout);
      reject(tx.error ?? new Error('collection_failed'));
    };
  });
}

export async function metadata(db: IDBDatabase): Promise<CollectionMeta> {
  const meta = await result<CollectionMeta | undefined>(
    db.transaction('meta').objectStore('meta').get('sync'),
  );
  if (
    meta &&
    (meta.format !== COLLECTION_VERSION ||
      !Number.isSafeInteger(meta.cursor) ||
      meta.cursor < 0 ||
      typeof meta.complete !== 'boolean')
  )
    throw new Error('collection_incompatible');
  return meta ?? { cursor: 0, complete: false, format: COLLECTION_VERSION };
}

/** Compare-and-apply inside one transaction: competing tabs may retry, never skip a page. */
export async function applyPage(db: IDBDatabase, input: unknown): Promise<void> {
  const page = pullSyncResultSchema.parse(input);
  for (const change of page.changes) {
    if (change.purged || change.deleted) continue;
    if (change.entity === 'notes') noteSchema.parse(change.row);
    if (change.entity === 'cards') cardSchema.parse(change.row);
    if (change.entity === 'decks') deckSchema.parse({ ...change.row, path: [] });
  }
  if (
    !Number.isSafeInteger(page.since) ||
    !Number.isSafeInteger(page.revision) ||
    page.since < 0 ||
    page.revision < page.since ||
    (page.hasMore && (page.revision === page.since || !page.changes.length)) ||
    page.changes.some(
      (change) =>
        !Number.isSafeInteger(change.rev) ||
        change.rev <= page.since ||
        change.rev > page.revision ||
        change.row['id'] !== change.id ||
        change.row['rev'] !== change.rev,
    )
  ) {
    throw new Error('collection_invalid_page');
  }
  const tx = db.transaction(['meta', ...SYNC_ENTITIES], 'readwrite');
  const done = committed(tx);
  const store = tx.objectStore('meta');
  const read = store.get('sync');
  read.onsuccess = () => {
    const meta = (read.result as CollectionMeta | undefined) ?? {
      cursor: 0,
      complete: false,
      format: COLLECTION_VERSION,
    };
    if (meta.format !== COLLECTION_VERSION) {
      tx.abort();
      return;
    }
    // Exact duplicates and old deliveries cannot rewrite newer rows or completeness.
    if (page.revision <= meta.cursor && page.since < meta.cursor) return;
    if (page.since !== meta.cursor) {
      tx.abort();
      return;
    }
    try {
      for (const change of page.changes) tx.objectStore(change.entity).put(change);
      store.put(
        {
          cursor: page.revision,
          complete: meta.complete || !page.hasMore,
          format: COLLECTION_VERSION,
        },
        'sync',
      );
    } catch {
      try {
        tx.abort();
      } catch {
        /* The transaction may have already aborted. */
      }
    }
  };
  await done;
}

/** One consistent complete snapshot; missing metadata is storage loss, never an empty collection. */
const READ_ENTITIES = ['decks', 'notes', 'cards'] as const;
export async function snapshot(
  db: IDBDatabase,
): Promise<Record<(typeof READ_ENTITIES)[number], CollectionRow[]>> {
  const tx = db.transaction(['meta', ...READ_ENTITIES]);
  const done = committed(tx);
  const reads = READ_ENTITIES.map((entity) =>
    result<CollectionRow[]>(tx.objectStore(entity).getAll()),
  );
  const [meta, rows] = await Promise.all([
    result<CollectionMeta | undefined>(tx.objectStore('meta').get('sync')),
    Promise.all(reads),
    done,
  ]);
  if (!meta?.complete || meta.format !== COLLECTION_VERSION)
    throw new Error('collection_incomplete');
  return Object.fromEntries(READ_ENTITIES.map((entity, index) => [entity, rows[index]])) as Record<
    (typeof READ_ENTITIES)[number],
    CollectionRow[]
  >;
}

/** Read-only caches may be rebuilt. Future pending writes must never use this reset policy. */
export function deleteCollection(accountId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(collectionName(accountId));
    const timeout = setTimeout(() => reject(new Error('collection_delete_timeout')), 5000);
    request.onsuccess = () => {
      clearTimeout(timeout);
      resolve();
    };
    request.onerror = () => {
      clearTimeout(timeout);
      reject(request.error);
    };
    request.onblocked = () => {
      clearTimeout(timeout);
      reject(new Error('collection_blocked'));
    };
  });
}

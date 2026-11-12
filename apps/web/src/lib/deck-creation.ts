import {
  createOfflineDeckCommandSchema,
  createOfflineDeckResultSchema,
  savedDeckCreationSchema,
  deckSchema,
  uuidV7,
} from '@neuron/shared';
import type {
  CreateOfflineDeckResult,
  Deck,
  DeckLanguages,
  DeckNode,
  SavedDeckCreation,
} from '@neuron/shared';

import { ApiFailure, request } from './api';
import {
  DECK_CREATION_PREFIX,
  deckCreationRange,
  committed,
  openCollection,
  result,
} from './collection-db';
import { accountEpoch, offlineState } from './offline';

import type { CollectionMeta, CollectionRow } from './collection-db';

export type PendingDeckCreate = SavedDeckCreation;
export const deckCreationKey = (id: string) => `${DECK_CREATION_PREFIX}${id}`;
export const deckCreationsQueryKey = (accountId: string | null) => ['deck-creations', accountId];
const listeners = new Set<() => void>();
const channel =
  typeof BroadcastChannel === 'undefined'
    ? undefined
    : new BroadcastChannel('neuron.deck-creation');
const notify = () => listeners.forEach((listener) => listener());
channel?.addEventListener('message', notify);
export function onDeckCreationChange(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function changed() {
  notify();
  channel?.postMessage('changed');
}

export function validateDeckCreations(input: unknown, accountId: string): PendingDeckCreate[] {
  if (!Array.isArray(input)) throw new Error('collection_invalid_outbox');
  return input.map((value: unknown) => {
    const entry = savedDeckCreationSchema.parse(value);
    if (
      entry.accountId !== accountId ||
      entry.payload.accountId !== accountId ||
      JSON.stringify(entry.payload.ancestors) !==
        JSON.stringify(entry.ancestors.map(({ id, rev }) => ({ id, rev }))) ||
      (entry.outcome &&
        (entry.outcome.entityId !== entry.payload.entityId ||
          entry.outcome.operationId !== entry.payload.operationId)) ||
      (entry.state === 'synchronized' && entry.outcome?.status !== 'applied') ||
      (entry.state === 'conflict' && entry.outcome?.status !== 'conflict') ||
      entry.ancestors.some(
        (row, at) =>
          row.kind !== 'folder' || row.parentId !== (entry.ancestors[at - 1]?.id ?? null),
      )
    )
      throw new Error('collection_invalid_outbox');
    return entry;
  });
}
export async function deckCreations(accountId: string) {
  const db = await openCollection(accountId);
  try {
    return validateDeckCreations(
      await result(db.transaction('meta').objectStore('meta').getAll(deckCreationRange())),
      accountId,
    );
  } finally {
    db.close();
  }
}

/** One strict commit, serialized with pulls, rebuilds and competing tabs. */
async function write(
  id: string,
  decide: (
    current: PendingDeckCreate | undefined,
    rows: CollectionRow[],
    meta: CollectionMeta,
    entries: PendingDeckCreate[],
  ) => PendingDeckCreate | undefined,
) {
  const accountId = offlineState().accountId;
  const visit = accountEpoch();
  if (!accountId || offlineState().signedOut) throw new Error('collection_no_account');
  const db = await openCollection(accountId);
  try {
    const tx = db.transaction(['meta', 'decks'], 'readwrite', { durability: 'strict' });
    const done = committed(tx);
    const store = tx.objectStore('meta');
    const metaRead = store.get('sync');
    const decksRead = tx.objectStore('decks').getAll();
    const entriesRead = store.getAll(deckCreationRange());
    const read = store.get(deckCreationKey(id));
    let failure: unknown;
    let written: PendingDeckCreate | undefined;
    read.onsuccess = () => {
      try {
        if (
          accountEpoch() !== visit ||
          offlineState().accountId !== accountId ||
          offlineState().signedOut
        )
          throw new Error('collection_account_changed');
        const meta = metaRead.result as CollectionMeta | undefined;
        if (!meta?.complete || meta.format !== 1) throw new Error('collection_incomplete');
        const current =
          read.result === undefined
            ? undefined
            : validateDeckCreations([read.result], accountId)[0];
        written = decide(
          current,
          decksRead.result as CollectionRow[],
          meta,
          validateDeckCreations(entriesRead.result, accountId),
        );
        if (written) {
          validateDeckCreations([written], accountId);
          store.put(written, deckCreationKey(id));
          store.put({ ...meta, outboxVersion: (meta.outboxVersion ?? 0) + 1 }, 'sync');
        }
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
    if (written) changed();
    return written;
  } finally {
    db.close();
  }
}

/** Only downloaded server-backed Folders may be parents in this protocol. */
function ancestorsOf(rows: CollectionRow[], parentId: string | null) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const chain: Deck[] = [];
  const seen = new Set<string>();
  while (parentId !== null) {
    if (seen.has(parentId) || seen.size >= 8) throw new Error('collection_create_parent');
    seen.add(parentId);
    const row = byId.get(parentId);
    if (!row || row.deleted || row.purged) throw new Error('collection_create_parent');
    const deck = deckSchema.parse({ ...row.row, path: [] });
    if (deck.kind !== 'folder' || deck.rev < 1) throw new Error('collection_create_parent');
    chain.unshift(deck);
    parentId = deck.parentId;
  }
  return chain;
}

/** A newly acknowledged online Folder may not be in the download yet. */
export async function hasDownloadedCreationParent(parentId: string) {
  const accountId = offlineState().accountId;
  const visit = accountEpoch();
  if (!accountId) return false;
  const db = await openCollection(accountId);
  try {
    const rows = await result<CollectionRow[]>(
      db.transaction('decks').objectStore('decks').getAll(),
    );
    if (accountEpoch() !== visit || offlineState().accountId !== accountId)
      throw new Error('collection_account_changed');
    try {
      ancestorsOf(rows, parentId);
      return true;
    } catch (error) {
      if (error instanceof Error && error.message === 'collection_create_parent') return false;
      throw error;
    }
  } finally {
    db.close();
  }
}

function nameTaken(
  rows: CollectionRow[],
  entries: PendingDeckCreate[],
  input: PendingDeckCreate['payload'],
) {
  const matches = (parentId: unknown, name: unknown) =>
    parentId === input.parentId && String(name).toLowerCase() === input.name.toLowerCase();
  return (
    rows.some(
      (row) => !row.deleted && !row.purged && matches(row.row['parentId'], row.row['name']),
    ) ||
    entries.some(
      (entry) =>
        entry.payload.entityId !== input.entityId &&
        !['synchronized', 'resolved'].includes(entry.state) &&
        matches(entry.payload.parentId, entry.payload.name),
    )
  );
}

export async function saveDeckCreation(
  owner: { accountId: string | null; epoch: number },
  input: {
    entityId: string;
    name: string;
    kind: 'folder' | 'deck';
    parentId: string | null;
    /** A deck's two languages; the command refuses them on a folder. */
    settings?: DeckLanguages;
  },
  observedAncestors: readonly Deck[],
) {
  const active = () =>
    owner.accountId === offlineState().accountId &&
    owner.epoch === accountEpoch() &&
    !offlineState().signedOut;
  if (!active()) throw new Error('collection_account_changed');
  return write(input.entityId, (current, rows, _meta, entries) => {
    if (!active()) throw new Error('collection_account_changed');
    if (current || rows.some((row) => row.id === input.entityId))
      throw new Error('collection_create_exists');
    const accountId = offlineState().accountId!;
    ancestorsOf(rows, input.parentId);
    const ancestors = observedAncestors.map((row) => deckSchema.parse(row));
    const payload = createOfflineDeckCommandSchema.parse({
      accountId,
      operationId: uuidV7(),
      ...input,
      ancestors: ancestors.map(({ id, rev }) => ({ id, rev })),
    });
    if (nameTaken(rows, entries, payload)) throw new Error('collection_create_name');
    return {
      version: 1,
      accountId,
      payload,
      ancestors,
      createdAt: new Date().toISOString(),
      position:
        rows.reduce(
          (last, row) =>
            !row.deleted && !row.purged && row.row['parentId'] === input.parentId
              ? Math.max(last, Number(row.row['position']))
              : last,
          -1,
        ) + 1,
      state: 'pending',
    };
  });
}

/** Recovery changes only a refused creation, retaining its original command as an archive. */
export async function resolveDeckCreation(
  id: string,
  parentId?: string | null,
  name?: string,
  observedAncestors: readonly Deck[] = [],
) {
  const accountId = offlineState().accountId;
  const visit = accountEpoch();
  if (!accountId) throw new Error('collection_no_account');
  const original = (await deckCreations(accountId)).find((row) => row.payload.entityId === id);
  if (!original || !['conflict', 'rejected'].includes(original.state))
    throw new Error('collection_invalid_resolution');
  // Use a separate archive key; older versions ignore this prefix as well.
  const db = await openCollection(accountId);
  try {
    const tx = db.transaction(['meta', 'decks'], 'readwrite', { durability: 'strict' });
    const done = committed(tx);
    const store = tx.objectStore('meta');
    const metaRead = store.get('sync');
    const rowsRead = tx.objectStore('decks').getAll();
    const entriesRead = store.getAll(deckCreationRange());
    const read = store.get(deckCreationKey(id));
    let failure: unknown;
    read.onsuccess = () => {
      try {
        if (accountEpoch() !== visit || offlineState().accountId !== accountId)
          throw new Error('collection_account_changed');
        const current = validateDeckCreations([read.result], accountId)[0]!;
        if (
          current.payload.operationId !== original.payload.operationId ||
          !['conflict', 'rejected'].includes(current.state)
        )
          throw new Error('collection_invalid_resolution');
        const meta = metaRead.result as CollectionMeta;
        if (!meta?.complete || meta.format !== 1) throw new Error('collection_incomplete');
        store.put(current, `deck-create-archive:${current.payload.operationId}`);
        if (parentId === undefined)
          store.put({ ...current, state: 'resolved' }, deckCreationKey(id));
        else {
          if (
            current.outcome?.status !== 'conflict' ||
            current.outcome.reason === 'identity_exists'
          )
            throw new Error('collection_invalid_resolution');
          ancestorsOf(rowsRead.result as CollectionRow[], parentId);
          const ancestors = observedAncestors.map((row) => deckSchema.parse(row));
          const payload = createOfflineDeckCommandSchema.parse({
            ...current.payload,
            name: name ?? current.payload.name,
            operationId: uuidV7(),
            parentId,
            ancestors: ancestors.map(({ id, rev }) => ({ id, rev })),
          });
          if (
            nameTaken(
              rowsRead.result as CollectionRow[],
              validateDeckCreations(entriesRead.result, accountId),
              payload,
            )
          )
            throw new Error('collection_create_name');
          const { outcome: _outcome, failure: _failure, ...rest } = current;
          store.put({ ...rest, payload, ancestors, state: 'pending' }, deckCreationKey(id));
        }
        store.put({ ...meta, outboxVersion: (meta.outboxVersion ?? 0) + 1 }, 'sync');
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
  } finally {
    db.close();
  }
}

/** Library-only projection. Destination pickers never see unacknowledged identities. */
export function overlayDeckCreations(
  tree: readonly DeckNode[],
  entries: PendingDeckCreate[],
  cursor: number,
) {
  const visible = entries.filter(
    (entry) =>
      entry.state !== 'resolved' &&
      (entry.state !== 'synchronized' ||
        (entry.outcome?.status === 'applied' && cursor < entry.outcome.revision)),
  );
  if (visible.length === 0) return tree;
  const roots = tree.map(function copy(row): DeckNode {
    return { ...row, children: row.children.map(copy) };
  });
  const byId = new Map<string, DeckNode>();
  const index = (rows: readonly DeckNode[]) =>
    rows.forEach((row) => {
      byId.set(row.id, row);
      index(row.children);
    });
  index(roots);
  for (const entry of visible) {
    const input = entry.payload;
    // A moved or missing parent does not silently relocate local work.
    if (
      input.ancestors.some((ancestor, at) => {
        const parent = byId.get(ancestor.id);
        return (
          !parent ||
          parent.kind !== 'folder' ||
          parent.parentId !== (input.ancestors[at - 1]?.id ?? null)
        );
      })
    )
      continue;
    const existing = byId.get(input.entityId);
    if (existing) continue;
    const row: DeckNode = {
      id: input.entityId,
      name: input.name,
      kind: input.kind,
      parentId: input.parentId,
      path: input.ancestors.map((row) => row.id),
      settings: input.settings ?? null,
      position: entry.position,
      createdAt: entry.createdAt,
      updatedAt: entry.createdAt,
      rev: 0,
      children: [],
      noteCount: 0,
      due: 0,
      fresh: 0,
    };
    const parent = input.parentId === null ? undefined : byId.get(input.parentId);
    if (parent) (parent.children as DeckNode[]).push(row);
    else roots.push(row);
    byId.set(row.id, row);
  }
  return roots;
}

/**
 * An api older than this app refusing the languages it does not know yet.
 *
 * The web and api deployments of one release do not finish at the same moment.
 * A deck saved with its languages and sent to the previous api is refused as an
 * unknown field, which says nothing about the deck itself. Marking it refused
 * would make the learner create it again, so it waits and is retried like a
 * lost connection until the api that understands it answers. The command was
 * checked against the same schema before it was saved, so the current api
 * never refuses it this way.
 */
export function versionSkew(error: unknown, entry: PendingDeckCreate) {
  return (
    entry.payload.settings !== undefined &&
    error instanceof ApiFailure &&
    error.status === 400 &&
    error.code === 'invalid_request'
  );
}

let delivering: Promise<void> | undefined;
let controller: AbortController | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let attempt = 0;
export function cancelDeckCreationDelivery() {
  controller?.abort();
  delivering = undefined;
  clearTimeout(retryTimer);
  retryTimer = undefined;
  attempt = 0;
}
export function deliverDeckCreations(): Promise<void> {
  if (delivering) return delivering;
  const accountId = offlineState().accountId;
  const visit = accountEpoch();
  const active = () =>
    accountEpoch() === visit &&
    offlineState().accountId === accountId &&
    offlineState().validated &&
    !offlineState().offline &&
    !offlineState().signedOut;
  if (!accountId || !active()) return Promise.resolve();
  clearTimeout(retryTimer);
  retryTimer = undefined;
  const ownController = new AbortController();
  controller = ownController;
  let interrupted = false;
  let followup = false;
  const own = (async () => {
    const attempted = new Set<string>();
    for (const entry of await deckCreations(accountId)) {
      if (!active()) return;
      if (entry.state !== 'pending') continue;
      attempted.add(entry.payload.operationId);
      try {
        const outcome = createOfflineDeckResultSchema.parse(
          await request<CreateOfflineDeckResult>('/decks/offline-create', {
            method: 'POST',
            body: entry.payload,
            signal: ownController.signal,
          }),
        );
        if (!active()) return;
        if (
          outcome.operationId !== entry.payload.operationId ||
          outcome.entityId !== entry.payload.entityId
        )
          throw new Error('collection_invalid_acknowledgement');
        await write(entry.payload.entityId, (current) => {
          if (!active()) throw new Error('collection_account_changed');
          if (
            current?.state !== 'pending' ||
            current.payload.operationId !== entry.payload.operationId
          )
            return undefined;
          return {
            ...current,
            state: outcome.status === 'applied' ? 'synchronized' : 'conflict',
            outcome,
          };
        });
        attempt = 0;
      } catch (error) {
        if (!active()) return;
        if (versionSkew(error, entry)) {
          interrupted = true;
          return;
        }
        if (error instanceof ApiFailure && [400, 403, 404, 409, 422].includes(error.status)) {
          await write(entry.payload.entityId, (current) =>
            current?.state === 'pending' &&
            current.payload.operationId === entry.payload.operationId
              ? { ...current, state: 'rejected', failure: error.code }
              : undefined,
          );
          continue;
        }
        interrupted = !(error instanceof ApiFailure && error.status === 401);
        return;
      }
    }
    if (active())
      followup = (await deckCreations(accountId)).some(
        (entry) => entry.state === 'pending' && !attempted.has(entry.payload.operationId),
      );
  })()
    .catch(() => {
      interrupted = true;
    })
    .finally(() => {
      if (delivering !== own) return;
      delivering = undefined;
      if (interrupted && active())
        retryTimer = setTimeout(
          () => void deliverDeckCreations(),
          [2, 5, 15, 30, 60][Math.min(attempt++, 4)]! * 1000,
        );
      else if (followup && active()) retryTimer = setTimeout(() => void deliverDeckCreations(), 0);
    });
  delivering = own;
  return own;
}

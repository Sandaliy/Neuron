import { useSyncExternalStore } from 'react';

import { meSchema } from '@neuron/shared';
import type { Me, PullSyncResult } from '@neuron/shared';

import { ApiFailure, request } from './api';
import {
  applyPage,
  committed,
  deleteCollection,
  metadata,
  openCollection,
  result,
} from './collection-db';
import { collectionDiagnostic } from './collection-failure';

import type { CollectionDiagnostic, CollectionStage } from './collection-failure';
import type { QueryClient } from '@tanstack/react-query';

const CONTEXT_KEY = 'neuron.offline.account';
const SIGNED_OUT_KEY = 'neuron.offline.signedOut';
export function locallySignedOut() {
  try {
    return localStorage.getItem(SIGNED_OUT_KEY) === 'true';
  } catch {
    return false;
  }
}
type Download = 'idle' | 'downloading' | 'ready' | 'unavailable';
interface OfflineState {
  offline: boolean;
  validated: boolean;
  accountId: string | null;
  download: Download;
  signedOut: boolean;
  available: boolean;
  failure: CollectionDiagnostic | null;
}
let state: OfflineState = {
  offline: typeof navigator !== 'undefined' && !navigator.onLine,
  validated: false,
  accountId: null,
  download: 'idle',
  signedOut: locallySignedOut(),
  available: false,
  failure: null,
};
const listeners = new Set<() => void>();
let client: QueryClient | undefined;
let epoch = 0;
let connection = 0;
let probing: Promise<void> | undefined;
let controller: AbortController | undefined;
let running: Promise<void> | undefined;
let recovering = false;
let db: IDBDatabase | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
const emit = (patch: Partial<OfflineState>) => {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
};
export const offlineState = () => state;
export function useOffline() {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, offlineState);
}

function contextId(): string | null {
  try {
    if (locallySignedOut()) return null;
    return localStorage.getItem(CONTEXT_KEY);
  } catch {
    return null;
  }
}

function forgetContext() {
  try {
    localStorage.removeItem(CONTEXT_KEY);
  } catch {
    /* No context can be read when storage is unavailable. */
  }
}

function clearReads() {
  void client?.cancelQueries({ predicate: (query) => query.queryKey[0] !== 'account' });
  client?.removeQueries({ predicate: (query) => query.queryKey[0] !== 'account' });
}

/** Preserve observer data and screen state while changing the authority for reads. */
async function transitionReads(local: boolean) {
  const visit = epoch;
  await client?.cancelQueries({ predicate: (query) => query.queryKey[0] !== 'account' });
  if (visit !== epoch || state.offline !== local) return;
  await client?.invalidateQueries({
    predicate: (query) =>
      query.queryKey[0] !== 'account' &&
      (!local || ['decks', 'notes'].includes(String(query.queryKey[0]))),
  });
}

/** Revocation happens before transport; late pulls/account requests cannot re-enable this visit. */
export function revokeOffline(explicit = false) {
  epoch++;
  clearTimeout(timer);
  controller?.abort();
  db?.close();
  db = undefined;
  if (explicit) {
    try {
      localStorage.setItem(SIGNED_OUT_KEY, 'true');
    } catch {
      /* IndexedDB access is optional. */
    }
  }
  forgetContext();
  emit({
    accountId: null,
    validated: false,
    download: 'idle',
    available: false,
    failure: null,
    signedOut: explicit || state.signedOut,
  });
  clearReads();
}
/** Only explicit successful authentication lifts a local sign-out, never a background account read. */
export function beginOnlineAccount() {
  revokeOffline();
  try {
    localStorage.removeItem(SIGNED_OUT_KEY);
  } catch {
    /* Online access stays usable. */
  }
  emit({ signedOut: false });
}
export const accountEpoch = () => epoch;
export const connectionEpoch = () => connection;

export function offlineReadFailed(error: unknown, visit: number, accountId: string) {
  if (visit !== epoch || state.accountId !== accountId || !state.offline) return;
  const failure = collectionDiagnostic(error, 'database');
  emit({ available: false, download: 'unavailable', failure });
}

export async function rememberedAccount(): Promise<Me | undefined> {
  const visit = epoch;
  const id = contextId();
  if (!id) return;
  const opened = await openCollection(id);
  try {
    const account = meSchema.parse(
      await result(opened.transaction('meta').objectStore('meta').get('account')),
    );
    const meta = await metadata(opened);
    if (account.id !== id || contextId() !== id || visit !== epoch || state.signedOut) return;
    emit({
      offline: true,
      validated: false,
      accountId: id,
      download: meta.complete ? 'ready' : 'idle',
      available: meta.complete,
    });
    return account;
  } finally {
    opened.close();
  }
}

export function acceptAccount(account: Me, startedEpoch: number, startedConnection: number) {
  if (!navigator.onLine) {
    networkLost();
    throw new DOMException('Connection visit ended', 'AbortError');
  }
  if (
    startedEpoch !== epoch ||
    startedConnection !== connection ||
    state.signedOut ||
    locallySignedOut()
  )
    throw new Error('account_visit_ended');
  const reconnecting = state.offline;
  const newAccount = state.accountId !== account.id;
  if (
    (state.accountId && state.accountId !== account.id) ||
    (contextId() && contextId() !== account.id)
  ) {
    revokeOffline();
  }
  emit({ offline: false, validated: true, accountId: account.id });
  if (reconnecting) void transitionReads(false);
  // Authentication fields are selected explicitly by meSchema; cookies/tokens never enter this store.
  // Repeated account reads/navigation join the current visit; they never queue pulls.
  if (running && !newAccount && !reconnecting) return;
  if (newAccount || reconnecting || state.download === 'idle') {
    const visit = epoch;
    if (running)
      void running.then(() => {
        if (visit === epoch) void download(account);
      });
    else void download(account);
  }
}

export function networkLost() {
  if (!client) return;
  connection++;
  if (state.offline) return;
  emit({ offline: true, validated: false });
  controller?.abort();
  void transitionReads(true);
}

/** A failed collection read is confirmed through the session authority, not connectivity hints. */
export function confirmConnection() {
  if (state.offline || state.signedOut) return Promise.resolve();
  if (!probing) {
    probing = Promise.resolve(retryConnection())
      .catch(() => undefined)
      .finally(() => {
        probing = undefined;
      });
  }
  return probing;
}

async function download(account: Me) {
  if (running || state.offline || !state.validated || state.accountId !== account.id)
    return running;
  const ownEpoch = epoch;
  controller = new AbortController();
  const signal = controller.signal;
  let opened: IDBDatabase | undefined;
  let stage: CollectionStage = 'database';
  running = (async () => {
    try {
      opened = await openCollection(account.id);
      if (ownEpoch !== epoch || signal.aborted || state.accountId !== account.id) return;
      db = opened;
      const initial = await metadata(opened);
      if (ownEpoch !== epoch || signal.aborted || state.accountId !== account.id) return;
      emit({
        download: initial.complete ? 'ready' : 'downloading',
        available: initial.complete,
        failure: null,
      });
      stage = 'transaction';
      const tx = opened.transaction('meta', 'readwrite');
      const saved = committed(tx);
      tx.objectStore('meta').put(meSchema.parse(account), 'account');
      await saved;
      if (ownEpoch !== epoch) return;
      stage = 'database';
      localStorage.setItem(CONTEXT_KEY, account.id);
      while (!signal.aborted && ownEpoch === epoch && !state.offline) {
        stage = 'database';
        const meta = await metadata(opened);
        stage = 'network';
        const page = await request<PullSyncResult>(`/sync?since=${meta.cursor}&limit=200`, {
          signal,
        });
        if (signal.aborted || ownEpoch !== epoch || state.accountId !== account.id) return;
        try {
          stage = 'transaction';
          await applyPage(opened, page);
        } catch (error) {
          // A competing tab committed first: ask again from the durable cursor.
          if ((await metadata(opened)).cursor > meta.cursor) continue;
          throw error;
        }
        const applied = await metadata(opened);
        if (signal.aborted || ownEpoch !== epoch || state.accountId !== account.id) return;
        if (!page.hasMore && applied.complete) {
          emit({ download: 'ready', available: true, failure: null });
          break;
        }
      }
    } catch (error) {
      if (ownEpoch === epoch && !signal.aborted) {
        const failure =
          error instanceof ApiFailure
            ? { stage: 'network' as const, code: error.code }
            : collectionDiagnostic(error, stage);
        console.warn('Offline collection failure', failure);
        emit({ download: 'unavailable', failure });
        // A failed background pull alone does not take the online application away.
        if (!navigator.onLine) networkLost();
      }
    } finally {
      opened?.close();
      if (db === opened) db = undefined;
    }
  })().finally(() => {
    running = undefined;
  });
  return running;
}

export async function retryDownload(reset = false) {
  if (state.offline || !state.validated || !state.accountId) return;
  if (recovering) return;
  if (!reset && running) return running;
  if (reset) recovering = true;
  const id = state.accountId;
  const visit = epoch;
  const active = () =>
    visit === epoch && state.accountId === id && !state.offline && state.validated;
  try {
    if (reset) controller?.abort();
    await running;
    if (!active()) return;
    if (reset) {
      emit({ download: 'downloading', available: false, failure: null });
      await deleteCollection(id);
      if (!active()) return;
      emit({ download: 'idle', available: false });
    }
    const account = client?.getQueryData<Me>(['account']);
    if (account?.id === id) await download(account);
  } catch (error) {
    if (active()) {
      const failure = collectionDiagnostic(error, 'recovery');
      console.warn('Offline collection failure', failure);
      emit({ download: 'unavailable', failure });
    }
  } finally {
    if (reset) recovering = false;
  }
}

function refreshDownload() {
  // Focus/writes can reconcile a healthy snapshot, never loop a failed hydration.
  if (running || recovering || state.download === 'unavailable') return;
  void retryDownload();
}

export function retryConnection() {
  return client?.invalidateQueries({ queryKey: ['account'] });
}

export function initializeOffline(queryClient: QueryClient) {
  client = queryClient;
  window.addEventListener('offline', networkLost);
  window.addEventListener('online', () => {
    // Remain read-only until the server has freshly accepted this account.
    void retryConnection();
  });
  window.addEventListener('storage', (event) => {
    if (event.key === SIGNED_OUT_KEY) {
      if (event.newValue === 'true') {
        epoch++;
        controller?.abort();
        db?.close();
        db = undefined;
        emit({
          accountId: null,
          validated: false,
          download: 'idle',
          available: false,
          failure: null,
          signedOut: true,
        });
        client?.clear();
      } else emit({ signedOut: false });
    }
    if (event.key === CONTEXT_KEY && event.newValue !== state.accountId) {
      epoch++;
      controller?.abort();
      db?.close();
      db = undefined;
      emit({
        accountId: null,
        validated: false,
        download: 'idle',
        available: false,
        failure: null,
      });
      client?.clear();
      if (!locallySignedOut()) void client?.invalidateQueries({ queryKey: ['account'] });
    }
  });
  window.addEventListener('focus', () => {
    if (state.offline && navigator.onLine) void retryConnection();
    else refreshDownload();
  });
  client.getMutationCache().subscribe((event) => {
    if (event.type === 'updated' && event.mutation.state.status === 'success') {
      clearTimeout(timer);
      timer = setTimeout(() => {
        refreshDownload();
      }, 500);
    }
  });
}

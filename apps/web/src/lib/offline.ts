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
}
let state: OfflineState = {
  offline: typeof navigator !== 'undefined' && !navigator.onLine,
  validated: false,
  accountId: null,
  download: 'idle',
  signedOut: locallySignedOut(),
};
const listeners = new Set<() => void>();
let client: QueryClient | undefined;
let epoch = 0;
let controller: AbortController | undefined;
let running: Promise<void> | undefined;
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

/** Revocation happens before transport; late pulls/account requests cannot re-enable this visit. */
export function revokeOffline(explicit = false) {
  epoch++;
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
    });
    return account;
  } finally {
    opened.close();
  }
}

export function acceptAccount(account: Me, startedEpoch: number) {
  if (startedEpoch !== epoch || state.signedOut || locallySignedOut())
    throw new Error('account_visit_ended');
  if (
    (state.accountId && state.accountId !== account.id) ||
    (contextId() && contextId() !== account.id)
  ) {
    revokeOffline();
  }
  if (state.offline) clearReads();
  emit({ offline: !navigator.onLine, validated: true, accountId: account.id });
  // Authentication fields are selected explicitly by meSchema; cookies/tokens never enter this store.
  if (running) void running.then(() => download(account));
  else void download(account);
}

export function networkLost() {
  if (!client || state.offline) return;
  emit({ offline: true, validated: false });
  clearReads();
}

async function download(account: Me) {
  if (running || state.offline || !state.validated || state.accountId !== account.id)
    return running;
  const ownEpoch = epoch;
  controller = new AbortController();
  const signal = controller.signal;
  running = (async () => {
    try {
      db = await openCollection(account.id);
      const initial = await metadata(db);
      if (ownEpoch !== epoch || signal.aborted || state.accountId !== account.id) return;
      emit({ download: initial.complete ? 'ready' : 'downloading' });
      const tx = db.transaction('meta', 'readwrite');
      const saved = committed(tx);
      tx.objectStore('meta').put(meSchema.parse(account), 'account');
      await saved;
      if (ownEpoch !== epoch) return;
      localStorage.setItem(CONTEXT_KEY, account.id);
      while (!signal.aborted && ownEpoch === epoch && !state.offline) {
        const meta = await metadata(db);
        const page = await request<PullSyncResult>(`/sync?since=${meta.cursor}&limit=200`, {
          signal,
        });
        if (signal.aborted || ownEpoch !== epoch || state.accountId !== account.id) return;
        try {
          await applyPage(db, page);
        } catch (error) {
          // A competing tab committed first: ask again from the durable cursor.
          if ((await metadata(db)).cursor > meta.cursor) continue;
          throw error;
        }
        const applied = await metadata(db);
        if (signal.aborted || ownEpoch !== epoch || state.accountId !== account.id) return;
        if (!page.hasMore && applied.complete) {
          emit({ download: 'ready' });
          break;
        }
      }
    } catch (error) {
      if (ownEpoch === epoch && !signal.aborted) {
        if (error instanceof ApiFailure && error.code === 'network_unreachable') networkLost();
        else emit({ download: 'unavailable' });
      }
    } finally {
      db?.close();
      db = undefined;
    }
  })().finally(() => {
    running = undefined;
  });
  return running;
}

export async function retryDownload(reset = false) {
  if (state.offline || !state.validated || !state.accountId) return;
  const id = state.accountId;
  if (reset) {
    controller?.abort();
    await running;
    await deleteCollection(id);
    emit({ download: 'idle' });
  } else await running;
  if (state.accountId !== id || state.offline || !state.validated) return;
  const account = client?.getQueryData<Me>(['account']);
  if (account?.id === id) await download(account);
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
        emit({ accountId: null, validated: false, download: 'idle', signedOut: true });
        client?.clear();
      } else emit({ signedOut: false });
    }
    if (event.key === CONTEXT_KEY && event.newValue !== state.accountId) {
      epoch++;
      controller?.abort();
      db?.close();
      db = undefined;
      emit({ accountId: null, validated: false, download: 'idle' });
      client?.clear();
      if (!locallySignedOut()) void client?.invalidateQueries({ queryKey: ['account'] });
    }
  });
  window.addEventListener('focus', () => {
    if (state.offline && navigator.onLine) void retryConnection();
    else void retryDownload();
  });
  client.getMutationCache().subscribe((event) => {
    if (event.type === 'updated' && event.mutation.state.status === 'success') {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void retryDownload();
      }, 500);
    }
  });
}

import { useSyncExternalStore } from 'react';

import { meSchema } from '@neuron/shared';
import type { Me, PullSyncResult, DeckNode, Note, Card } from '@neuron/shared';

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
import {
  cancelRenameDelivery,
  deliverRenames,
  onOutboxChange,
  renames,
  renameOverlay,
} from './collection-outbox';
import { clearCollectionProjection, projectCollectionNote } from './collection-read';
import { lifecycle } from './lifecycle';
import {
  cancelNoteDelivery,
  deliverNoteEdits,
  onNoteOutboxChange,
  noteEditFor,
  noteEditOverlay,
} from './note-outbox';
import {
  cancelPracticeDelivery,
  deliverPractice,
  onPracticeChange,
  practiceOutboxKey,
  practiceRecordKey,
  readPractice,
  refreshPracticeRuns,
} from './practice-outbox';
import { cancelReviewDelivery, deliverReviews, onReviewOutboxChange } from './review-outbox';
import { projectConfirmedReview } from './review-projection';

import type { CollectionDiagnostic, CollectionStage } from './collection-failure';
import type { QueryClient, InfiniteData } from '@tanstack/react-query';

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
  /** Local access mode is separate from observable network availability. */
  offline: boolean;
  connectivity: 'unknown' | 'reachable' | 'unreachable';
  checking: boolean;
  revision: number | null;
  validated: boolean;
  accountId: string | null;
  download: Download;
  signedOut: boolean;
  available: boolean;
  failure: CollectionDiagnostic | null;
}
let state: OfflineState = {
  offline: typeof navigator !== 'undefined' && !navigator.onLine,
  connectivity: typeof navigator !== 'undefined' && !navigator.onLine ? 'unreachable' : 'unknown',
  checking: false,
  revision: null,
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
const confirmedReviewCards = new Map<string, Card>();
let connection = 0;
let validatingConnection = false;
let probing: Promise<void> | undefined;
let lastResponse = 0;
let lastSuccess = 0;
let lastValidation = 0;
let suspectedLoss: 'transport' | 'server' | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectAttempt = 0;
const PROBE_FRESH_MS = 15_000;
let controller: AbortController | undefined;
let running: Promise<void> | undefined;
let recovering = false;
let db: IDBDatabase | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
const emit = (patch: Partial<OfflineState>) => {
  if (Object.entries(patch).every(([key, value]) => state[key as keyof OfflineState] === value))
    return;
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
};
export const offlineState = () => state;
export function onOfflineChange(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
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
  clearCollectionProjection();
  confirmedReviewCards.clear();
  cancelRenameDelivery();
  cancelNoteDelivery();
  cancelReviewDelivery();
  cancelPracticeDelivery();
  epoch++;
  connection++;
  validatingConnection = false;
  clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
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
    checking: false,
    revision: null,
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
export function beginAccountValidation() {
  validatingConnection = true;
  emit({ checking: true });
  lifecycle('connection-check-start');
  return ++connection;
}
export function endAccountValidation(startedConnection: number) {
  if (startedConnection !== connection) return;
  validatingConnection = false;
  emit({ checking: false });
  lifecycle('connection-check-end');
  if (state.offline && !state.signedOut) scheduleReconnect();
}

const healthyResponseSince = (started: number) => lastSuccess > started;
export const retainedAccount = () => client?.getQueryData<Me>(['account']);

/** Transport progress never authenticates an account or acknowledges an outbox. */
export function serverResponded(visit: number, successful: boolean) {
  if (visit !== epoch || state.signedOut) return;
  lastResponse = Date.now();
  if (successful) {
    lastSuccess = lastResponse;
    suspectedLoss = null;
  }
  emit({ connectivity: 'reachable' });
  if (successful && state.offline && !validatingConnection) scheduleReconnect(0);
}

function scheduleReconnect(delay?: number) {
  if (reconnectTimer !== undefined && delay !== 0) return;
  clearTimeout(reconnectTimer);
  const wait = delay ?? [1500, 3000, 8000, 15000, 30000][Math.min(reconnectAttempt++, 4)]!;
  const visit = epoch;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    if (visit !== epoch || state.signedOut || !state.offline) return;
    if (document.visibilityState === 'hidden') {
      scheduleReconnect(3000);
      return;
    }
    lifecycle('connection-recheck');
    void retryConnection();
  }, wait);
}

/** Silence permits local access; it does not prove that the network is offline. */
export function connectionUncertain(started: number) {
  if (healthyResponseSince(started) || state.signedOut) return;
  lifecycle('connection-silence');
  enterLocalConnection('unknown');
}

export function accountValidationFailed(started: number, transportFailure: boolean) {
  if (healthyResponseSince(started) || state.signedOut) return;
  if (transportFailure && suspectedLoss !== 'server' && (suspectedLoss || !state.validated))
    networkLost();
  else if (Date.now() - started >= 4000 || !state.validated) connectionUncertain(started);
  else if (suspectedLoss === 'server') accountServerUnavailable(started);
}

/** Corroborated server errors permit local use, without claiming network loss. */
export function accountServerUnavailable(started: number) {
  if (!suspectedLoss || healthyResponseSince(started) || state.signedOut) return;
  lifecycle('connection-server-error');
  enterLocalConnection('reachable');
}

export function requestStalled(started: number, visit: number) {
  if (visit !== epoch || healthyResponseSince(started) || state.signedOut) return;
  connectionUncertain(started);
  void retryConnection();
}

/** An early joined check observes availability without changing presentation. */
export function probeStalledRequest(started: number, visit: number) {
  if (visit !== epoch || healthyResponseSince(started) || state.signedOut) return;
  void confirmForeground();
}

export function offlineReadFailed(error: unknown, visit: number, accountId: string) {
  if (visit !== epoch || state.accountId !== accountId || !state.offline) return;
  const failure = collectionDiagnostic(error, 'database');
  emit({ available: false, download: 'unavailable', failure });
}

let restoration: { visit: number; promise: Promise<Me | undefined> } | undefined;
export function rememberedAccount(): Promise<Me | undefined> {
  if (restoration?.visit === epoch) return restoration.promise;
  const own = { visit: epoch, promise: readRememberedAccount() };
  restoration = own;
  void own.promise
    .finally(() => {
      if (restoration === own) restoration = undefined;
    })
    .catch(() => undefined);
  return own.promise;
}

async function readRememberedAccount(): Promise<Me | undefined> {
  const visit = epoch;
  const id = contextId();
  if (!id) return;
  lifecycle('restore-start');
  let opened: IDBDatabase | undefined;
  try {
    opened = await openCollection(id);
    const account = meSchema.parse(
      await result(opened.transaction('meta').objectStore('meta').get('account')),
    );
    const meta = await metadata(opened);
    if (account.id !== id || contextId() !== id || visit !== epoch || state.signedOut) return;
    if (state.validated) return;
    const transition = !state.offline || state.accountId !== id;
    emit({
      offline: true,
      accountId: id,
      download: meta.complete ? 'ready' : 'idle',
      available: meta.complete,
      revision: meta.cursor,
      failure: null,
    });
    if (transition) void transitionReads(true);
    lifecycle('restore-ready');
    return account;
  } catch (error) {
    lifecycle('restore-failed');
    if (visit === epoch && contextId() === id && !state.validated)
      emit({
        accountId: id,
        available: false,
        download: 'unavailable',
        failure: collectionDiagnostic(error, 'database'),
      });
    throw error;
  } finally {
    opened?.close();
  }
}

/** Offline restoration must not wait for a suspended session-validation fetch. */
async function restoreOfflineAccount() {
  const visit = epoch;
  if (client?.getQueryData<Me>(['account']) || state.signedOut) return;
  // Local presentation and server validation run independently. Neither a browser
  // hint nor repeated foreground events may invalidate an account-scoped read.
  const account = await rememberedAccount().catch(() => undefined);
  if (
    account &&
    visit === epoch &&
    !state.validated &&
    state.offline &&
    client?.getQueryData<Me>(['account'])?.id !== account.id
  )
    client?.setQueryData(['account'], account);
}

export function acceptAccount(account: Me, startedEpoch: number, startedConnection: number) {
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
  lastValidation = Date.now();
  lastResponse = lastValidation;
  lastSuccess = lastValidation;
  reconnectAttempt = 0;
  suspectedLoss = null;
  clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  emit({ offline: false, validated: true, connectivity: 'reachable', accountId: account.id });
  client?.setQueryData(['account'], account);
  lifecycle('account-ready');
  if (newAccount || reconnecting) {
    void deliverReviews();
    void deliverPractice();
  }
  if (reconnecting) void transitionReads(false);
  // Authentication fields are selected explicitly by meSchema; cookies/tokens never enter this store.
  // Repeated account reads/navigation join the current visit; they never queue pulls.
  if (running && !newAccount && !reconnecting) return;
  if (
    newAccount ||
    reconnecting ||
    state.download === 'idle' ||
    (state.revision !== null && state.revision !== account.revision)
  ) {
    const visit = epoch;
    if (running)
      void running.then(() => {
        if (visit === epoch) void download(account);
      });
    else void download(account);
  }
}

export function networkLost() {
  lifecycle('connection-unreachable');
  enterLocalConnection('unreachable');
}

function enterLocalConnection(connectivity: OfflineState['connectivity']) {
  if (!client) return;
  if (state.offline) {
    if (connectivity === 'unreachable') emit({ connectivity });
    void restoreOfflineAccount();
    if (!validatingConnection) scheduleReconnect();
    return;
  }
  lifecycle('offline');
  emit({ offline: true, validated: false, connectivity });
  cancelRenameDelivery();
  cancelNoteDelivery();
  cancelReviewDelivery();
  cancelPracticeDelivery();
  controller?.abort();
  void restoreOfflineAccount();
  void transitionReads(true);
  if (!validatingConnection) scheduleReconnect();
}

/** A failed collection read is confirmed through the session authority, not connectivity hints. */
export function confirmConnection(
  reason: 'navigation' | 'failure' | 'server-error' = 'navigation',
) {
  if (state.signedOut) return Promise.resolve();
  if (reason === 'failure') suspectedLoss = 'transport';
  else if (reason === 'server-error') suspectedLoss ??= 'server';
  if (
    reason === 'navigation' &&
    !state.offline &&
    Date.now() - Math.max(lastValidation, lastResponse) < PROBE_FRESH_MS
  )
    return Promise.resolve();
  return confirmForeground();
}

function confirmForeground() {
  if (state.signedOut) return Promise.resolve();
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
  let effectiveAccount = account;
  let settingsRefreshes = 0;
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
      await deliverRenames();
      await deliverNoteEdits();
      // After Note edits, so the server's pool already holds what this device practiced on.
      await deliverPractice();
      if (ownEpoch !== epoch || signal.aborted || state.accountId !== account.id) return;
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
          emit({ download: 'ready', available: true, revision: applied.cursor, failure: null });
          void refreshPracticeRuns(signal).catch(() => undefined);
          // A Review delivery or settings write may advance the pull beyond
          // the account response that started it. Refresh that existing record,
          // then finish pulling if the confirmed head advanced again.
          if (effectiveAccount.revision !== applied.cursor && settingsRefreshes++ < 2) {
            const acceptedBefore = lastValidation;
            await retryConnection();
            if (ownEpoch !== epoch || signal.aborted || state.offline || !state.validated) return;
            const fresh = retainedAccount();
            if (
              fresh?.id === account.id &&
              lastValidation >= acceptedBefore &&
              fresh.revision !== effectiveAccount.revision
            ) {
              const accountTx = opened.transaction('meta', 'readwrite');
              const savedAccount = committed(accountTx);
              accountTx.objectStore('meta').put(meSchema.parse(fresh), 'account');
              await savedAccount;
              void client?.invalidateQueries({ queryKey: ['downloaded-study-readiness'] });
              effectiveAccount = fresh;
              if (fresh.revision > applied.cursor) continue;
            }
          }
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
      await deleteCollection(id);
      clearCollectionProjection();
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
  if (state.signedOut) return Promise.resolve();
  clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  // Every source joins the bounded account query. A tap never cancels useful progress.
  return client?.invalidateQueries(
    { queryKey: ['account'], exact: true },
    { cancelRefetch: false },
  );
}

export function initializeOffline(queryClient: QueryClient) {
  client = queryClient;
  if (!state.signedOut) void restoreOfflineAccount();
  onReviewOutboxChange((change) => {
    if (change.accountId !== state.accountId) return;
    void client?.invalidateQueries({ queryKey: ['review-outbox', change.accountId] });
    const settled = change.entries ?? (change.entry ? [change.entry] : []);
    void client?.invalidateQueries({
      queryKey: ['downloaded-study-readiness', change.accountId],
      refetchType: settled.some((entry) => entry.state === 'rejected') ? 'active' : 'none',
    });
    const confirmed = settled.filter(
      (entry) => ['synchronized', 'archived'].includes(entry.state) && entry.acknowledgement,
    );
    if (change.saved) {
      void client?.invalidateQueries({ queryKey: ['study-plan'], refetchType: 'none' });
      void deliverReviews();
    } else if (confirmed.length && client) {
      // A batch settles as one change. Each answer still projects its own card,
      // in the order the server applied them, so the last one wins per card.
      for (const entry of confirmed) {
        const after = entry.acknowledgement!.card;
        const before = confirmedReviewCards.get(after.id) ?? entry.before;
        projectConfirmedReview(client, before, after, new Date());
        confirmedReviewCards.set(after.id, after);
      }
      void client.invalidateQueries({ queryKey: ['study-plan'], refetchType: 'none' });
      void client.invalidateQueries({ queryKey: ['decks'], refetchType: 'none' });
      void client.invalidateQueries({ queryKey: ['notes'], refetchType: 'none' });
      const visit = epoch;
      clearTimeout(timer);
      timer = setTimeout(() => {
        // Reconcile immutable history after this delivery batch, including a
        // hydration page whose revision boundary preceded the acknowledgement.
        void (running ?? Promise.resolve()).then(() => {
          if (visit === epoch) refreshDownload();
        });
      }, 500);
    }
  });
  onPracticeChange((change) => {
    if (change.accountId !== state.accountId) return;
    void client?.invalidateQueries({ queryKey: practiceOutboxKey(change.accountId) });
    void readPractice(change.accountId, change.deckId)
      .then((record) =>
        client?.setQueryData(practiceRecordKey(change.accountId, change.deckId), record ?? null),
      )
      .catch(() => undefined);
  });
  onNoteOutboxChange((change) => {
    const id = state.accountId;
    const visit = epoch;
    if (!id || change.accountId !== id) return;
    void client?.invalidateQueries({
      queryKey: ['downloaded-study-readiness', id],
      refetchType: 'none',
    });
    void client?.invalidateQueries({ queryKey: ['study-plan'], refetchType: 'none' });
    void client?.invalidateQueries({ queryKey: ['note-outbox', id], exact: true });
    void client?.invalidateQueries({ queryKey: ['note-outbox', id, change.entityId], exact: true });
    void noteEditFor(id, change.entityId)
      .then((entry) => {
        if (visit !== epoch || id !== state.accountId) return;
        projectCollectionNote(id, change.entityId, entry, change.version);
        // Patch cached content only. No cancelled request, tree notification or
        // full collection read competes with the editor's next keystroke.
        client?.setQueryData<{ note: Note; cards: Card[]; local?: true }>(
          ['notes', change.entityId],
          (data) => {
            if (!data || !entry) return data;
            const note = noteEditOverlay(entry, data.note);
            return note === data.note ? data : { ...data, note, local: true };
          },
        );
        for (const [key, pages] of client?.getQueriesData<
          InfiniteData<{ items: Note[]; nextCursor?: string }>
        >({ queryKey: ['notes', 'list'] }) ?? []) {
          if (!pages || !entry) continue;
          client?.setQueryData(key, {
            ...pages,
            pages: pages.pages.map((page) => {
              let patched = false;
              const items = page.items.map((note) => {
                if (note.id !== change.entityId) return note;
                const next = noteEditOverlay(entry, note);
                patched ||= next !== note;
                return next;
              });
              // Learning pools cannot treat a local content overlay as authority.
              return patched ? { ...page, items, local: true } : page;
            }),
          });
        }
        void client?.invalidateQueries({ queryKey: ['notes', 'list'], refetchType: 'none' });
        if (entry?.state === 'synchronized' || !entry)
          void client?.invalidateQueries({
            queryKey: ['notes', change.entityId],
            exact: true,
            refetchType: 'none',
          });
        if (state.validated && !state.offline) {
          void deliverNoteEdits().then(() => {
            if (visit === epoch && (entry?.state === 'synchronized' || entry?.state === 'conflict'))
              refreshDownload();
          });
        }
      })
      .catch(() => undefined);
  });
  onOutboxChange(() => {
    const visit = epoch;
    const id = state.accountId;
    if (!id) return;
    void client?.invalidateQueries({ queryKey: ['outbox', id] });
    void renames(id)
      .then((entries) => {
        if (visit !== epoch || id !== state.accountId) return;
        const overlay = (rows: readonly DeckNode[]): DeckNode[] =>
          rows.map((row) => ({
            ...row,
            name: renameOverlay(entries, row.id, row.rev) ?? row.name,
            children: overlay(row.children),
          }));
        client?.setQueryData<{ decks: DeckNode[]; local?: true }>(
          ['decks'],
          (data) => data && { ...data, decks: overlay(data.decks) },
        );
        if (state.offline) void client?.invalidateQueries({ queryKey: ['decks'] });
        else
          void deliverRenames().then(() => {
            if (visit === epoch) {
              refreshDownload();
              // A settled outbox result can release its name overlay. Active online
              // mutations keep ownership of their optimistic fields until settlement.
              if (entries.some((entry) => entry.state !== 'pending') && client?.isMutating() === 0)
                void client.invalidateQueries({ queryKey: ['decks'] });
            }
          });
      })
      .catch(() => undefined);
  });
  window.addEventListener('offline', () => {
    lifecycle('offline-event');
    networkLost();
  });
  window.addEventListener('online', () => {
    // Remain read-only until the server has freshly accepted this account.
    void confirmConnection();
  });
  window.addEventListener('storage', (event) => {
    if (event.key === SIGNED_OUT_KEY) {
      if (event.newValue === 'true') {
        confirmedReviewCards.clear();
        cancelRenameDelivery();
        cancelNoteDelivery();
        cancelReviewDelivery();
        cancelPracticeDelivery();
        epoch++;
        connection++;
        validatingConnection = false;
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
        controller?.abort();
        db?.close();
        db = undefined;
        emit({
          accountId: null,
          validated: false,
          download: 'idle',
          available: false,
          checking: false,
          revision: null,
          failure: null,
          signedOut: true,
        });
        client?.clear();
      } else emit({ signedOut: false });
    }
    if (event.key === CONTEXT_KEY && event.newValue !== state.accountId) {
      confirmedReviewCards.clear();
      cancelRenameDelivery();
      cancelNoteDelivery();
      cancelReviewDelivery();
      cancelPracticeDelivery();
      epoch++;
      connection++;
      validatingConnection = false;
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      controller?.abort();
      db?.close();
      db = undefined;
      emit({
        accountId: null,
        validated: false,
        download: 'idle',
        available: false,
        checking: false,
        revision: null,
        failure: null,
      });
      client?.clear();
      if (!locallySignedOut()) void client?.invalidateQueries({ queryKey: ['account'] });
    }
  });
  const foreground = () => {
    lifecycle('foreground');
    // A connectivity hint cannot cancel the validation another foreground event
    // just started. Real loss events revoke authority; focus only requests it.
    // Coalesce focus/pageshow/visibility into one bounded probe.
    void confirmConnection().then(() => {
      if (!state.validated || state.offline || state.checking) return;
      void deliverReviews();
      void deliverPractice();
      refreshDownload();
    });
  };
  window.addEventListener('focus', () => {
    lifecycle('focus');
    foreground();
  });
  window.addEventListener('pageshow', (event) => {
    lifecycle(event.persisted ? 'pageshow-cached' : 'pageshow');
    if (event.persisted) foreground();
  });
  document.addEventListener('visibilitychange', () => {
    lifecycle(document.visibilityState === 'visible' ? 'visible' : 'hidden');
    if (document.visibilityState === 'visible') foreground();
  });
  client.getMutationCache().subscribe((event) => {
    if (event.type === 'updated' && event.mutation.state.status === 'success') {
      const data = event.mutation.state.data;
      // Local rename persistence already notifies the outbox. It is not a
      // server acknowledgement that needs the online-write follow-up timer.
      if (
        event.mutation.options.mutationKey?.[0] === 'collection-rename' &&
        typeof data === 'object' &&
        data !== null &&
        'operationId' in data
      )
        return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        refreshDownload();
      }, 500);
    }
  });
}

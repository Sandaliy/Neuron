import { useSyncExternalStore } from 'react';

import { TRIAGE_BATCH_LIMIT, triageChoiceSchema, triageResultSchema } from '@neuron/shared';
import type { TriageChoice, TriageList, TriageResult } from '@neuron/shared';

import { ApiFailure, request } from './api';
import { TRIAGE_PREFIX, committed, openCollection, result, triageRange } from './collection-db';
import { localTriage } from './collection-read';
import { collectionRead } from './collection-transport';
import { lifecycle } from './lifecycle';
import { deliverNoteCreations } from './note-creation';
import { deliverNoteEdits } from './note-outbox';
import { offlineState, onOfflineChange } from './offline';

import type { QueryClient } from '@tanstack/react-query';

/**
 * Triage decisions on this device, and their way to the server.
 *
 * A decision is shown the moment it is made and written to the account's own
 * collection database straight after, so closing the app, a reload or a lost
 * connection loses nothing. Decisions travel in batches of up to five hundred
 * whenever the server can be reached. Each is absolute (this Note is Known),
 * so sending one twice is harmless and the latest one for a Note is the only
 * one that matters.
 *
 * Until a decision has been delivered, Study (on the server or planned on this
 * device) has not heard of it.
 */

export type LoadedTriage = TriageList & { local?: true };
export const triageKey = (deckId: string) => ['notes', 'triage', deckId] as const;

export function triageQuery(deckId: string) {
  return {
    queryKey: triageKey(deckId),
    networkMode: 'always' as const,
    queryFn: async ({ signal, client }: { signal: AbortSignal; client: QueryClient }) =>
      collectionRead<LoadedTriage>(
        `/notes/triage?deckId=${deckId}`,
        signal,
        () => localTriage(deckId),
        (value) => {
          if (!client.getQueryData(triageKey(deckId)))
            client.setQueryData(triageKey(deckId), value, { updatedAt: 0 });
        },
        () => !client.getQueryData(triageKey(deckId)),
      ),
  };
}

interface Stored {
  kind: 'triage';
  accountId: string;
  noteId: string;
  choice: TriageChoice;
  sequence: number;
}

/** What the screen needs to say about delivery. */
export type TriageDelivery = 'idle' | 'sending' | 'waiting';

export interface TriageSnapshot {
  readonly accountId: string | null;
  readonly pending: ReadonlyMap<string, TriageChoice>;
  readonly delivery: TriageDelivery;
  /** Decisions the server did not apply since this visit began, for one quiet notice. */
  readonly skipped: number;
}

const key = (noteId: string) => `${TRIAGE_PREFIX}${noteId}`;
/** Waits after a failed delivery, the same ladder answers use. */
const RETRY_SECONDS = [2, 5, 15, 30, 60];
/** Decisions made in a quick run go as one request. */
const GATHER_MS = 500;

let client: QueryClient | undefined;
let accountId: string | null = null;
let entries = new Map<string, { choice: TriageChoice; sequence: number }>();
let sequence = Date.now() * 1000;
let delivery: TriageDelivery = 'idle';
let skipped = 0;
let snapshot: TriageSnapshot = { accountId, pending: new Map(), delivery, skipped };
let loading: Promise<void> | undefined;
let writes = new Map<string, Stored | null>();
let writing: Promise<void> | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let due = Number.POSITIVE_INFINITY;
let attempt = 0;
let running = false;
const listeners = new Set<() => void>();

function publish() {
  snapshot = {
    accountId,
    pending: new Map([...entries].map(([id, entry]) => [id, entry.choice])),
    delivery,
    skipped,
  };
  for (const listener of listeners) listener();
}

function validated(value: unknown, account: string): Stored | undefined {
  const row = value as Partial<Stored> | undefined;
  if (
    !row ||
    row.kind !== 'triage' ||
    row.accountId !== account ||
    typeof row.noteId !== 'string' ||
    typeof row.sequence !== 'number' ||
    !triageChoiceSchema.safeParse(row.choice).success
  )
    return undefined;
  return row as Stored;
}

/** Adopts the signed-in account's saved decisions, and forgets another account's. */
function adopt(next: string | null) {
  if (next === accountId) return;
  // Decisions not yet written still belong to the account that made them.
  if (accountId && writes.size) void store(accountId, writes);
  accountId = next;
  entries = new Map();
  writes = new Map();
  delivery = 'idle';
  skipped = 0;
  attempt = 0;
  cancelSchedule();
  publish();
  if (!next) return;
  const owner = next;
  loading = (async () => {
    try {
      const db = await openCollection(owner);
      try {
        const values = await result<unknown[]>(
          db.transaction('meta').objectStore('meta').getAll(triageRange()),
        );
        if (accountId !== owner) return;
        for (const value of values) {
          const row = validated(value, owner);
          // A decision made since the read started is newer than anything stored.
          if (row && !entries.has(row.noteId))
            entries.set(row.noteId, { choice: row.choice, sequence: row.sequence });
        }
      } finally {
        db.close();
      }
    } catch {
      lifecycle('triage-read-failed');
    }
    if (accountId !== owner) return;
    publish();
    schedule(0);
  })();
}

async function store(owner: string, batch: ReadonlyMap<string, Stored | null>): Promise<void> {
  try {
    const db = await openCollection(owner);
    try {
      const tx = db.transaction('meta', 'readwrite');
      const done = committed(tx);
      const meta = tx.objectStore('meta');
      for (const [noteId, row] of batch) {
        if (row) meta.put(row, key(noteId));
        else meta.delete(key(noteId));
      }
      await done;
    } finally {
      db.close();
    }
  } catch {
    // The decisions stay in memory and still travel; only a reload could lose them now.
    lifecycle('triage-write-failed');
  }
}

/** One transaction at a time, carrying every change made while the last one ran. */
function persist() {
  if (writing || writes.size === 0 || !accountId) return;
  const owner = accountId;
  const batch = writes;
  writes = new Map();
  writing = store(owner, batch).finally(() => {
    writing = undefined;
    persist();
  });
}

/**
 * Sends after `delay`, unless a send is already due sooner. A run of taps
 * never pushes delivery back, so a long sweep is sent as it goes rather than
 * when the learner finally pauses.
 */
function schedule(delay: number) {
  if (!entries.size || !accountId) return;
  const at = Date.now() + delay;
  if (timer !== undefined && at >= due) return;
  clearTimeout(timer);
  due = at;
  timer = setTimeout(() => {
    timer = undefined;
    due = Number.POSITIVE_INFINITY;
    void deliver();
  }, delay);
}

function cancelSchedule() {
  clearTimeout(timer);
  timer = undefined;
  due = Number.POSITIVE_INFINITY;
}

function authority() {
  const state = offlineState();
  return (
    !!accountId &&
    state.accountId === accountId &&
    state.validated &&
    !state.offline &&
    !state.signedOut
  );
}

function settle(result: TriageResult, sent: ReadonlyMap<string, number>) {
  const applied = new Map(result.applied.map((entry) => [entry.id, entry.choice]));
  for (const [id, sentSequence] of sent) {
    // A newer decision made while this one travelled stays and goes next.
    if (entries.get(id)?.sequence !== sentSequence) continue;
    entries.delete(id);
    writes.set(id, null);
  }
  skipped += result.skipped.length;
  // The cached lists take the server's answer before the overlay lets go, so
  // nothing on screen steps back to what it was before the decision.
  for (const [queryKey, data] of client?.getQueriesData<LoadedTriage>({
    queryKey: ['notes', 'triage'],
  }) ?? [])
    if (data)
      client?.setQueryData(queryKey, {
        ...data,
        items: data.items.map((item) => {
          const choice = applied.get(item.id);
          return choice === undefined || choice === item.choice ? item : { ...item, choice };
        }),
      });
  if (result.skipped.length) void client?.invalidateQueries({ queryKey: ['notes', 'triage'] });
  // Status changes reach the browse list, the Deck counts and the Study plan.
  void client?.invalidateQueries({ queryKey: ['notes', 'list'], refetchType: 'none' });
  void client?.invalidateQueries({ queryKey: ['decks'], refetchType: 'none' });
  void client?.invalidateQueries({ queryKey: ['study-plan'], refetchType: 'none' });
  void client?.invalidateQueries({ queryKey: ['downloaded-study-readiness'], refetchType: 'none' });
}

async function deliver(): Promise<void> {
  if (running) return;
  if (loading) await loading;
  if (!entries.size) {
    if (delivery !== 'idle') {
      delivery = 'idle';
      publish();
    }
    return;
  }
  if (!authority()) {
    delivery = 'waiting';
    publish();
    return;
  }
  running = true;
  delivery = 'sending';
  publish();
  const owner = accountId;
  try {
    // A decision takes a new revision for its Note. This device's own new Notes
    // and edits go first, or an edit based on the old revision would come back
    // as changed remotely, and a decision about an unsent Note as missing.
    await deliverNoteCreations();
    await deliverNoteEdits();
    while (entries.size && authority() && accountId === owner) {
      const sent = new Map(
        [...entries].slice(0, TRIAGE_BATCH_LIMIT).map(([id, entry]) => [id, entry.sequence]),
      );
      const decisions = [...sent.keys()].map((id) => ({ id, choice: entries.get(id)!.choice }));
      let answer: TriageResult;
      try {
        answer = triageResultSchema.parse(
          await request('/notes/triage', { method: 'POST', body: { decisions } }),
        );
      } catch (error) {
        if (!(error instanceof ApiFailure && error.code === 'invalid_request')) throw error;
        // Refused as malformed. The same bytes cannot succeed later, so the
        // server's own state is shown again instead of retrying for ever.
        lifecycle('triage-refused');
        answer = {
          applied: [],
          skipped: decisions.map(({ id }) => ({ id, reason: 'missing' as const })),
        };
      }
      if (accountId !== owner) return;
      settle(answer, sent);
      attempt = 0;
      persist();
      publish();
    }
    delivery = entries.size ? 'waiting' : 'idle';
  } catch {
    delivery = 'waiting';
    const wait = RETRY_SECONDS[Math.min(attempt, RETRY_SECONDS.length - 1)]!;
    attempt++;
    schedule(wait * 1000);
  } finally {
    running = false;
    publish();
  }
}

/** Records a decision. The screen sees it at once; the device and the server a moment later. */
export function decideTriage(noteId: string, choice: TriageChoice) {
  if (!accountId) adopt(offlineState().accountId);
  if (!accountId) return;
  const next = { choice, sequence: ++sequence };
  entries.set(noteId, next);
  writes.set(noteId, { kind: 'triage', accountId, noteId, ...next });
  persist();
  delivery = authority() ? 'sending' : 'waiting';
  publish();
  schedule(GATHER_MS);
}

/** Sends what is waiting now, rather than after the pause that gathers a run of decisions. */
export function flushTriage() {
  schedule(0);
}

/** Wired once at startup, next to the other deliveries. */
export function initializeTriage(queryClient: QueryClient) {
  client = queryClient;
  adopt(offlineState().accountId);
  onOfflineChange(() => {
    adopt(offlineState().accountId);
    if (authority() && entries.size && !running) schedule(0);
    else if (entries.size && !authority() && delivery !== 'waiting') {
      delivery = 'waiting';
      publish();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushTriage();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTriageDecisions(): TriageSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot);
}

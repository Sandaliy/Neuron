import {
  isPracticeRunConsistent,
  practiceCommandSchema,
  practiceResultSchema,
  practiceRunSchema,
  practiceRunsResultSchema,
  uuidV7,
} from '@neuron/shared';
import type { PracticeCommand, PracticeRun } from '@neuron/shared';

import { ApiFailure, request } from './api';
import { committed, openCollection, result } from './collection-db';
import { accountEpoch, offlineState } from './offline';

export interface PracticeConfirmed {
  run: PracticeRun | null;
  version: number;
}
/** Two runs of one Deck that cannot both continue. Nothing is sent until the learner picks. */
export interface PracticeConflictState {
  /** What this device showed, and the commands the server refused. */
  device: PracticeRun | null;
  commands: PracticeCommand[];
  other: PracticeConfirmed;
}
/**
 * One Deck's Practice on this device, stored as a single record so every change to it is one
 * transaction: the last server state, the commands not yet acknowledged on top of it, and the run
 * the learner last saw. Practice never touches Study, so it has no place in the Review outbox.
 */
export interface PracticeRecord {
  kind: 'practice';
  accountId: string;
  deckId: string;
  confirmed: PracticeConfirmed;
  pending: PracticeCommand[];
  device: PracticeRun | null;
  /** Why the last delivery stopped short, while the commands wait for another attempt. */
  failure?: string;
  conflict?: PracticeConflictState;
  /** The version the learner decided against, retained on this device. */
  archived?: PracticeConflictState & { kept: 'device' | 'other' };
}
export const practiceKey = (deckId: string) => `practice:${deckId}`;
/** Query keys kept current from every change, so a remounted screen never shows an old record. */
export const practiceRecordKey = (accountId: string | null, deckId: string) => [
  'practice-record',
  accountId,
  deckId,
];
export const practiceOutboxKey = (accountId: string | null) => ['practice-outbox', accountId];
const KEY_RANGE = () => IDBKeyRange.bound('practice:', 'practice:￿');

function confirmedOf(input: unknown): PracticeConfirmed {
  const parsed = practiceResultSchema.parse(input);
  return { run: parsed.run, version: parsed.version };
}
function conflictOf(input: unknown): PracticeConflictState {
  const value = input as PracticeConflictState;
  return {
    device: value.device === null ? null : practiceRunSchema.parse(value.device),
    commands: practiceCommandSchema.array().parse(value.commands),
    other: confirmedOf(value.other),
  };
}
/** Device data is validated on every read; a record of another account is never accepted. */
export function validatePracticeRecord(input: unknown, accountId: string): PracticeRecord {
  const value = input as PracticeRecord;
  if (
    !value ||
    value.kind !== 'practice' ||
    value.accountId !== accountId ||
    typeof value.deckId !== 'string'
  )
    throw new Error('practice_invalid_record');
  const pending = practiceCommandSchema.array().parse(value.pending);
  const confirmed = confirmedOf(value.confirmed);
  // Commands chain one version each. An acknowledgement may carry another device's later
  // commands too, which leaves the rest behind the base until delivery settles them.
  if (
    (pending[0] && pending[0].expectedVersion > confirmed.version) ||
    pending.some(
      (command, index) => command.expectedVersion !== pending[0]!.expectedVersion + index,
    )
  )
    throw new Error('practice_invalid_record');
  return {
    kind: 'practice',
    accountId,
    deckId: value.deckId,
    confirmed,
    pending,
    device: value.device === null ? null : practiceRunSchema.parse(value.device),
    ...(typeof value.failure === 'string' ? { failure: value.failure } : {}),
    ...(value.conflict ? { conflict: conflictOf(value.conflict) } : {}),
    ...(value.archived
      ? {
          archived: {
            ...conflictOf(value.archived),
            kept: value.archived.kept === 'device' ? 'device' : 'other',
          },
        }
      : {}),
  };
}
/** The version the next command on this device is built on. */
export const nextPracticeVersion = (record: PracticeRecord) =>
  record.pending.length ? record.pending.at(-1)!.expectedVersion + 1 : record.confirmed.version;
export const emptyPracticeRecord = (
  accountId: string,
  deckId: string,
  confirmed: PracticeConfirmed = { run: null, version: 0 },
): PracticeRecord => ({
  kind: 'practice',
  accountId,
  deckId,
  confirmed,
  pending: [],
  device: confirmed.run,
});

type Change = { accountId: string; deckId: string };
const listeners = new Set<(change: Change) => void>();
const channel =
  typeof BroadcastChannel === 'undefined'
    ? undefined
    : new BroadcastChannel('neuron.practice.changed');
channel?.addEventListener('message', (event: MessageEvent<Change>) => {
  if (typeof event.data?.accountId === 'string' && typeof event.data.deckId === 'string')
    listeners.forEach((listener) => listener(event.data));
});
function changed(change: Change) {
  listeners.forEach((listener) => listener(change));
  channel?.postMessage(change);
}
export function onPracticeChange(listener: (change: Change) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Records kept in memory, for a visit whose device storage could not be opened. They exist only
 * while the server can take each command at once, and the screen says progress is not kept here.
 */
const volatile = new Map<string, PracticeRecord>();
const volatileKey = (accountId: string, deckId: string) => `${accountId}:${deckId}`;
export const isVolatile = (accountId: string, deckId: string) =>
  volatile.has(volatileKey(accountId, deckId));

export async function readPractice(
  accountId: string,
  deckId: string,
): Promise<PracticeRecord | undefined> {
  const kept = volatile.get(volatileKey(accountId, deckId));
  if (kept) return kept;
  const db = await openCollection(accountId);
  try {
    const value = await result(db.transaction('meta').objectStore('meta').get(practiceKey(deckId)));
    return value === undefined ? undefined : validatePracticeRecord(value, accountId);
  } finally {
    db.close();
  }
}
export async function practiceRecords(accountId: string): Promise<PracticeRecord[]> {
  const db = await openCollection(accountId);
  let stored: PracticeRecord[];
  try {
    const values = await result<unknown[]>(
      db.transaction('meta').objectStore('meta').getAll(KEY_RANGE()),
    );
    stored = values.map((value) => validatePracticeRecord(value, accountId));
  } finally {
    db.close();
  }
  return [...stored, ...[...volatile.values()].filter((record) => record.accountId === accountId)];
}
export function startVolatile(record: PracticeRecord) {
  volatile.set(volatileKey(record.accountId, record.deckId), record);
}

/**
 * The one way a record changes: read, decide and write in a single strict transaction, so two tabs
 * or a delivery racing a tap can never write over each other. `decide` returns the next record, or
 * undefined to leave the stored one as it is.
 */
async function update(
  accountId: string,
  deckId: string,
  decide: (current: PracticeRecord | undefined) => PracticeRecord | undefined,
  active: () => boolean,
): Promise<PracticeRecord | undefined> {
  const key = volatileKey(accountId, deckId);
  const kept = volatile.get(key);
  if (kept) {
    if (!active()) throw new Error('practice_account_changed');
    const next = decide(kept);
    if (next) volatile.set(key, next);
    if (next) changed({ accountId, deckId });
    return next ?? kept;
  }
  const db = await openCollection(accountId);
  try {
    const tx = db.transaction('meta', 'readwrite', { durability: 'strict' });
    const done = committed(tx);
    const store = tx.objectStore('meta');
    const read = store.get(practiceKey(deckId));
    let failure: unknown;
    let written: PracticeRecord | undefined;
    let current: PracticeRecord | undefined;
    read.onsuccess = () => {
      try {
        if (!active()) throw new Error('practice_account_changed');
        current =
          read.result === undefined ? undefined : validatePracticeRecord(read.result, accountId);
        written = decide(current);
        if (written) store.put(written, practiceKey(deckId));
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
    if (written) changed({ accountId, deckId });
    return written ?? current;
  } finally {
    db.close();
  }
}
const visitGuard = (accountId: string) => {
  const visit = accountEpoch();
  return () =>
    visit === accountEpoch() && offlineState().accountId === accountId && !offlineState().signedOut;
};

/**
 * A command becomes durable here, and the screen advances only after this resolves. `expected`
 * is the record the screen built the command on; any other tab's change in between refuses it.
 */
export function savePracticeCommand(
  accountId: string,
  deckId: string,
  expected: { version: number; pending: readonly string[] },
  command: PracticeCommand,
  device: PracticeRun,
) {
  return update(
    accountId,
    deckId,
    (current) =>
      appendCommand(current ?? emptyPracticeRecord(accountId, deckId), expected, command, device),
    visitGuard(accountId),
  );
}
export function appendCommand(
  record: PracticeRecord,
  expected: { version: number; pending: readonly string[] },
  command: PracticeCommand,
  device: PracticeRun,
): PracticeRecord {
  if (
    record.conflict ||
    record.confirmed.version !== expected.version ||
    record.pending.map((entry) => entry.id).join() !== expected.pending.join() ||
    command.expectedVersion !== nextPracticeVersion(record)
  )
    throw new Error('practice_changed');
  practiceCommandSchema.parse(command);
  return { ...record, pending: [...record.pending, command], device };
}

/** A server read replaces the stored base only when nothing on this device builds on it. */
export function adoptPractice(accountId: string, deckId: string, latest: PracticeConfirmed) {
  return update(
    accountId,
    deckId,
    (current) =>
      current ? adoptLatest(current, latest) : emptyPracticeRecord(accountId, deckId, latest),
    visitGuard(accountId),
  );
}
export function adoptLatest(
  record: PracticeRecord,
  latest: PracticeConfirmed,
): PracticeRecord | undefined {
  if (
    record.pending.length ||
    record.conflict ||
    latest.version < record.confirmed.version ||
    JSON.stringify(record.confirmed) === JSON.stringify(latest)
  )
    return undefined;
  return { ...record, confirmed: latest, device: latest.run };
}
/**
 * The server took the oldest command. Commands after it were built on the version it produced;
 * when the answer also carries another device's commands, the next delivery is refused and
 * settled like any other refusal.
 */
export function acknowledge(
  record: PracticeRecord,
  commandId: string,
  answer: PracticeConfirmed,
): PracticeRecord | undefined {
  if (record.pending[0]?.id !== commandId) return undefined;
  const { failure: _cleared, ...rest } = record;
  const pending = record.pending.slice(1);
  return {
    ...rest,
    confirmed: answer,
    pending,
    device: pending.length ? record.device : answer.run,
  };
}

/**
 * Earlier versions kept unsent commands in local storage, where a failed write went unnoticed.
 * They move into the record once, ahead of anything new, and keep their identities.
 */
export function importLegacyPractice(
  accountId: string,
  deckId: string,
  commands: PracticeCommand[],
  base: PracticeConfirmed,
  device: PracticeRun | null,
) {
  return update(
    accountId,
    deckId,
    (current) => {
      if (current?.pending.length || current?.conflict || !commands.length) return undefined;
      const confirmed =
        commands[0]!.expectedVersion <= base.version
          ? base
          : { run: base.run, version: commands[0]!.expectedVersion };
      return {
        ...(current ?? emptyPracticeRecord(accountId, deckId)),
        confirmed,
        pending: commands,
        device,
      };
    },
    visitGuard(accountId),
  );
}

/** Pulls every stored run, so a downloaded collection carries Practice progress too. */
export async function refreshPracticeRuns(signal?: AbortSignal) {
  const accountId = offlineState().accountId;
  if (!accountId || !offlineState().validated || offlineState().offline) return;
  const active = visitGuard(accountId);
  const { runs } = practiceRunsResultSchema.parse(
    await request('/decks/practice', signal ? { signal } : {}),
  );
  for (const entry of runs) {
    if (!active()) return;
    await adoptPractice(accountId, entry.deckId, { run: entry.run, version: entry.version });
  }
}

/**
 * Runs compared as progress, over the Notes both of them still hold. A Note added or removed on one
 * side only is a difference in content, not in what the learner did.
 */
export function sameProgress(a: PracticeRun | null, b: PracticeRun | null): boolean {
  if (!a || !b) return a === b;
  if (
    a.id !== b.id ||
    a.round !== b.round ||
    (a.response ?? 'reveal') !== (b.response ?? 'reveal') ||
    JSON.stringify(a.front) !== JSON.stringify(b.front) ||
    JSON.stringify(a.back) !== JSON.stringify(b.back)
  )
    return false;
  const shared = Object.keys(a.statuses).filter((id) => b.statuses[id] !== undefined);
  const keep = new Set(shared);
  return (
    shared.every((id) => a.statuses[id] === b.statuses[id]) &&
    a.queue.filter((id) => keep.has(id)).join() === b.queue.filter((id) => keep.has(id)).join()
  );
}

/**
 * What a refusal means. Only a real divergence becomes a question for the learner: if one side
 * has nothing of its own, or both did the same, the other side is simply continued.
 */
export function settleRefusal(
  record: PracticeRecord,
  other: PracticeConfirmed,
  rebased: boolean,
): PracticeRecord {
  const { failure: _settled, ...rest } = record;
  const base = record.confirmed.run;
  const device = record.device;
  const refusedFromStart = record.pending[0]?.expectedVersion === record.confirmed.version;
  if (sameProgress(device, base) || sameProgress(device, other.run))
    return { ...rest, confirmed: other, pending: [], device: other.run };
  if (!rebased && refusedFromStart && sameProgress(other.run, base))
    return {
      ...rest,
      confirmed: other,
      pending: record.pending.map((command, index) => ({
        ...command,
        id: uuidV7(),
        expectedVersion: other.version + index,
      })),
    };
  return { ...rest, pending: [], conflict: { device, commands: record.pending, other } };
}

/** The learner's choice. Their own run goes back as one command; the other is just adopted. */
export function resolvePractice(accountId: string, deckId: string, keep: 'device' | 'other') {
  const result = update(
    accountId,
    deckId,
    (current) => {
      if (!current) throw new Error('practice_no_conflict');
      return resolveConflict(current, keep, uuidV7());
    },
    visitGuard(accountId),
  );
  void result.then(() => deliverPractice()).catch(() => undefined);
  return result;
}
export function resolveConflict(
  record: PracticeRecord,
  keep: 'device' | 'other',
  commandId: string,
): PracticeRecord {
  const conflict = record.conflict;
  if (!conflict) throw new Error('practice_no_conflict');
  const { conflict: _resolved, ...rest } = record;
  if (keep === 'other' || !conflict.device || !isPracticeRunConsistent(conflict.device))
    return {
      ...rest,
      archived: { ...conflict, kept: 'other' },
      confirmed: conflict.other,
      device: conflict.other.run,
      pending: [],
    };
  return {
    ...rest,
    archived: { ...conflict, kept: 'device' },
    confirmed: conflict.other,
    device: conflict.device,
    pending: [
      {
        kind: 'replace',
        id: commandId,
        expectedVersion: conflict.other.version,
        runId: conflict.device.id,
        run: conflict.device,
      },
    ],
  };
}

/** For a Deck the server can no longer take Practice for: the commands are archived, not sent. */
export function discardPractice(accountId: string, deckId: string) {
  return update(
    accountId,
    deckId,
    (current) => current && discardHeld(current),
    visitGuard(accountId),
  );
}
export function discardHeld(record: PracticeRecord): PracticeRecord | undefined {
  if (!record.pending.length) return undefined;
  const { failure: _discarded, ...rest } = record;
  return {
    ...rest,
    archived: {
      device: record.device,
      commands: record.pending,
      other: record.confirmed,
      kept: 'other',
    },
    pending: [],
    device: record.confirmed.run,
  };
}
/** Delivery failures that wait for a decision rather than another attempt. */
export const practiceHeld = (record: PracticeRecord) =>
  record.pending.length > 0 &&
  record.failure !== undefined &&
  ['not_found', 'restore_dependency'].includes(record.failure);

const RETRY_DELAYS = [2_000, 5_000, 15_000, 30_000, 60_000];
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryAttempt = 0;
function scheduleRetry() {
  clearTimeout(retryTimer);
  const delay = RETRY_DELAYS[Math.min(retryAttempt, RETRY_DELAYS.length - 1)]!;
  retryAttempt += 1;
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    void deliverPractice();
  }, delay);
}
let delivery: Promise<void> | undefined;
let controller: AbortController | undefined;
let again = false;
export function cancelPracticeDelivery() {
  controller?.abort();
  clearTimeout(retryTimer);
  retryTimer = undefined;
  retryAttempt = 0;
  delivery = undefined;
}

/**
 * Sends every Deck's saved commands, oldest first, one at a time with the same identities. A lost
 * answer is retried as it was; the server answers a command it already applied with its present
 * state. A refusal never discards anything: it is settled into one record for the learner.
 */
export function deliverPractice(): Promise<void> {
  if (delivery) {
    again = true;
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
  // An answer that did arrive is recorded even if the connection dropped right after it.
  const owned = () => visit === accountEpoch() && offlineState().accountId === accountId;
  if (!accountId || !active()) return Promise.resolve();
  const own = new AbortController();
  controller = own;
  const run = (async () => {
    let records: PracticeRecord[];
    try {
      records = await practiceRecords(accountId);
    } catch {
      records = [...volatile.values()].filter((record) => record.accountId === accountId);
    }
    for (const stored of records) {
      let rebased = false;
      let record: PracticeRecord | undefined = stored;
      while (record?.pending[0] && !record.conflict) {
        if (!active()) return;
        const command: PracticeCommand = record.pending[0];
        let refused = false;
        let answer: PracticeConfirmed | undefined;
        try {
          answer = confirmedOf(
            await request(`/decks/${record.deckId}/practice`, {
              method: 'POST',
              body: command,
              signal: own.signal,
            }),
          );
        } catch (error) {
          if (!active()) return;
          if (error instanceof ApiFailure && error.code === 'sync_rejected') refused = true;
          else if (
            error instanceof ApiFailure &&
            [400, 403, 404, 409, 422].includes(error.status)
          ) {
            // The Deck is gone or cannot take Practice now. The commands wait with the reason.
            const code = error.code;
            await update(
              accountId,
              record.deckId,
              (current) => current && { ...current, failure: code },
              owned,
            );
            break;
          } else {
            const code = error instanceof ApiFailure ? error.code : 'interrupted';
            await update(
              accountId,
              record.deckId,
              (current) => current && { ...current, failure: code },
              owned,
            ).catch(() => undefined);
            if (error instanceof ApiFailure && error.status === 401) return;
            scheduleRetry();
            return;
          }
        }
        if (refused) {
          const other = confirmedOf(
            await request(`/decks/${record.deckId}/practice`, { signal: own.signal }),
          );
          const wasRebased = rebased;
          record = await update(
            accountId,
            record.deckId,
            (current) =>
              current?.pending[0]?.id === command.id
                ? settleRefusal(current, other, wasRebased)
                : undefined,
            owned,
          );
          rebased = true;
          continue;
        }
        const acknowledged = answer!;
        record = await update(
          accountId,
          record.deckId,
          (current) => current && acknowledge(current, command.id, acknowledged),
          owned,
        );
        retryAttempt = 0;
      }
    }
  })()
    .catch(() => {
      if (active()) scheduleRetry();
    })
    .finally(() => {
      if (delivery === run) {
        delivery = undefined;
        if (again) {
          again = false;
          void deliverPractice();
        }
      }
    });
  delivery = run;
  return run;
}

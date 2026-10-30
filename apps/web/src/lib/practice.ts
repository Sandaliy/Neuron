import {
  advancePractice,
  practiceCommandSchema,
  practiceResultSchema,
  reconcilePractice,
  uuidV7,
} from '@neuron/shared';
import type { Note, PracticeCommand, PracticeNote, PracticeRun } from '@neuron/shared';

import { request } from './api';
import { hasServerAuthority } from './capabilities';
import { localNotes } from './collection-read';
import { collectionRead } from './collection-transport';
import { offlineState } from './offline';
import {
  adoptPractice,
  deliverPractice,
  emptyPracticeRecord,
  importLegacyPractice,
  isVolatile,
  nextPracticeVersion,
  onPracticeChange,
  readPractice,
  resolvePractice,
  sameProgress,
  savePracticeCommand,
  startVolatile,
} from './practice-outbox';
import * as storage from './storage';

import type { PracticeConfirmed, PracticeRecord } from './practice-outbox';

interface Snapshot {
  undoEpoch: number;
  run: PracticeRun | null;
  loading: boolean;
  /** Commands on this device that the server has not acknowledged yet. */
  saving: boolean;
  /** A tap is being written to this device; the screen advances when it is. */
  committing: boolean;
  /** No server answer yet, and nothing on this device to show instead. */
  awaitingServer: boolean;
  /** Progress lives only in this visit: device storage could not be opened. */
  volatile: boolean;
  conflict: { device: PracticeRun | null; other: PracticeRun | null } | undefined;
  error: unknown;
}
type Action =
  | {
      kind: 'start';
      front: PracticeRun['front'];
      back: PracticeRun['back'];
      response?: PracticeRun['response'];
    }
  | { kind: 'answer'; noteId: string; known: boolean }
  | { kind: 'undo'; previous: PracticeRun }
  | { kind: 'round' };
export type PracticeActOutcome = 'saving' | 'busy' | 'storage';
const stores = new Map<string, ReturnType<typeof createStore>>();
export function practiceQuery(deckId: string) {
  return {
    queryKey: ['practice-summary', deckId],
    queryFn: async ({ signal }: { signal: AbortSignal }) =>
      practiceResultSchema.parse(await request(`/decks/${deckId}/practice`, { signal })),
    staleTime: 15_000,
  };
}

/** Every Note of the Deck in server order, or the downloaded copy when the server is away. */
export async function practicePool(deckId: string, signal: AbortSignal): Promise<Note[]> {
  const local = async () => {
    const notes: Note[] = [];
    let cursor: string | undefined;
    do {
      const page = await localNotes({ deckId, sort: 'created' }, cursor);
      notes.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    return { items: notes, local: true as const };
  };
  const path = (cursor?: string) =>
    `/notes?deckId=${deckId}&limit=1000${cursor ? `&cursor=${cursor}` : ''}`;
  const first = await collectionRead<{ items: Note[]; nextCursor?: string; local?: true }>(
    path(),
    signal,
    local,
  );
  const notes = [...first.items];
  let cursor = first.local ? undefined : first.nextCursor;
  while (cursor) {
    const page = await request<{ items: Note[]; nextCursor?: string }>(path(cursor), { signal });
    notes.push(...page.items);
    cursor = page.nextCursor;
  }
  return notes;
}

export function practiceStore(
  accountId: string,
  deckId: string,
  notes: readonly PracticeNote[],
  initial?: PracticeConfirmed,
) {
  const key = `${accountId}:${deckId}`;
  let store = stores.get(key);
  if (!store) {
    store = createStore(accountId, deckId, notes, initial);
    stores.set(key, store);
  }
  return store;
}
function createStore(
  accountId: string,
  deckId: string,
  notes: readonly PracticeNote[],
  initial?: PracticeConfirmed,
) {
  const legacyKey = `neuron.practice.pending:${accountId}:${deckId}`;
  let record: PracticeRecord | undefined;
  let latest = initial;
  let snapshot: Snapshot = {
    undoEpoch: 0,
    run: null,
    loading: true,
    saving: false,
    committing: false,
    awaitingServer: false,
    volatile: false,
    conflict: undefined,
    error: undefined,
  };
  const listeners = new Set<() => void>();
  const shown = (value: PracticeRecord | undefined) => {
    const run = value?.device ?? value?.confirmed.run ?? null;
    return run ? reconcilePractice(run, notes) : null;
  };
  function publish(update: Partial<Snapshot> = {}) {
    const ready = record !== undefined;
    snapshot = {
      ...snapshot,
      ...update,
      run: shown(record),
      saving: (record?.pending.length ?? 0) > 0,
      awaitingServer: !ready,
      loading: update.loading ?? (snapshot.loading && !ready),
      volatile: isVolatile(accountId, deckId),
      conflict: record?.conflict
        ? { device: record.conflict.device, other: record.conflict.other.run }
        : undefined,
    };
    listeners.forEach((listener) => listener());
  }
  /** History built on a run that changed elsewhere is gone; changes this device made keep it. */
  function adopt(next: PracticeRecord | undefined) {
    const before = shown(record);
    const after = shown(next);
    const elsewhere = record !== undefined && !snapshot.committing && !sameProgress(before, after);
    record = next;
    publish(elsewhere ? { undoEpoch: snapshot.undoEpoch + 1 } : {});
  }
  function deliver() {
    if (!offlineState().offline && offlineState().validated) void deliverPractice();
  }
  let loading: Promise<void> | undefined;
  function load() {
    loading ??= (async () => {
      let stored: PracticeRecord | undefined;
      try {
        stored = await readPractice(accountId, deckId);
      } catch (error) {
        // Without device storage, Practice still works while the server takes each command.
        if (!latest || !hasServerAuthority()) {
          publish({ loading: false, error: new Error('practice_storage', { cause: error }) });
          return;
        }
        startVolatile(emptyPracticeRecord(accountId, deckId, latest));
        stored = await readPractice(accountId, deckId);
      }
      try {
        const legacy = practiceCommandSchema
          .array()
          .safeParse(JSON.parse(storage.read(legacyKey) ?? '[]'));
        if (legacy.success && legacy.data.length) {
          const base = latest ?? stored?.confirmed ?? { run: null, version: 0 };
          let device = base.run ? reconcilePractice(base.run, notes) : null;
          for (const command of legacy.data)
            try {
              device = advancePractice(device, command, notes);
            } catch {
              break;
            }
          stored = await importLegacyPractice(accountId, deckId, legacy.data, base, device);
        }
        storage.remove(legacyKey);
        if (latest) stored = await adoptPractice(accountId, deckId, latest);
      } catch {
        // The stored record stays authoritative; the server read can be adopted later.
      }
      if (!stored && (!hasServerAuthority() || offlineState().offline))
        stored = emptyPracticeRecord(accountId, deckId);
      record = stored;
      publish({ loading: !stored, error: undefined });
      deliver();
    })().finally(() => {
      loading = undefined;
    });
    return loading;
  }
  async function reload() {
    try {
      const next = await readPractice(accountId, deckId);
      if (next) adopt(next);
    } catch (error) {
      publish({ error });
    }
  }
  // Stores live for the page, one per account and Deck, like the records they mirror.
  onPracticeChange((change) => {
    if (change.accountId === accountId && change.deckId === deckId) void reload();
  });
  void load();
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    retry() {
      publish({ error: undefined });
      if (!record) void load();
      else {
        void reload();
        deliver();
      }
    },
    /** New Notes and, when online, the server's state. Neither restarts the screen. */
    refresh(pool: readonly PracticeNote[], server?: PracticeConfirmed) {
      notes = pool;
      if (server && server !== latest) {
        latest = server;
        if (!record) void Promise.resolve(loading).then(() => (record ? undefined : load()));
        else
          void adoptPractice(accountId, deckId, server)
            .then((next) => next && adopt(next))
            .catch(() => undefined);
      }
      publish();
    },
    resolve(keep: 'device' | 'other') {
      if (!record?.conflict || snapshot.committing) return;
      publish({ committing: true });
      void resolvePractice(accountId, deckId, keep)
        .then((next) => {
          // The learner's own choice: Undo history from before it no longer applies.
          record = next;
          publish({ committing: false, undoEpoch: snapshot.undoEpoch + 1 });
        })
        .catch((error: unknown) => publish({ committing: false, error }));
    },
    /**
     * Saves one command on this device, then calls `onCommit` and shows the result in the same
     * task, so the screen never paints a card between the two.
     */
    act(action: Action, onCommit?: () => void): PracticeActOutcome {
      const current = record;
      if (!current || snapshot.committing || snapshot.error || current.conflict) return 'busy';
      if (isVolatile(accountId, deckId) && !hasServerAuthority()) return 'storage';
      const command = {
        ...action,
        id: uuidV7(),
        expectedVersion: nextPracticeVersion(current),
        runId: action.kind === 'start' ? uuidV7() : snapshot.run?.id,
      } as PracticeCommand;
      let next: PracticeRun;
      try {
        next = advancePractice(snapshot.run, command, notes);
      } catch {
        return 'busy';
      }
      publish({ committing: true });
      void savePracticeCommand(
        accountId,
        deckId,
        { version: current.confirmed.version, pending: current.pending.map((entry) => entry.id) },
        command,
        next,
      )
        .then((written) => {
          onCommit?.();
          record = written;
          publish({ committing: false });
          deliver();
        })
        .catch((error: unknown) => {
          if (error instanceof Error && error.message === 'practice_changed') {
            publish({ committing: false });
            void reload();
            return;
          }
          publish({
            committing: false,
            error: new Error('practice_storage', { cause: error }),
          });
        });
      return 'saving';
    },
  };
}

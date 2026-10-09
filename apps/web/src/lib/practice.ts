import {
  advancePractice,
  practiceCommandSchema,
  practiceResultSchema,
  reconcilePractice,
  uuidV7,
} from '@neuron/shared';
import type { PracticeCommand, PracticeNote, PracticeRun } from '@neuron/shared';

import { ApiFailure, request } from './api';
import * as storage from './storage';

interface Snapshot {
  undoEpoch: number;
  run: PracticeRun | null;
  loading: boolean;
  saving: boolean;
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
const stores = new Map<string, ReturnType<typeof createStore>>();
type ConfirmedPractice = { run: PracticeRun | null; version: number };
export function practiceQuery(deckId: string) {
  return {
    queryKey: ['practice-summary', deckId],
    queryFn: async ({ signal }: { signal: AbortSignal }) =>
      practiceResultSchema.parse(await request(`/decks/${deckId}/practice`, { signal })),
    staleTime: 15_000,
  };
}
export function practiceStore(
  accountId: string,
  deckId: string,
  notes: readonly PracticeNote[],
  initial?: ConfirmedPractice,
  onConfirmed?: (value: ConfirmedPractice) => void,
) {
  const key = `neuron.practice.pending:${accountId}:${deckId}`;
  let store = stores.get(key);
  if (!store) {
    store = createStore(key, deckId, notes, initial, onConfirmed);
    stores.set(key, store);
  }
  return store;
}
function createStore(
  key: string,
  deckId: string,
  notes: readonly PracticeNote[],
  initial?: ConfirmedPractice,
  onConfirmed?: (value: ConfirmedPractice) => void,
) {
  let confirmed: ConfirmedPractice = initial ?? { run: null, version: 0 };
  let pending: PracticeCommand[] = [];
  try {
    pending = practiceCommandSchema.array().parse(JSON.parse(storage.read(key) ?? '[]'));
  } catch {
    /* Discard invalid device data. */
  }
  let snapshot: Snapshot = {
    undoEpoch: 0,
    run: null,
    loading: initial === undefined,
    saving: false,
    error: undefined,
  };
  let sending = false;
  let loading = false;
  const listeners = new Set<() => void>();
  function publish(update: Partial<Snapshot> = {}) {
    let run = confirmed.run ? reconcilePractice(confirmed.run, notes) : null;
    for (const command of pending) {
      if (command.expectedVersion < confirmed.version) continue;
      try {
        run = advancePractice(run, command, notes);
      } catch {
        break;
      }
    }
    snapshot = { ...snapshot, ...update, run, saving: pending.length > 0 };
    storage.write(key, JSON.stringify(pending));
    listeners.forEach((listener) => listener());
  }
  async function flush() {
    if (sending || loading || snapshot.loading) return;
    sending = true;
    publish({ error: undefined });
    try {
      while (pending[0]) {
        const command = pending[0];
        confirmed = practiceResultSchema.parse(
          await request(`/decks/${deckId}/practice`, { method: 'POST', body: command }),
        );
        pending = pending.slice(1);
        onConfirmed?.(confirmed);
        publish();
      }
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 409) {
        pending = [];
        snapshot = { ...snapshot, undoEpoch: snapshot.undoEpoch + 1 };
        try {
          confirmed = practiceResultSchema.parse(await request(`/decks/${deckId}/practice`));
          onConfirmed?.(confirmed);
        } catch {
          /* Keep the last confirmed state. */
        }
      }
      publish({ error });
    } finally {
      sending = false;
    }
  }
  async function load() {
    if (loading || sending) return;
    loading = true;
    publish({ loading: confirmed.run === null });
    try {
      const latest = practiceResultSchema.parse(await request(`/decks/${deckId}/practice`));
      if (!pending.length && JSON.stringify(latest.run) !== JSON.stringify(confirmed.run)) {
        snapshot = { ...snapshot, undoEpoch: snapshot.undoEpoch + 1 };
      }
      confirmed = latest;
      onConfirmed?.(confirmed);
      publish({ loading: false, error: undefined });
    } catch (error) {
      publish({ loading: false, error });
    } finally {
      loading = false;
    }
    if (!snapshot.error) void flush();
  }
  // Setup reads the first snapshot before its refresh effect. Publish confirmed
  // fields and replay pending commands before reporting a seeded store as ready.
  if (initial !== undefined) publish();
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    retry: () => (snapshot.run || pending.length ? void flush() : void load()),
    refresh(pool: readonly PracticeNote[], latest?: ConfirmedPractice) {
      notes = pool;
      if (latest && !sending && !loading && latest.version >= confirmed.version) {
        if (!pending.length && JSON.stringify(latest.run) !== JSON.stringify(confirmed.run)) {
          snapshot = { ...snapshot, undoEpoch: snapshot.undoEpoch + 1 };
        }
        confirmed = latest;
        publish({ loading: false, error: undefined });
        void flush();
        return;
      }
      if (snapshot.loading || (!sending && !pending.length)) void load();
    },
    act(action: Action) {
      if (snapshot.loading || snapshot.error) return;
      const version = Math.max(
        confirmed.version,
        ...pending.map((command) => command.expectedVersion + 1),
      );
      const command = {
        ...action,
        id: uuidV7(),
        expectedVersion: version,
        runId: action.kind === 'start' ? uuidV7() : snapshot.run?.id,
      } as PracticeCommand;
      advancePractice(snapshot.run, command, notes);
      pending.push(command);
      publish();
      void flush();
    },
  };
}

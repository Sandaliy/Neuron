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
  | { kind: 'round' };
const stores = new Map<string, ReturnType<typeof createStore>>();
export function practiceStore(accountId: string, deckId: string, notes: readonly PracticeNote[]) {
  const key = `neuron.practice.pending:${accountId}:${deckId}`;
  let store = stores.get(key);
  if (!store) {
    store = createStore(key, deckId, notes);
    stores.set(key, store);
  }
  return store;
}
function createStore(key: string, deckId: string, notes: readonly PracticeNote[]) {
  let confirmed: { run: PracticeRun | null; version: number } = { run: null, version: 0 };
  let pending: PracticeCommand[] = [];
  try {
    pending = practiceCommandSchema.array().parse(JSON.parse(storage.read(key) ?? '[]'));
  } catch {
    /* Discard invalid device data. */
  }
  let snapshot: Snapshot = { run: null, loading: true, saving: false, error: undefined };
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
        publish();
      }
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 409) {
        pending = [];
        try {
          confirmed = practiceResultSchema.parse(await request(`/decks/${deckId}/practice`));
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
      confirmed = practiceResultSchema.parse(await request(`/decks/${deckId}/practice`));
      publish({ loading: false, error: undefined });
    } catch (error) {
      publish({ loading: false, error });
    } finally {
      loading = false;
    }
    if (!snapshot.error) void flush();
  }
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    retry: () => (snapshot.run || pending.length ? void flush() : void load()),
    refresh(pool: readonly PracticeNote[]) {
      notes = pool;
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

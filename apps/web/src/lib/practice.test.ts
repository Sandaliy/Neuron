import { beforeEach, expect, it, vi } from 'vitest';

import { advancePractice, uuidV7 } from '@neuron/shared';
import type { PracticeCommand, PracticeRun } from '@neuron/shared';

import { hasServerAuthority } from './capabilities';
import { offlineState } from './offline';

import type * as Capabilities from './capabilities';
import type * as Offline from './offline';
import type * as Outbox from './practice-outbox';
import type { PracticeRecord } from './practice-outbox';

/** The device database: one record per account and Deck, as the IndexedDB store keeps them. */
const device = vi.hoisted(() => ({
  records: new Map<string, PracticeRecord>(),
  hold: undefined as Promise<void> | undefined,
  failSave: false,
  failOpen: false,
  listeners: new Set<(change: { accountId: string; deckId: string }) => void>(),
}));
vi.mock('./capabilities', async (original) => ({
  ...(await original<typeof Capabilities>()),
  hasServerAuthority: vi.fn(() => true),
}));
vi.mock('./offline', async (original) => ({
  ...(await original<typeof Offline>()),
  offlineState: vi.fn(() => ({ offline: false, validated: true, accountId: null })),
}));
vi.mock('./practice-outbox', async (original) => {
  const real = await original<typeof Outbox>();
  const key = (accountId: string, deckId: string) => `${accountId}:${deckId}`;
  const write = (accountId: string, deckId: string, next: PracticeRecord | undefined) => {
    if (next) {
      device.records.set(key(accountId, deckId), structuredClone(next));
      device.listeners.forEach((listener) => listener({ accountId, deckId }));
    }
    return structuredClone(next ?? device.records.get(key(accountId, deckId)));
  };
  return {
    ...real,
    deliverPractice: vi.fn(async () => undefined),
    onPracticeChange: (listener: (change: { accountId: string; deckId: string }) => void) => {
      device.listeners.add(listener);
      return () => device.listeners.delete(listener);
    },
    readPractice: vi.fn(async (accountId: string, deckId: string) => {
      if (device.failOpen && !real.isVolatile(accountId, deckId))
        throw new Error('collection_open_timeout');
      if (real.isVolatile(accountId, deckId)) return real.readPractice(accountId, deckId);
      return structuredClone(device.records.get(key(accountId, deckId)));
    }),
    savePracticeCommand: vi.fn(
      async (
        accountId: string,
        deckId: string,
        expected: { version: number; pending: readonly string[] },
        command: PracticeCommand,
        run: PracticeRun,
      ) => {
        await device.hold;
        if (real.isVolatile(accountId, deckId)) {
          const kept = await real.readPractice(accountId, deckId);
          const next = real.appendCommand(kept!, expected, command, run);
          real.startVolatile(next);
          return next;
        }
        if (device.failSave) throw new Error('QuotaExceededError');
        const current =
          device.records.get(key(accountId, deckId)) ?? real.emptyPracticeRecord(accountId, deckId);
        return write(accountId, deckId, real.appendCommand(current, expected, command, run));
      },
    ),
    adoptPractice: vi.fn(async (accountId: string, deckId: string, latest) => {
      const current = device.records.get(key(accountId, deckId));
      return write(
        accountId,
        deckId,
        current
          ? real.adoptLatest(current, latest)
          : real.emptyPracticeRecord(accountId, deckId, latest),
      );
    }),
    importLegacyPractice: vi.fn(async () => undefined),
  };
});

const notes = [0, 1, 2].map((n) => ({ id: uuidV7(), fields: { front: `Q${n}`, back: `A${n}` } }));
const load = async () => (await import('./practice')).practiceStore;
beforeEach(() => {
  device.records.clear();
  device.hold = undefined;
  device.failSave = false;
  device.failOpen = false;
  vi.mocked(hasServerAuthority).mockReturnValue(true);
  vi.mocked(offlineState).mockReturnValue({
    offline: false,
    validated: true,
  } as ReturnType<typeof offlineState>);
});
const ready = async (store: { getSnapshot: () => { loading: boolean } }) =>
  vi.waitFor(() => expect(store.getSnapshot().loading).toBe(false));

it('advances only after the step is saved on the device, with onCommit in the same task', async () => {
  const practiceStore = await load();
  const store = practiceStore(uuidV7(), uuidV7(), notes, { run: null, version: 0 });
  await ready(store);
  let release!: () => void;
  device.hold = new Promise((resolve) => {
    release = resolve;
  });
  const order: string[] = [];
  store.subscribe(() => order.push(store.getSnapshot().run ? 'run' : 'none'));
  expect(
    store.act({ kind: 'start', front: 'front', back: 'back' }, () => order.push('commit')),
  ).toBe('saving');
  expect(store.getSnapshot().run).toBeNull();
  expect(store.getSnapshot().committing).toBe(true);
  // A second tap while the first is being written is not a second step.
  expect(store.act({ kind: 'round' })).toBe('busy');
  release();
  await vi.waitFor(() => expect(store.getSnapshot().run).not.toBeNull());
  expect(order.slice(-2)).toEqual(['commit', 'run']);
  expect(store.getSnapshot().saving).toBe(true);
});

it('keeps the card and says so when the device cannot save a step', async () => {
  const practiceStore = await load();
  const store = practiceStore(uuidV7(), uuidV7(), notes, { run: null, version: 0 });
  await ready(store);
  device.failSave = true;
  const onCommit = vi.fn();
  store.act({ kind: 'start', front: 'front', back: 'back' }, onCommit);
  await vi.waitFor(() => expect(store.getSnapshot().error).toBeTruthy());
  expect((store.getSnapshot().error as Error).message).toBe('practice_storage');
  expect(onCommit).not.toHaveBeenCalled();
  expect(store.getSnapshot().run).toBeNull();
  device.failSave = false;
  store.retry();
  expect(store.getSnapshot().error).toBeUndefined();
  expect(store.act({ kind: 'start', front: 'front', back: 'back' })).toBe('saving');
});

it('starts offline from nothing, and a restarted app resumes the saved position', async () => {
  vi.mocked(offlineState).mockReturnValue({
    offline: true,
    validated: false,
  } as ReturnType<typeof offlineState>);
  vi.mocked(hasServerAuthority).mockReturnValue(false);
  const accountId = uuidV7();
  const deckId = uuidV7();
  let store = (await load())(accountId, deckId, notes);
  await ready(store);
  expect(store.getSnapshot().awaitingServer).toBe(false);
  store.act({ kind: 'start', front: 'front', back: 'back' });
  await vi.waitFor(() => expect(store.getSnapshot().run).not.toBeNull());
  const first = store.getSnapshot().run!;
  store.act({ kind: 'answer', noteId: first.queue[0]!, known: true });
  await vi.waitFor(() => expect(store.getSnapshot().run!.queue).toHaveLength(2));
  const saved = store.getSnapshot().run;
  vi.resetModules();
  store = (await load())(accountId, deckId, notes);
  await ready(store);
  expect(store.getSnapshot().run).toEqual(saved);
  expect(store.getSnapshot().saving).toBe(true);
});

it('waits for the server only when the device has nothing to show', async () => {
  const store = (await load())(uuidV7(), uuidV7(), notes);
  await vi.waitFor(() => expect(store.getSnapshot().awaitingServer).toBe(true));
  expect(store.getSnapshot().loading).toBe(true);
  const run = advancePractice(
    null,
    {
      kind: 'start',
      id: uuidV7(),
      runId: uuidV7(),
      expectedVersion: 0,
      front: 'front',
      back: 'back',
    },
    notes,
  );
  store.refresh(notes, { run, version: 1 });
  await ready(store);
  expect(store.getSnapshot().run).toEqual(run);
});

it('keeps Undo through an acknowledgement and drops it when another device’s run arrives', async () => {
  const accountId = uuidV7();
  const deckId = uuidV7();
  const store = (await load())(accountId, deckId, notes, { run: null, version: 0 });
  await ready(store);
  store.act({ kind: 'start', front: 'front', back: 'back' });
  await vi.waitFor(() => expect(store.getSnapshot().run).not.toBeNull());
  const epoch = store.getSnapshot().undoEpoch;
  const outbox = await import('./practice-outbox');
  const key = `${accountId}:${deckId}`;
  const record = device.records.get(key)!;
  // The server took the start: the record settles with the same run.
  device.records.set(
    key,
    outbox.acknowledge(record, record.pending[0]!.id, { run: record.device, version: 1 })!,
  );
  device.listeners.forEach((listener) => listener({ accountId, deckId }));
  await vi.waitFor(() => expect(store.getSnapshot().saving).toBe(false));
  expect(store.getSnapshot().undoEpoch).toBe(epoch);
  const elsewhere = advancePractice(
    record.device,
    {
      kind: 'answer',
      id: uuidV7(),
      runId: record.device!.id,
      expectedVersion: 1,
      noteId: record.device!.queue[0]!,
      known: false,
    },
    notes,
  );
  store.refresh(notes, { run: elsewhere, version: 2 });
  await vi.waitFor(() => expect(store.getSnapshot().run).toEqual(elsewhere));
  expect(store.getSnapshot().undoEpoch).toBe(epoch + 1);
});

it('keeps Practice usable online without device storage, and refuses steps once offline', async () => {
  device.failOpen = true;
  const accountId = uuidV7();
  // An earlier test restarted the modules; the live ones decide authority here.
  const live = await import('./offline');
  const authority = await import('./capabilities');
  vi.mocked(authority.hasServerAuthority).mockReturnValue(true);
  vi.mocked(live.offlineState).mockReturnValue({
    offline: false,
    validated: true,
    accountId,
    signedOut: false,
  } as ReturnType<typeof offlineState>);
  const store = (await load())(accountId, uuidV7(), notes, { run: null, version: 0 });
  await ready(store);
  expect(store.getSnapshot().volatile).toBe(true);
  expect(store.act({ kind: 'start', front: 'front', back: 'back' })).toBe('saving');
  await vi.waitFor(() => expect(store.getSnapshot().run).not.toBeNull());
  vi.mocked(authority.hasServerAuthority).mockReturnValue(false);
  const run = store.getSnapshot().run!;
  expect(store.act({ kind: 'answer', noteId: run.queue[0]!, known: true })).toBe('storage');
});

import { expect, it, vi } from 'vitest';

import { advancePractice, uuidV7 } from '@neuron/shared';
import type { PracticeCommand, PracticeRun } from '@neuron/shared';

import { request } from './api';
import { practiceStore } from './practice';

import type * as Api from './api';

vi.mock('./api', async (original) => ({
  ...(await original<typeof Api>()),
  request: vi.fn(),
}));

it('exposes a confirmed recipe in the first ready snapshot before setup refreshes', () => {
  vi.mocked(request).mockReset();
  const notes = [{ id: uuidV7(), fields: { term: 'Baum', translation: 'tree' } }];
  const run = advancePractice(
    null,
    {
      kind: 'start',
      id: uuidV7(),
      runId: uuidV7(),
      expectedVersion: 0,
      front: 'translation',
      back: 'term',
      response: 'typing',
    },
    notes,
  );
  const store = practiceStore(uuidV7(), uuidV7(), notes, { run, version: 1 });
  expect(store.getSnapshot().loading).toBe(false);
  expect(store.getSnapshot().run).toEqual(run);
  expect(request).not.toHaveBeenCalled();
});

it('reuses a confirmed entry without duplicate reads and publishes only acknowledged cache state', async () => {
  vi.mocked(request).mockReset();
  const notes = [{ id: uuidV7(), fields: { front: 'Q', back: 'A' } }];
  const initial = { run: null, version: 0 };
  const publish = vi.fn();
  const store = practiceStore(uuidV7(), uuidV7(), notes, initial, publish);
  store.refresh(notes, initial);
  expect(store.getSnapshot().loading).toBe(false);
  expect(request).not.toHaveBeenCalled();
  let release!: () => void;
  vi.mocked(request).mockImplementation(async (_path, options) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return {
      run: advancePractice(null, options!.body as PracticeCommand, notes),
      version: 1,
    } as never;
  });
  store.act({ kind: 'start', front: 'front', back: 'back' });
  expect(store.getSnapshot().run).not.toBeNull();
  expect(publish).not.toHaveBeenCalled();
  release();
  await vi.waitFor(() => expect(store.getSnapshot().saving).toBe(false));
  expect(publish).toHaveBeenCalledTimes(1);
  const confirmed = publish.mock.calls[0]![0];
  store.refresh(notes, confirmed);
  expect(request).toHaveBeenCalledTimes(1);
});

it('serializes optimistic answers and repeated Undo with stable retry IDs after a lost commit response', async () => {
  const notes = [0, 1, 2].map(() => ({ id: uuidV7(), fields: { front: 'Q', back: 'A' } }));
  let run: PracticeRun | null = null;
  let version = 0;
  let lastId: string | undefined;
  let failUndo = true;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const seen: PracticeCommand[] = [];
  vi.mocked(request).mockImplementation(async (_path, options) => {
    const command = options?.body as PracticeCommand | undefined;
    if (command) {
      seen.push(command);
      if (command.kind === 'answer' && seen.filter((item) => item.kind === 'answer').length === 1)
        await held;
      if (command.id !== lastId) {
        expect(command.expectedVersion).toBe(version);
        run = advancePractice(run, command, notes);
        version++;
        lastId = command.id;
      }
      if (command.kind === 'undo' && failUndo) {
        failUndo = false;
        throw new Error('Response lost after commit');
      }
    }
    return { run, version } as never;
  });
  const store = practiceStore(uuidV7(), uuidV7(), notes);
  store.refresh(notes);
  await vi.waitFor(() => expect(store.getSnapshot().loading).toBe(false));
  store.act({ kind: 'start', front: 'front', back: 'back' });
  await vi.waitFor(() => expect(store.getSnapshot().saving).toBe(false));
  const history: PracticeRun[] = [];
  for (const note of notes) {
    history.push(store.getSnapshot().run!);
    store.act({ kind: 'answer', noteId: note.id, known: true });
  }
  expect(store.getSnapshot().run!.queue).toEqual([]);
  for (const previous of [...history].reverse()) store.act({ kind: 'undo', previous });
  expect(store.getSnapshot().run).toEqual(history[0]);
  release();
  await vi.waitFor(() => expect(store.getSnapshot().error).toBeTruthy());
  expect(store.getSnapshot().run).toEqual(history[0]);
  store.retry();
  await vi.waitFor(() => expect(store.getSnapshot().saving).toBe(false));
  expect(run).toEqual(history[0]);
  const undos = seen.filter((command) => command.kind === 'undo');
  expect(undos).toHaveLength(4);
  expect(undos[0]).toEqual(undos[1]);
});

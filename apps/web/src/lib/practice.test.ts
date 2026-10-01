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

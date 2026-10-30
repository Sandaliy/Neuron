import { describe, expect, it } from 'vitest';

import { advancePractice, uuidV7 } from '@neuron/shared';
import type { PracticeCommand, PracticeRun } from '@neuron/shared';

import {
  acknowledge,
  adoptLatest,
  appendCommand,
  discardHeld,
  emptyPracticeRecord,
  practiceHeld,
  resolveConflict,
  sameProgress,
  settleRefusal,
  validatePracticeRecord,
} from './practice-outbox';

import type { PracticeRecord } from './practice-outbox';

const account = uuidV7();
const deck = uuidV7();
const notes = [0, 1, 2].map((n) => ({ id: uuidV7(), fields: { front: `Q${n}`, back: `A${n}` } }));
const startCommand = (expectedVersion = 0): PracticeCommand => ({
  kind: 'start',
  id: uuidV7(),
  expectedVersion,
  runId: uuidV7(),
  front: 'front',
  back: 'back',
});
const answer = (run: PracticeRun, expectedVersion: number, known = true): PracticeCommand => ({
  kind: 'answer',
  id: uuidV7(),
  expectedVersion,
  runId: run.id,
  noteId: run.queue[0]!,
  known,
});
/** A record as the screen builds it: every command saved on top of the last one. */
function practiced(base: PracticeRecord, ...steps: ((run: PracticeRun) => PracticeCommand)[]) {
  let record = base;
  for (const step of steps) {
    const run = record.device!;
    const command = step(run);
    record = appendCommand(
      record,
      { version: record.confirmed.version, pending: record.pending.map((entry) => entry.id) },
      command,
      advancePractice(run, command, notes),
    );
  }
  return record;
}
const start = advancePractice(null, startCommand(), notes);
const base = emptyPracticeRecord(account, deck, { run: start, version: 1 });

describe('Practice saved on this device', () => {
  it('accepts only consistent records of the signed-in account', () => {
    const record = practiced(
      base,
      (run) => answer(run, 1),
      (run) => answer(run, 2),
    );
    expect(validatePracticeRecord(structuredClone(record), account)).toEqual(record);
    expect(() => validatePracticeRecord(record, uuidV7())).toThrow('practice_invalid_record');
    const broken = { ...record, pending: [record.pending[1], record.pending[0]] };
    expect(() => validatePracticeRecord(broken, account)).toThrow('practice_invalid_record');
    const ahead = { ...record, confirmed: { ...record.confirmed, version: 0 } };
    expect(() => validatePracticeRecord(ahead, account)).toThrow('practice_invalid_record');
  });

  it('refuses a command built on a record another tab has changed', () => {
    const record = practiced(base, (run) => answer(run, 1));
    const command = answer(record.device!, 2);
    expect(() =>
      appendCommand(record, { version: 1, pending: [] }, command, record.device!),
    ).toThrow('practice_changed');
  });

  it('keeps commands that follow an acknowledgement carrying another device’s work', () => {
    const record = practiced(
      base,
      (run) => answer(run, 1),
      (run) => answer(run, 2),
    );
    const later = { run: record.device, version: 5 };
    const acknowledged = acknowledge(record, record.pending[0]!.id, later)!;
    expect(acknowledged.pending).toEqual(record.pending.slice(1));
    expect(acknowledged.device).toEqual(record.device);
    expect(validatePracticeRecord(acknowledged, account)).toEqual(acknowledged);
    expect(acknowledge(acknowledged, record.pending[0]!.id, later)).toBeUndefined();
    const done = acknowledge(acknowledged, record.pending[1]!.id, { run: start, version: 6 })!;
    expect(done.pending).toEqual([]);
    expect(done.device).toEqual(start);
  });

  it('never replaces a base that commands on this device build on', () => {
    const record = practiced(base, (run) => answer(run, 1));
    expect(adoptLatest(record, { run: null, version: 9 })).toBeUndefined();
    expect(adoptLatest(base, { run: start, version: 0 })).toBeUndefined();
    expect(adoptLatest(base, { run: null, version: 2 })).toMatchObject({
      confirmed: { run: null, version: 2 },
      device: null,
    });
  });
});

describe('a refused delivery', () => {
  it('continues the other run silently when this device has nothing of its own', () => {
    const undone = practiced(
      base,
      (run) => answer(run, 1),
      () => ({ kind: 'undo', id: uuidV7(), expectedVersion: 2, runId: start.id, previous: start }),
    );
    const other = { run: advancePractice(start, answer(start, 1, false), notes), version: 2 };
    expect(settleRefusal(undone, other, false)).toEqual({
      ...undone,
      confirmed: other,
      pending: [],
      device: other.run,
    });
  });

  it('continues silently when both devices did the same', () => {
    const record = practiced(base, (run) => answer(run, 1));
    const other = { run: record.device, version: 2 };
    expect(settleRefusal(record, other, false).conflict).toBeUndefined();
    expect(settleRefusal(record, other, false).pending).toEqual([]);
  });

  it('sends this device’s commands again, renumbered, when the other side made no progress', () => {
    const record = practiced(
      base,
      (run) => answer(run, 1),
      (run) => answer(run, 2),
    );
    const other = { run: start, version: 3 };
    const rebased = settleRefusal(record, other, false);
    expect(rebased.conflict).toBeUndefined();
    expect(rebased.confirmed).toEqual(other);
    expect(rebased.device).toEqual(record.device);
    expect(rebased.pending.map((command) => command.expectedVersion)).toEqual([3, 4]);
    expect(rebased.pending.map((command) => command.id)).not.toEqual(
      record.pending.map((command) => command.id),
    );
    expect(validatePracticeRecord(rebased, account)).toEqual(rebased);
    // Refused again after that: the learner decides.
    expect(settleRefusal(rebased, { run: start, version: 4 }, true).conflict).toBeDefined();
  });

  it('keeps both runs and every refused command when the devices diverged', () => {
    const record = practiced(base, (run) => answer(run, 1, true));
    const other = { run: advancePractice(start, answer(start, 1, false), notes), version: 2 };
    const settled = settleRefusal(record, other, false);
    expect(settled.pending).toEqual([]);
    expect(settled.confirmed).toEqual(record.confirmed);
    expect(settled.conflict).toEqual({
      device: record.device,
      commands: record.pending,
      other,
    });
    expect(validatePracticeRecord(structuredClone(settled), account)).toEqual(settled);
  });

  it('asks when this device started a run while the other continued its own', () => {
    const fresh = emptyPracticeRecord(account, deck);
    const record = practiced(fresh, () => startCommand(0));
    const settled = settleRefusal(record, { run: start, version: 4 }, false);
    expect(settled.conflict?.device?.id).not.toBe(start.id);
    expect(settled.conflict?.other.run).toEqual(start);
  });
});

describe('the learner’s choice', () => {
  const diverged = settleRefusal(
    practiced(base, (run) => answer(run, 1, true)),
    { run: advancePractice(start, answer(start, 1, false), notes), version: 2 },
    false,
  );
  it('sends this device’s run as one replacement on top of the other version', () => {
    const id = uuidV7();
    const kept = resolveConflict(diverged, 'device', id);
    expect(kept.conflict).toBeUndefined();
    expect(kept.pending).toEqual([
      {
        kind: 'replace',
        id,
        expectedVersion: 2,
        runId: diverged.conflict!.device!.id,
        run: diverged.conflict!.device,
      },
    ]);
    expect(kept.device).toEqual(diverged.conflict!.device);
    expect(kept.archived).toEqual({ ...diverged.conflict, kept: 'device' });
    expect(validatePracticeRecord(structuredClone(kept), account)).toEqual(kept);
  });
  it('adopts the other run and archives this device’s', () => {
    const kept = resolveConflict(diverged, 'other', uuidV7());
    expect(kept.pending).toEqual([]);
    expect(kept.device).toEqual(diverged.conflict!.other.run);
    expect(kept.archived).toEqual({ ...diverged.conflict, kept: 'other' });
  });
  it('archives saved Practice for a Deck that is gone, only on request', () => {
    const record = { ...practiced(base, (run) => answer(run, 1)), failure: 'not_found' };
    expect(practiceHeld(record)).toBe(true);
    expect(practiceHeld({ ...record, failure: 'network_unreachable' })).toBe(false);
    const discarded = discardHeld(record)!;
    expect(discarded.pending).toEqual([]);
    expect(discarded.archived?.commands).toEqual(record.pending);
    expect(practiceHeld(discarded)).toBe(false);
  });
});

describe('comparing progress', () => {
  it('ignores Notes only one side still holds', () => {
    const run = advancePractice(start, answer(start, 1), notes);
    const extra = uuidV7();
    expect(
      sameProgress(run, {
        ...run,
        statuses: { ...run.statuses, [extra]: 'unseen' },
        queue: [...run.queue, extra],
      }),
    ).toBe(true);
    expect(sameProgress(run, start)).toBe(false);
    expect(sameProgress(run, { ...run, round: 2 })).toBe(false);
    expect(sameProgress(null, null)).toBe(true);
    expect(sameProgress(run, null)).toBe(false);
  });
});

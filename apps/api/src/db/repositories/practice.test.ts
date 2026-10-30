import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { uuidV7 } from '@neuron/shared';
import type { PracticeCommand, PracticeRun } from '@neuron/shared';

import {
  asUser,
  createUser,
  rawAppPool,
  repositoriesFor,
  testDatabase,
} from '../testing/database.js';

import { PracticeConflict } from './practice.js';

import type { Repositories } from './index.js';
import type { Pool } from '@neondatabase/serverless';

const database = testDatabase();
const OWNER = 'offline-practice';
const STRANGER = 'offline-practice-other';

/** Two devices of one account share repositories; only what each one last saw differs. */
describe.skipIf(!database)('Practice delivered from a device that was away', () => {
  let repo: Repositories;
  let other: Repositories;
  let app: Pool;
  beforeAll(async () => {
    await createUser(database!, OWNER);
    await createUser(database!, STRANGER);
    repo = repositoriesFor(database!, OWNER);
    other = repositoriesFor(database!, STRANGER);
    app = rawAppPool(database!);
  });
  afterAll(async () => {
    await app.end();
  });
  async function deck(count = 3) {
    const created = await repo.decks.create({ name: uuidV7(), kind: 'deck' });
    const notes = [];
    for (let index = 0; index < count; index++)
      notes.push(
        await repo.notes.create({
          deckId: created.id,
          noteType: 'basic',
          fields: { front: `Q${index}`, back: `A${index}` },
        }),
      );
    return { deck: created, notes };
  }
  const start = (expectedVersion = 0): PracticeCommand => ({
    kind: 'start',
    id: uuidV7(),
    expectedVersion,
    runId: uuidV7(),
    front: 'front',
    back: 'back',
  });
  const answer = (
    run: PracticeRun,
    expectedVersion: number,
    noteId = run.queue[0]!,
    known = true,
  ): Extract<PracticeCommand, { kind: 'answer' }> => ({
    kind: 'answer',
    id: uuidV7(),
    expectedVersion,
    runId: run.id,
    noteId,
    known,
  });

  it('answers an exact retry with present state after another device wrote', async () => {
    const { deck: practiced } = await deck();
    const started = await repo.practice.apply(practiced.id, start());
    const first = answer(started.run!, 1);
    const applied = await repo.practice.apply(practiced.id, first);
    const later = await repo.practice.apply(practiced.id, answer(applied.run!, 2));
    expect(await repo.practice.apply(practiced.id, first)).toEqual(later);
    await expect(
      repo.practice.apply(practiced.id, { ...first, known: false }),
    ).rejects.toBeInstanceOf(PracticeConflict);
    expect((await repo.practice.get(practiced.id)).version).toBe(3);
  });

  it('applies several commands saved while away, even after Notes changed elsewhere', async () => {
    const { deck: practiced, notes } = await deck();
    const started = await repo.practice.apply(practiced.id, start());
    // Another device adds a Note and opens Practice. Reading never changes the version.
    const added = await repo.notes.create({
      deckId: practiced.id,
      noteType: 'basic',
      fields: { front: 'New', back: 'Answer' },
    });
    const read = await repo.practice.get(practiced.id);
    expect(read.version).toBe(1);
    expect(read.run!.queue).toEqual([...notes.map((note) => note.id), added.id]);
    let run = started.run!;
    let version = 1;
    for (const note of notes) {
      const result = await repo.practice.apply(practiced.id, answer(run, version, note.id));
      run = result.run!;
      version = result.version;
    }
    const refused = await repo.practice
      .apply(practiced.id, {
        kind: 'undo',
        id: uuidV7(),
        expectedVersion: version,
        runId: run.id,
        previous: started.run!,
      })
      .catch((error: unknown) => error);
    // Undo reverses only the latest classification; an older target is refused.
    expect(refused).toBeInstanceOf(PracticeConflict);
    expect(run.queue).toEqual([added.id]);
    expect(Object.values(run.statuses).filter((status) => status === 'known')).toHaveLength(3);
  });

  it('skips a classification of a Note deleted on another device and continues', async () => {
    const { deck: practiced, notes } = await deck();
    const started = await repo.practice.apply(practiced.id, start());
    await repo.notes.softDelete(notes[0]!.id);
    const skipped = await repo.practice.apply(practiced.id, answer(started.run!, 1, notes[0]!.id));
    expect(skipped.version).toBe(2);
    expect(skipped.run!.statuses[notes[0]!.id]).toBeUndefined();
    const next = await repo.practice.apply(
      practiced.id,
      answer(started.run!, 2, notes[1]!.id, false),
    );
    expect(next.run!.statuses[notes[1]!.id]).toBe('learning');
    expect(next.run!.queue).toEqual([notes[2]!.id]);
  });

  it('refuses incompatible progress, then keeps the chosen run and the replaced one', async () => {
    const { deck: practiced } = await deck();
    const started = await repo.practice.apply(practiced.id, start());
    // This device answers while away; the other device answers online first.
    const away = answer(started.run!, 1, started.run!.queue[0], false);
    const elsewhere = await repo.practice.apply(practiced.id, answer(started.run!, 1));
    await expect(repo.practice.apply(practiced.id, away)).rejects.toBeInstanceOf(PracticeConflict);
    const local: PracticeRun = {
      ...started.run!,
      statuses: { ...started.run!.statuses, [started.run!.queue[0]!]: 'learning' },
      queue: started.run!.queue.slice(1),
    };
    const stale = {
      kind: 'replace' as const,
      id: uuidV7(),
      expectedVersion: 1,
      runId: local.id,
      run: local,
    };
    await expect(repo.practice.apply(practiced.id, stale)).rejects.toBeInstanceOf(PracticeConflict);
    const replace = { ...stale, id: uuidV7(), expectedVersion: elsewhere.version };
    const kept = await repo.practice.apply(practiced.id, replace);
    expect(kept).toEqual({ run: local, version: 3 });
    expect(await repo.practice.apply(practiced.id, replace)).toEqual(kept);
    const losing = await asUser(app, OWNER, async (connection) => {
      const rows = await connection.query<{ losing: { run: PracticeRun; version: number } }>(
        `select losing from sync_conflicts where entity = 'practiceRuns' and losing->>'deckId' = $1`,
        [practiced.id],
      );
      return rows.rows.map((row) => row.losing);
    });
    expect(losing).toEqual([{ deckId: practiced.id, version: 2, run: elsewhere.run }]);
    const hidden = await asUser(app, STRANGER, (connection) =>
      connection.query(`select 1 from sync_conflicts where entity = 'practiceRuns'`),
    );
    expect(hidden.rowCount).toBe(0);
  });

  it('refuses a replacement that breaks the run shape', async () => {
    const { deck: practiced } = await deck();
    const started = await repo.practice.apply(practiced.id, start());
    const broken = { ...started.run!, queue: [...started.run!.queue, started.run!.queue[0]!] };
    await expect(
      repo.practice.apply(practiced.id, {
        kind: 'replace',
        id: uuidV7(),
        expectedVersion: 1,
        runId: broken.id,
        run: broken,
      }),
    ).rejects.toBeInstanceOf(PracticeConflict);
  });

  it('lists only live Decks of the signed-in account', async () => {
    const kept = await deck(1);
    const removed = await deck(1);
    const keptRun = await repo.practice.apply(kept.deck.id, start());
    await repo.practice.apply(removed.deck.id, start());
    await repo.decks.softDelete(removed.deck.id);
    const listed = await repo.practice.list();
    expect(listed.runs).toContainEqual({ deckId: kept.deck.id, run: keptRun.run, version: 1 });
    expect(listed.runs.some((entry) => entry.deckId === removed.deck.id)).toBe(false);
    expect((await other.practice.list()).runs).toEqual([]);
    await expect(other.practice.apply(kept.deck.id, start(1))).rejects.toThrow();
    const rows = await asUser(app, STRANGER, (connection) =>
      connection.query(`select 1 from practice_runs where deck_id = $1`, [kept.deck.id]),
    );
    expect(rows.rowCount).toBe(0);
  });
});

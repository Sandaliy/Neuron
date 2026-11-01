import { beforeAll, describe, expect, it } from 'vitest';

import { WAVE_SIZE } from '@neuron/shared';
import type { DailyStudySession } from '@neuron/shared';

import { createUser, repositoriesFor, testDatabase } from '../db/testing/database.js';
import { json, testServer } from '../testing/server.js';

import type { Repositories } from '../db/repositories/index.js';
import type { Hono } from 'hono';

const database = testDatabase();
const OWNER = 'learning-waves-owner';

/**
 * Waves through the real route, user binding and row level security: the
 * server reads Unsure marks itself, and the plan orders new material by them
 * without letting in more of it or writing anything.
 */
describe.skipIf(!database)('learning waves in the Daily Study plan', () => {
  let repositories: Repositories;
  let server: Hono;
  let deckId: string;
  const notes: string[] = [];

  beforeAll(async () => {
    if (!database) return;
    await createUser(database, OWNER, {
      timezone: 'UTC',
      settings: { budgetMinutes: [20, 20, 20, 20, 20, 20, 20] },
    });
    repositories = repositoriesFor(database, OWNER);
    server = testServer(database, OWNER);
    deckId = (await repositories.decks.create({ name: 'Frequency list' })).id;
    const due = new Date('2026-01-01T00:00:00.000Z');
    for (let index = 0; index < 60; index += 1) {
      const note = await repositories.notes.create({
        deckId,
        noteType: 'basic',
        fields: { front: `word ${index}`, back: `meaning ${index}` },
      });
      await repositories.cards.create({
        noteId: note.id,
        direction: 'recognition',
        due: new Date(due.getTime() + index),
      });
      notes.push(note.id);
    }
  });

  const build = async () =>
    json<DailyStudySession>(
      await server.request('/api/study/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
      200,
    );
  const started = (plan: DailyStudySession) =>
    plan.cards.filter((card) => card.state === 'new').map((card) => card.noteId);

  it('lets the Unsure Notes of the current wave in first, and no more new material than before', async () => {
    const before = await build();
    expect(before.newCount).toBeGreaterThan(0);
    expect(before.newCount).toBeLessThan(WAVE_SIZE);
    expect(before.waves).toEqual([
      {
        deckId,
        number: 1,
        count: 2,
        size: 50,
        started: 0,
        waiting: 50,
        unsure: 0,
        later: 10,
        today: before.newCount,
      },
    ]);
    expect(started(before)).toEqual(notes.slice(0, before.newCount));
    const cardsBefore = await repositories.cards.forSession({ deckIds: [deckId] });

    // One Unsure in the first wave, one in the second.
    await repositories.triage.decide([
      { id: notes[40]!, choice: 'unsure' },
      { id: notes[55]!, choice: 'unsure' },
    ]);
    const after = await build();

    expect(after.newCount).toBe(before.newCount);
    expect(after.newCards.allowed).toBe(before.newCards.allowed);
    expect(started(after)[0]).toBe(notes[40]);
    expect(started(after)).not.toContain(notes[55]);
    expect(started(after).slice(1)).toEqual(notes.slice(0, before.newCount - 1));
    expect(after.waves[0]).toMatchObject({ number: 1, waiting: 50, unsure: 1, later: 10 });
    // A plan is a read: no Card moved and no Review was written.
    expect(await repositories.cards.forSession({ deckIds: [deckId] })).toEqual(cardsBefore);
    expect(await repositories.reviews.countForCards(cardsBefore.map((card) => card.id))).toBe(0);
  });

  it('takes Known Notes out of every wave and returns them to their place', async () => {
    await repositories.triage.decide([{ id: notes[0]!, choice: 'known' }]);
    const known = await build();
    expect(known.waves[0]).toMatchObject({ count: 2, size: 50, waiting: 50, later: 9 });
    expect(started(known)).not.toContain(notes[0]);

    await repositories.triage.decide([{ id: notes[0]!, choice: 'unsorted' }]);
    const back = await build();
    expect(back.waves[0]).toMatchObject({ size: 50, later: 10 });
    expect(started(back)).toContain(notes[0]);
  });

  it('never reads another account’s marks', async () => {
    const STRANGER = 'learning-waves-stranger';
    await createUser(database!, STRANGER, { timezone: 'UTC' });
    const theirs = repositoriesFor(database!, STRANGER);
    expect(await theirs.notes.unsureIn([deckId])).toEqual([]);
    expect((await repositories.notes.unsureIn([deckId])).sort()).toEqual(
      [notes[40], notes[55]].sort(),
    );
  });
});

import { beforeAll, describe, expect, it } from 'vitest';

import { dailyStudySessionSchema, uuidV7 } from '@neuron/shared';
import type { DailyStudySession } from '@neuron/shared';

import { createUser, repositoriesFor, testDatabase } from '../db/testing/database.js';
import { json, testServer } from '../testing/server.js';

import type { Repositories } from '../db/repositories/index.js';
import type { Hono } from 'hono';

const database = testDatabase();
const OWNER = 'daily-study-owner';

describe.skipIf(!database)('POST /study/session', () => {
  let repositories: Repositories;
  let server: Hono;
  let deckId: string;

  beforeAll(async () => {
    if (!database) return;

    await createUser(database, OWNER, {
      timezone: 'UTC',
      settings: { budgetMinutes: [20, 20, 20, 20, 20, 20, 20] },
    });
    repositories = repositoriesFor(database, OWNER);
    server = testServer(database, OWNER);

    const deck = await repositories.decks.create({ name: 'Daily Study' });
    deckId = deck.id;
    const due = new Date('2026-01-01T00:00:00.000Z');

    for (let index = 0; index < 12; index += 1) {
      const note = await repositories.notes.create({
        deckId,
        noteType: 'basic',
        fields: { front: `front ${index}`, back: `back ${index}` },
      });
      await repositories.cards.create({
        noteId: note.id,
        direction: 'recognition',
        due: new Date(due.getTime() + index),
      });
    }
  });

  async function build(body: Record<string, unknown>, expected = 200) {
    return json<DailyStudySession>(
      await server.request('/api/study/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      expected,
    );
  }

  it('builds a deterministic one-off plan without changing normal minutes', async () => {
    const before = await repositories.account.read();
    const first = await build({ deckId, minutes: 1, newCards: 'override' });
    const second = await build({ deckId, minutes: 1, newCards: 'override' });
    const after = await repositories.account.read();

    expect(first.budgetMinutes).toBe(1);
    expect(first.newCards).toMatchObject({ mode: 'override', admitted: first.newCount });
    expect(first.cards.map((card) => card.id)).toEqual(second.cards.map((card) => card.id));
    expect(() => dailyStudySessionSchema.parse(first)).not.toThrow();
    expect(after.settings).toEqual(before.settings);
    expect(after.currentRev).toBe(before.currentRev);
  });

  it.each(['production', 'listening'] as const)(
    'plans existing %s cards without changing identity or schedule',
    async (direction) => {
      const deck = await repositories.decks.create({ name: direction });
      const note = await repositories.notes.create({
        deckId: deck.id,
        noteType: 'vocab',
        fields: { term: 'Sorgfalt', translation: 'care' },
      });
      const card = await repositories.cards.create({
        noteId: note.id,
        direction,
        due: new Date('2026-01-01T00:00:00Z'),
      });
      const before = await repositories.account.read();
      const result = await build({ deckId: deck.id, direction, newCards: 'override' });
      expect(result.cards.map((item) => item.id)).toEqual([card.id]);
      expect(result.notes[0]?.id).toBe(note.id);
      expect((await repositories.account.read()).currentRev).toBe(before.currentRev);
      expect(await repositories.cards.byId(card.id)).toEqual(card);
    },
  );

  it('rejects a non-positive explicit session length', async () => {
    await build({ deckId, minutes: 0 }, 400);
  });

  it('plans default and temporary scopes before counts, time, admission and cards without changing schedules', async () => {
    const included = await repositories.decks.create({ name: 'Included' });
    const paused = await repositories.decks.create({
      name: 'Paused',
      settings: { dailyStudyIncluded: false },
    });
    const make = async (id: string, count: number) => {
      const cards = [];
      for (let index = 0; index < count; index++) {
        const note = await repositories.notes.create({
          deckId: id,
          noteType: 'basic',
          fields: { front: String(index), back: 'Answer' },
        });
        cards.push(
          await repositories.cards.create({
            noteId: note.id,
            direction: 'recognition',
            due: new Date('2026-01-01'),
          }),
        );
      }
      return cards;
    };
    const first = await make(included.id, 2);
    const second = await make(paused.id, 4);
    const before = await Promise.all(
      [...first, ...second].map((card) => repositories.cards.byId(card.id)),
    );
    const history = await repositories.reviews.countForCards(before.map((card) => card!.id));
    expect((await build({ newCards: 'override' })).scopeDeckIds).not.toContain(paused.id);
    const single = await build({ deckIds: [included.id], minutes: 20, newCards: 'override' });
    const both = await build({
      deckIds: [paused.id, included.id],
      minutes: 20,
      newCards: 'override',
    });
    expect(single).toMatchObject({ availableCount: 2, newCount: 2, reviewCount: 0 });
    expect(single.cards.map((card) => card.id).sort()).toEqual(first.map((card) => card.id).sort());
    expect(single.deckSummaries).toEqual([
      { deckId: included.id, due: 0, fresh: 2, nextDue: null },
    ]);
    expect(both).toMatchObject({ availableCount: 6, newCount: 6, reviewCount: 0 });
    expect(both.estimatedMinutes).toBeCloseTo(single.estimatedMinutes * 3);
    expect(both.newCards.admitted).toBe(6);
    expect((await repositories.decks.byId(paused.id))?.settings?.dailyStudyIncluded).toBe(false);
    await repositories.decks.updateSettings(included.id, { dailyStudyIncluded: false });
    expect((await build({ newCards: 'override' })).scopeDeckIds).not.toContain(included.id);
    await repositories.decks.updateSettings(included.id, { dailyStudyIncluded: true });
    expect((await build({ newCards: 'override' })).cards.map((card) => card.id)).toEqual(
      expect.arrayContaining(first.map((card) => card.id)),
    );
    expect(await Promise.all(before.map((card) => repositories.cards.byId(card!.id)))).toEqual(
      before,
    );
    expect(await repositories.reviews.countForCards(before.map((card) => card!.id))).toBe(history);
    const empty = await build({ deckIds: [] });
    expect(empty).toMatchObject({
      scopeDeckIds: [],
      deckSummaries: [],
      cards: [],
      availableCount: 0,
      estimatedMinutes: 0,
      newCount: 0,
      reviewCount: 0,
      nextDue: null,
    });
    const caughtUpDeck = await repositories.decks.create({ name: 'Empty but included' });
    expect(await build({ deckIds: [caughtUpDeck.id] })).toMatchObject({
      scopeDeckIds: [caughtUpDeck.id],
      availableCount: 0,
    });
    await build({ deckIds: [uuidV7()] }, 404);
    await build({ deckId: included.id, deckIds: [included.id] }, 400);
  });

  it('applies recognition and recall choices to the actual session', async () => {
    const note = await repositories.notes.create({
      deckId,
      noteType: 'basic',
      fields: { front: 'Direction', back: 'Observable' },
    });
    await repositories.cards.create({
      noteId: note.id,
      direction: 'recall',
      due: new Date('2026-01-01T00:00:00.000Z'),
    });

    const recognition = await build({ deckId, direction: 'recognition', newCards: 'override' });
    const recall = await build({ deckId, direction: 'recall', newCards: 'override' });

    expect(recognition.cards.length).toBeGreaterThan(0);
    expect(recognition.cards.every((card) => card.direction === 'recognition')).toBe(true);
    expect(recall.cards).toHaveLength(1);
    expect(recall.cards[0]?.direction).toBe('recall');
  });

  it.each(['deck', 'folder'] as const)(
    'excludes a deleted %s from global sessions and counts, and restores eligibility',
    async (kind) => {
      const folder = await repositories.decks.create({
        name: `Eligibility ${kind}`,
        kind: 'folder',
      });
      const deck = await repositories.decks.create({ name: 'Child', parentId: folder.id });
      const note = await repositories.notes.create({
        deckId: deck.id,
        noteType: 'basic',
        fields: { front: 'Live dependency', back: 'Required' },
      });
      const card = await repositories.cards.create({
        noteId: note.id,
        direction: 'recognition',
        due: new Date('2026-01-01'),
      });
      const target = kind === 'deck' ? deck.id : folder.id;
      expect((await build({ newCards: 'override' })).cards.map((row) => row.id)).toContain(card.id);
      await repositories.decks.softDelete(target);
      expect((await build({ newCards: 'override' })).cards.map((row) => row.id)).not.toContain(
        card.id,
      );
      expect(
        (await repositories.cards.due({ now: new Date() })).map((row) => row.id),
      ).not.toContain(card.id);
      expect(
        (await repositories.cards.countsByDeck(new Date())).map((row) => row.deckId),
      ).not.toContain(deck.id);
      await repositories.decks.restore(target);
      expect((await build({ newCards: 'override' })).cards.map((row) => row.id)).toContain(card.id);
    },
  );

  it('excludes Known notes from counts and sessions without resetting their cards', async () => {
    const deck = await repositories.decks.create({ name: 'Known participation' });
    const note = await repositories.notes.create({
      deckId: deck.id,
      noteType: 'basic',
      fields: { front: 'Known fact', back: 'Answer' },
    });
    const card = await repositories.cards.create({
      noteId: note.id,
      direction: 'recognition',
      due: new Date('2026-01-01'),
    });
    await repositories.notes.setStatusMany([note.id], 'known');
    expect(
      (await repositories.cards.countsByDeck(new Date())).find((row) => row.deckId === deck.id),
    ).toBeUndefined();
    expect((await build({ deckId: deck.id, minutes: 1, newCards: 'override' })).cards).toEqual([]);
    expect(await repositories.cards.byId(card.id)).toMatchObject({
      state: 'new',
      reps: 0,
      suspendedAt: null,
    });
    await repositories.notes.setStatusMany([note.id], 'active');
    expect(
      (await repositories.cards.countsByDeck(new Date())).find((row) => row.deckId === deck.id)
        ?.fresh,
    ).toBe(1);
    expect(
      (await build({ deckId: deck.id, minutes: 1, newCards: 'override' })).cards.map(
        (row) => row.id,
      ),
    ).toEqual([card.id]);
  });
});

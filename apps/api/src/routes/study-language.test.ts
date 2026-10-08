import { beforeAll, describe, expect, it } from 'vitest';

import { createSchedulerConfig, dayIndexOf, dayStartOf } from '@neuron/core';
import { dailyStudySessionSchema, uuidV7 } from '@neuron/shared';

import { createUser, repositoriesFor, testDatabase } from '../db/testing/database.js';
import { json, testServer } from '../testing/server.js';

import type { Repositories } from '../db/repositories/index.js';
import type { Hono } from 'hono';

const database = testDatabase();
describe.skipIf(!database)('language-scoped Study with one account workload', () => {
  let repositories: Repositories;
  let server: Hono;
  let german: string;
  let english: string;
  let ids: string[];
  beforeAll(async () => {
    if (!database) return;
    await createUser(database, 'study-language-owner', {
      timezone: 'UTC',
      settings: {
        targetLanguage: 'en',
        maximumNewCardsPerDay: 4,
        budgetMinutes: [20, 20, 20, 20, 20, 20, 20],
        allowCarryOver: false,
      },
    });
    repositories = repositoriesFor(database, 'study-language-owner');
    server = testServer(database, 'study-language-owner');
    const folder = await repositories.decks.create({
      name: 'German',
      kind: 'folder',
      settings: { targetLanguage: 'de' },
    });
    german = (await repositories.decks.create({ name: 'Words', parentId: folder.id })).id;
    english = (await repositories.decks.create({ name: 'English' })).id;
    await repositories.decks.create({
      name: 'Paused French',
      settings: { targetLanguage: 'fr', dailyStudyIncluded: false },
    });
    await repositories.decks.create({
      name: 'Organization only',
      kind: 'folder',
      settings: { targetLanguage: 'es' },
    });
    ids = [];
    for (const deckId of [german, english])
      for (let index = 0; index < 8; index++) {
        const note = await repositories.notes.create({
          deckId,
          noteType: 'vocab',
          fields: { term: `Word ${index}`, translation: `Meaning ${index}` },
        });
        ids.push(
          (
            await repositories.cards.create({
              noteId: note.id,
              direction: 'recognition',
              due: new Date('2026-01-01'),
            })
          ).id,
        );
      }
  });
  async function plan(body: Record<string, unknown>) {
    return dailyStudySessionSchema.parse(
      await json(
        await server.request('/api/study/session', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        200,
      ),
    );
  }
  it('filters inherited language after shared admission without schedule or history writes', async () => {
    const before = await Promise.all(ids.map((id) => repositories.cards.byId(id)));
    const history = await repositories.reviews.countForCards(ids);
    const rev = (await repositories.account.read()).currentRev;
    const de = await plan({ targetLanguage: 'de' });
    const en = await plan({ targetLanguage: 'en' });
    expect(de.languages).toEqual(['de', 'en']);
    expect(de.scopeDeckIds).toEqual([german]);
    expect(en.scopeDeckIds).toEqual([english]);
    expect(de.cards.every((card) => card.deckId === german)).toBe(true);
    expect(en.cards.every((card) => card.deckId === english)).toBe(true);
    expect(de.newCount).toBe(4);
    expect(de.aggregateReady).toBe(4);
    expect(de.newCount + de.reviewCount).toBe(de.cards.length);
    expect(de.estimatedMinutes).toBeGreaterThan(0);
    expect(await plan({})).toEqual(de);
    expect(await Promise.all(ids.map((id) => repositories.cards.byId(id)))).toEqual(before);
    expect(await repositories.reviews.countForCards(ids)).toBe(history);
    expect((await repositories.account.read()).currentRev).toBe(rev);
  });
  it('keeps each direction independent and counts only the requested skill', async () => {
    const note = await repositories.notes.create({
      deckId: german,
      noteType: 'vocab',
      fields: { term: 'sprechen', translation: 'speak' },
    });
    const cards = await Promise.all(
      (['recall', 'production', 'listening'] as const).map((direction) =>
        repositories.cards.create({ noteId: note.id, direction, due: new Date('2026-01-01') }),
      ),
    );
    for (const direction of ['recall', 'production', 'listening']) {
      const session = await plan({ targetLanguage: 'de', direction, newCards: 'override' });
      expect(session.cards.map((card) => card.id)).toEqual([
        cards.find((card) => card.direction === direction)!.id,
      ]);
      expect(session).toMatchObject({ availableCount: 1, newCount: 1, reviewCount: 0 });
    }
    expect(await Promise.all(cards.map((card) => repositories.cards.byId(card.id)))).toEqual(cards);
    expect(await repositories.reviews.countForCards(cards.map((card) => card.id))).toBe(0);
  });
  it('does not multiply admission in sequential German and English sessions, including paused Deck introductions and Undo', async () => {
    const first = await plan({ targetLanguage: 'de', direction: 'recognition' });
    const answers: string[] = [];
    for (const card of first.cards.slice(0, 2)) {
      const id = uuidV7();
      answers.push(id);
      await repositories.reviews.record({ id, cardId: card.id, rating: 3, now: new Date() });
    }
    const second = await plan({ targetLanguage: 'en', direction: 'recognition' });
    expect(second.newCount).toBeLessThanOrEqual(2);
    expect(second.newCount).toBeGreaterThan(0);
    expect(answers.length + second.newCount).toBeLessThanOrEqual(first.aggregateReady);
    for (const card of second.cards)
      await repositories.reviews.record({
        id: uuidV7(),
        cardId: card.id,
        rating: 3,
        now: new Date(),
      });
    expect((await plan({ targetLanguage: 'de' })).newCount).toBe(0);
    expect((await plan({ targetLanguage: 'en' })).newCount).toBe(0);
    await repositories.decks.updateSettings(german, { dailyStudyIncluded: false });
    const onlyEnglish = await plan({ targetLanguage: 'en' });
    expect(onlyEnglish.newCount).toBe(0);
    expect(onlyEnglish.languages).toEqual(['en']);
    await repositories.reviews.undo(answers[0]!, uuidV7());
    expect((await plan({ targetLanguage: 'en' })).newCount).toBe(1);
    expect(await repositories.reviews.countForCards(ids)).toBe(4);
    expect((await repositories.decks.byId(german))?.settings?.dailyStudyIncluded).toBe(false);
  });
  it('reports direction-specific reviews and time from independent due states without rewriting them', async () => {
    const deck = await repositories.decks.create({
      name: 'Independent skills',
      settings: { targetLanguage: 'de', dailyStudyIncluded: false },
    });
    const note = await repositories.notes.create({
      deckId: deck.id,
      noteType: 'vocab',
      fields: { term: 'lernen', translation: 'learn' },
    });
    const now = new Date();
    const due = new Date(now.getTime() - 86_400_000);
    const future = new Date(now.getTime() + 86_400_000);
    const cards = await Promise.all(
      (['recall', 'production'] as const).map((direction) =>
        repositories.cards.create({
          noteId: note.id,
          direction,
          due: direction === 'recall' ? due : future,
          scheduling: {
            state: 'review',
            stability: direction === 'recall' ? 3 : 12,
            difficulty: 5,
            due: direction === 'recall' ? due : future,
            lastReview: due,
            reps: 3,
            lapses: 0,
            learningStep: 0,
          },
        }),
      ),
    );
    const request = { targetLanguage: 'de', deckIds: [deck.id] };
    const recall = await plan({ ...request, direction: 'recall' });
    expect(recall).toMatchObject({ reviewCount: 1, newCount: 0, estimatedMinutes: 0.1 });
    expect(recall.cards.map((card) => card.id)).toEqual([cards[0]!.id]);
    const typing = await plan({ ...request, direction: 'production' });
    expect(typing).toMatchObject({ reviewCount: 0, newCount: 0, estimatedMinutes: 0 });
    expect(typing.cards).toEqual([]);
    const boundary = createSchedulerConfig({ timezone: 'UTC', dayCutoffHour: 4 });
    expect(typing.nextDue).toBe(dayStartOf(dayIndexOf(future, boundary), boundary).toISOString());
    expect(await Promise.all(cards.map((card) => repositories.cards.byId(card.id)))).toEqual(cards);
    expect(await repositories.reviews.countForCards(cards.map((card) => card.id))).toBe(0);
  });
});

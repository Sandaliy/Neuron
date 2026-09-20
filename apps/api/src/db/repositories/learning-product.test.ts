import { beforeAll, describe, expect, it } from 'vitest';

import { RATING } from '@neuron/core';
import { uuidV7 } from '@neuron/shared';

import { createUser, repositoriesFor, testDatabase } from '../testing/database.js';

import type { Repositories } from './index.js';

const database = testDatabase();
describe.skipIf(!database)('persistent learning products', () => {
  let repo: Repositories;
  let other: Repositories;
  beforeAll(async () => {
    await createUser(database!, 'learning-product');
    await createUser(database!, 'learning-product-other');
    repo = repositoriesFor(database!, 'learning-product');
    other = repositoriesFor(database!, 'learning-product-other');
  });
  async function fixture() {
    const deck = await repo.decks.create({ name: uuidV7(), kind: 'deck' });
    const note = await repo.notes.create({
      deckId: deck.id,
      noteType: 'basic',
      fields: { front: 'Question', back: 'Answer' },
    });
    const card = await repo.cards.create({
      noteId: note.id,
      direction: 'recognition',
      due: new Date('2026-01-01'),
    });
    return { deck, note, card };
  }
  it('restarts only participating cards, preserves history and replay, and retries exactly once', async () => {
    const { deck, card } = await fixture();
    const before = await repo.reviews.record({
      cardId: card.id,
      rating: RATING.easy,
      now: new Date('2026-02-01'),
    });
    const extra = await repo.notes.create({
      deckId: deck.id,
      noteType: 'basic',
      fields: { front: 'Known', back: 'Excluded' },
    });
    const excluded = await repo.cards.create({
      noteId: extra.id,
      direction: 'recognition',
      due: new Date('2026-01-01'),
    });
    await repo.notes.setStatus(extra.id, 'known');
    const untouched = await repo.cards.byId(excluded.id);
    const eventId = uuidV7();
    expect(await repo.reviews.restartDeck(deck.id, eventId)).toBe(1);
    const fresh = await repo.cards.byId(card.id);
    expect(fresh).toMatchObject({ id: card.id, state: 'new', reps: 0, lastReview: null });
    expect(await repo.reviews.rebuild(card.id)).toMatchObject({ state: 'new', due: fresh!.due });
    expect(await repo.cards.byId(excluded.id)).toEqual(untouched);
    const after = await repo.reviews.record({
      cardId: card.id,
      rating: RATING.good,
      now: new Date(fresh!.due.getTime() + 1000),
    });
    expect(after.state.reps).toBe(1);
    expect(await repo.reviews.rebuild(card.id)).toEqual(after.state);
    await repo.reviews.restartDeck(deck.id, eventId);
    expect(await repo.cards.byId(card.id)).toEqual(after.card);
    await repo.reviews.undo(before.review.id, uuidV7());
    expect(await repo.reviews.rebuild(card.id)).toEqual(after.state);
    await repo.reviews.undo(after.review.id, uuidV7());
    expect(await repo.reviews.rebuild(card.id)).toMatchObject({ state: 'new', due: fresh!.due });
    expect(await repo.reviews.countForCards([card.id])).toBe(2);
    const events = (await repo.sync.pull(0, 1000)).changes.filter(
      (row) => row.entity === 'reviews' && row.row['cardId'] === card.id,
    );
    expect(events.filter((row) => row.row['resetsLearning'])).toHaveLength(1);
    expect(events.some((row) => row.id === before.review.id)).toBe(true);
    await expect(other.reviews.restartDeck(deck.id, uuidV7())).rejects.toThrow();
  });
  it('keeps an empty restart retry empty after content is added', async () => {
    const deck = await repo.decks.create({ name: uuidV7(), kind: 'deck' });
    const id = uuidV7();
    expect(await repo.reviews.restartDeck(deck.id, id)).toBe(0);
    const note = await repo.notes.create({
      deckId: deck.id,
      noteType: 'basic',
      fields: { front: 'Q', back: 'A' },
    });
    const card = await repo.cards.create({
      noteId: note.id,
      direction: 'recognition',
      due: new Date('2026-01-01'),
    });
    await repo.reviews.record({
      cardId: card.id,
      rating: RATING.easy,
      now: new Date('2026-02-01'),
    });
    expect(await repo.reviews.restartDeck(deck.id, id)).toBe(0);
    expect((await repo.cards.byId(card.id))!.state).toBe('review');
  });
  it('persists Practice without schedule writes and reconciles live membership', async () => {
    const { deck, note, card } = await fixture();
    const command = {
      kind: 'start' as const,
      id: uuidV7(),
      expectedVersion: 0,
      runId: uuidV7(),
      front: 'front' as const,
      back: 'back' as const,
    };
    const started = await repo.practice.apply(deck.id, command);
    expect(await repo.practice.apply(deck.id, command)).toEqual(started);
    const answer = {
      kind: 'answer' as const,
      id: uuidV7(),
      expectedVersion: 1,
      runId: command.runId,
      noteId: note.id,
      known: true,
    };
    const completed = await repo.practice.apply(deck.id, answer);
    expect(await repo.practice.get(deck.id)).toEqual(completed);
    expect(await repo.practice.apply(deck.id, answer)).toEqual(completed);
    expect(await repo.reviews.countForCards([card.id])).toBe(0);
    expect(await repo.cards.byId(card.id)).toEqual(card);
    await expect(other.practice.get(deck.id)).rejects.toThrow();
    await expect(repo.practice.apply(deck.id, { ...command, id: uuidV7() })).rejects.toThrow();
    const added = await repo.notes.create({
      deckId: deck.id,
      noteType: 'basic',
      fields: { front: 'New', back: 'Answer' },
    });
    const reconciled = await repo.practice.get(deck.id);
    expect(reconciled.run!.statuses[note.id]).toBe('known');
    expect(reconciled.run!.queue).toEqual([added.id]);
    await repo.notes.softDelete(added.id);
    expect((await repo.practice.get(deck.id)).run!.queue).toEqual([]);
    await repo.reviews.restartDeck(deck.id, uuidV7());
    expect((await repo.practice.get(deck.id)).run).toEqual(completed.run);
  });
  it('resumes composed grammar Practice without writing Reviews or changing cards', async () => {
    const deck = await repo.decks.create({ name: 'Grammar' });
    const note = await repo.notes.create({
      deckId: deck.id,
      noteType: 'vocab',
      fields: {
        term: 'geben',
        translation: 'give',
        partOfSpeech: 'verb',
        grammar: { praeteritum: 'gab', partizip2: 'gegeben', pattern: 'jemandem etwas geben' },
      },
    });
    const card = await repo.cards.create({
      noteId: note.id,
      direction: 'recognition',
      due: new Date('2026-01-01'),
    });
    const runId = uuidV7();
    await repo.practice.apply(deck.id, {
      kind: 'start',
      id: uuidV7(),
      expectedVersion: 0,
      runId,
      front: 'translation',
      back: ['term', 'grammar.praeteritum', 'grammar.partizip2', 'grammar.pattern'],
    });
    const done = await repo.practice.apply(deck.id, {
      kind: 'answer',
      id: uuidV7(),
      expectedVersion: 1,
      runId,
      noteId: note.id,
      known: true,
    });
    expect(await repo.practice.get(deck.id)).toEqual(done);
    expect(await repo.practice.get(deck.id)).toEqual(done);
    expect(done.run!.back).toEqual([
      'term',
      'grammar.praeteritum',
      'grammar.partizip2',
      'grammar.pattern',
    ]);
    expect(await repo.cards.byId(card.id)).toEqual(card);
    expect(await repo.reviews.countForCards([card.id])).toBe(0);
    expect(
      (await repo.sync.pull(0, 1000)).changes.filter(
        (change) => change.entity === 'reviews' && change.row['cardId'] === card.id,
      ),
    ).toEqual([]);
  });
});

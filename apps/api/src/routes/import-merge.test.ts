import { beforeAll, describe, expect, it } from 'vitest';

import { RATING } from '@neuron/core';
import { uuidV7, openingCards, resolveDeckSettings } from '@neuron/shared';
import type { Note, NoteTypeName } from '@neuron/shared';

import { createUser, repositoriesFor, testDatabase } from '../db/testing/database.js';
import { json, testServer } from '../testing/server.js';

import type { Repositories } from '../db/repositories/index.js';
import type { Hono } from 'hono';

const database = testDatabase();
describe.skipIf(!database)('safe import merge', () => {
  let repositories: Repositories;
  let server: Hono;
  let deckId: string;

  beforeAll(async () => {
    if (!database) return;
    await createUser(database, 'import-merge-owner');
    repositories = repositoriesFor(database, 'import-merge-owner');
    server = testServer(database, 'import-merge-owner');
    deckId = (await repositories.decks.create({ name: 'Merge' })).id;
  });

  async function create(fields: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    return (
      await json<{ note: Note }>(
        await server.request('/api/notes', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ deckId, noteType: 'vocab', fields, ...extra }),
        }),
        201,
      )
    ).note;
  }
  function merge(id: string, fields: Record<string, unknown>, noteType: NoteTypeName = 'vocab') {
    return server.request(`/api/notes/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ merge: true, noteType, fields }),
    });
  }

  it('fills grammar leaves without overwrites, preserves metadata, schedules and reviews, and is idempotent', async () => {
    const note = await create(
      { term: 'Bewahren', translation: 'keep', grammar: { separable: false, auxiliary: 'sein' } },
      { tags: ['old'], source: 'original', rank: 0, status: 'known' },
    );
    const [card] = await repositories.cards.forNote(note.id);
    await repositories.reviews.record({ cardId: card!.id, rating: RATING.good, now: new Date() });
    const beforeCards = await repositories.cards.forNote(note.id);
    const beforeReviews = await repositories.reviews.forCard(card!.id);
    const input = {
      term: 'Bewahren',
      translation: 'replace',
      audio: 'recording.ogg',
      grammar: { separable: true, auxiliary: 'haben', partizip2: 'bewahrt', reflexive: false },
    };
    await json(await merge(note.id, input), 200);
    const after = await repositories.notes.byId(note.id);
    expect(after?.fields).toEqual({
      term: 'Bewahren',
      translation: 'keep',
      audio: 'recording.ogg',
      grammar: { separable: false, auxiliary: 'sein', partizip2: 'bewahrt', reflexive: false },
    });
    expect(after).toMatchObject({ tags: ['old'], source: 'original', rank: 0, status: 'known' });
    expect(await repositories.cards.forNote(note.id)).toEqual(beforeCards);
    expect(await repositories.reviews.forCard(card!.id)).toEqual(beforeReviews);
    await json(await merge(note.id, input), 200);
    expect(await repositories.notes.byId(note.id)).toEqual(after);
    expect(await repositories.cards.forNote(note.id)).toEqual(beforeCards);
  });

  it('serializes concurrent additions so neither writer erases the other', async () => {
    const note = await create({ term: 'Parallel', translation: 'parallel' });
    const responses = await Promise.all([
      merge(note.id, { term: 'Parallel', translation: 'change', note: 'first addition' }),
      merge(note.id, { term: 'Parallel', translation: 'change', mnemonic: 'second addition' }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect((await repositories.notes.byId(note.id))?.fields).toMatchObject({
      translation: 'parallel',
      note: 'first addition',
      mnemonic: 'second addition',
    });
  });

  it('rejects ambiguous same-type targets but ignores incompatible matches for eligibility', async () => {
    const a = await create({ term: 'Mehrfach', translation: 'first' });
    await create({ term: 'Mehrfach', translation: 'second' });
    const before = await repositories.notes.byId(a.id);
    expect(
      (await merge(a.id, { term: 'Mehrfach', translation: 'new', note: 'must not land' })).status,
    ).toBe(400);
    expect(await repositories.notes.byId(a.id)).toEqual(before);
    const unique = await create({ term: 'Mixed', translation: 'keep' });
    const incompatible = await create({ front: 'Mixed', back: 'basic' }, { noteType: 'basic' });
    const basicBefore = await repositories.notes.byId(incompatible.id);
    await json(await merge(unique.id, { term: 'Mixed', translation: 'new', note: 'added' }), 200);
    expect((await merge(incompatible.id, { term: 'Mixed', translation: 'new' })).status).toBe(400);
    expect(await repositories.notes.byId(incompatible.id)).toEqual(basicBefore);
    const found = await json<{ matches: { noteType: string }[] }>(
      await server.request('/api/notes/duplicates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ terms: ['Mixed'] }),
      }),
      200,
    );
    expect(found.matches.map((row) => row.noteType).sort()).toEqual(['basic', 'vocab']);
  });

  it('uses the shared opening plan when a pre-existing note has no cards', async () => {
    const fields = { term: 'Opening', translation: 'open' };
    const note = await repositories.notes.create({ deckId, noteType: 'vocab', fields });
    await json(await merge(note.id, { ...fields, audio: 'audio.ogg' }), 200);
    const cards = await repositories.cards.forNote(note.id);
    const expected = openingCards(
      'vocab',
      { ...fields, audio: 'audio.ogg' },
      resolveDeckSettings([]).ladder,
    );
    expect(cards.map(({ direction, slot }) => ({ direction, slot }))).toEqual(
      expected.map(({ direction, slot }) => ({ direction, slot })),
    );
  });

  it('keeps all cloze slots and their review history', async () => {
    const note = await create({ text: '{{c1::one}} and {{c2::two}}' }, { noteType: 'cloze' });
    const before = await repositories.cards.forNote(note.id);
    await json(
      await merge(note.id, { text: '{{c1::one}} and {{c2::two}}', note: 'context' }, 'cloze'),
      200,
    );
    expect(await repositories.cards.forNote(note.id)).toEqual(before);
  });

  it('undo removes only created rows and cards, leaving merged additions and all reviews', async () => {
    const keeper = await create({ term: 'Keeper', translation: 'keep' });
    const batchId = uuidV7();
    const rowId = uuidV7();
    await json(
      await server.request('/api/imports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: batchId, deckId, source: 'merge-test' }),
      }),
      201,
    );
    const chunk = {
      notes: [{ id: rowId, noteType: 'vocab', fields: { term: 'Keeper', translation: 'another' } }],
    };
    const send = () =>
      server.request(`/api/imports/${batchId}/notes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(chunk),
      });
    // Merge before create-another makes this target unique at the moment it is used.
    await json(
      await merge(keeper.id, { term: 'Keeper', translation: 'replace', note: 'addition stays' }),
      200,
    );
    await json(await send(), 200);
    expect(await json(await send(), 200)).toEqual({ notes: 0, cards: 0, skipped: 1 });
    const [card] = await repositories.cards.forNote(rowId);
    await repositories.reviews.record({ cardId: card!.id, rating: RATING.good, now: new Date() });
    const reviews = await repositories.reviews.forCard(card!.id);
    await json(await server.request(`/api/imports/${batchId}/undo`, { method: 'POST' }), 200);
    expect(await repositories.notes.byId(rowId)).toBeUndefined();
    expect(await repositories.cards.forNote(rowId)).toEqual([]);
    expect((await repositories.notes.byId(keeper.id))?.fields).toMatchObject({
      note: 'addition stays',
    });
    expect(await repositories.reviews.forCard(card!.id)).toEqual(reviews);
  });
});

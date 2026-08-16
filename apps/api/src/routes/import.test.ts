import { beforeAll, describe, expect, it } from 'vitest';

import { RATING } from '@neuron/core';
import { IMPORT_CHUNK_SIZE, normaliseTerm, uuidV7 } from '@neuron/shared';
import type { ImportBatch } from '@neuron/shared';

import {
  countingRepositories,
  createUser,
  repositoriesFor,
  testDatabase,
} from '../db/testing/database.js';
import { json, testServer } from '../testing/server.js';

import type { Repositories } from '../db/repositories/index.js';
import type { Hono } from 'hono';

/**
 * Importing a word list, and taking one back.
 *
 * The three things that decide whether a real five thousand row import works:
 * a chunk that arrives twice does not double anything, the duplicate check
 * does not become one query per row, and the undo removes exactly the batch.
 */

const database = testDatabase();
const OWNER = 'import-owner';

/** A note as the importer sends it: a client id, because that is the idempotency. */
function note(term: string) {
  return {
    id: uuidV7(),
    noteType: 'vocab' as const,
    fields: { term, translation: `${term} translated` },
  };
}

describe.skipIf(!database)('importing', () => {
  let repositories: Repositories;
  let server: Hono;
  let deckId: string;

  beforeAll(async () => {
    if (!database) {
      return;
    }

    await createUser(database, OWNER);

    repositories = repositoriesFor(database, OWNER);
    server = testServer(database, OWNER);
    deckId = (await repositories.decks.create({ name: 'Importing' })).id;
  });

  async function startBatch(source: string, id = uuidV7()) {
    return json<{ import: ImportBatch }>(
      await server.request('/api/imports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, deckId, source, format: 'json' }),
      }),
      201,
    );
  }

  async function sendChunk(batchId: string, notes: readonly ReturnType<typeof note>[]) {
    return json<{ notes: number; cards: number; skipped: number }>(
      await server.request(`/api/imports/${batchId}/notes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ notes }),
      }),
      200,
    );
  }

  it('creates the batch before any note arrives, so an undo always exists', async () => {
    if (!database) {
      return;
    }

    const started = await startBatch('Empty first');

    expect(started.import.noteCount).toBe(0);
  });

  it('answers with the same batch when the opening request is sent twice', async () => {
    if (!database) {
      return;
    }

    const id = uuidV7();
    const first = await startBatch('Sent twice', id);
    const second = await startBatch('Sent twice', id);

    expect(second.import.id).toBe(first.import.id);
    expect((await repositories.importBatches.list()).filter((row) => row.id === id)).toHaveLength(
      1,
    );
  });

  it('writes nothing the second time a chunk arrives', async () => {
    if (!database) {
      return;
    }

    const started = await startBatch('Chunk twice');
    const chunk = [note('Wiederholung'), note('Verbindung')];

    const first = await sendChunk(started.import.id, chunk);
    const second = await sendChunk(started.import.id, chunk);

    expect(first).toEqual({ notes: 2, cards: 2, skipped: 0 });
    expect(second).toEqual({ notes: 0, cards: 0, skipped: 2 });

    const summary = await json<{ notes: number; cards: number }>(
      await server.request(`/api/imports/${started.import.id}`),
      200,
    );

    expect(summary.notes).toBe(2);
    expect(summary.cards).toBe(2);
  });

  it('keeps the running count as chunks land', async () => {
    if (!database) {
      return;
    }

    const started = await startBatch('Counting');

    await sendChunk(started.import.id, [note('Eins'), note('Zwei')]);
    await sendChunk(started.import.id, [note('Drei')]);

    const batch = await repositories.importBatches.byId(started.import.id);

    expect(batch?.noteCount).toBe(3);
  });

  it('finds a word that is already in the library, whatever deck it is in', async () => {
    if (!database) {
      return;
    }

    const elsewhere = await repositories.decks.create({ name: 'Another deck' });

    await repositories.notes.create({
      deckId: elsewhere.id,
      noteType: 'vocab',
      fields: { term: 'Der  Schlüssel ', translation: 'key' },
    });

    const body = await json<{ matches: { term: string; deckId: string; written: string }[] }>(
      await server.request('/api/notes/duplicates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ terms: ['der schlüssel', 'Nichts davon'] }),
      }),
      200,
    );

    expect(body.matches).toHaveLength(1);
    expect(body.matches[0]?.term).toBe(normaliseTerm('Der  Schlüssel '));
    expect(body.matches[0]?.deckId).toBe(elsewhere.id);
    expect(body.matches[0]?.written).toBe('Der  Schlüssel');
  });

  it('does not treat two different words as the same one', async () => {
    if (!database) {
      return;
    }

    await repositories.notes.create({
      deckId,
      noteType: 'vocab',
      fields: { term: 'schön', translation: 'beautiful' },
    });

    const body = await json<{ matches: unknown[] }>(
      await server.request('/api/notes/duplicates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ terms: ['schon'] }),
      }),
      200,
    );

    expect(body.matches).toHaveLength(0);
  });
});

describe.skipIf(!database)('taking an import back', () => {
  let repositories: Repositories;
  let server: Hono;
  let deckId: string;

  beforeAll(async () => {
    if (!database) {
      return;
    }

    await createUser(database, `${OWNER}-undo`);

    repositories = repositoriesFor(database, `${OWNER}-undo`);
    server = testServer(database, `${OWNER}-undo`);
    deckId = (await repositories.decks.create({ name: 'Undoing' })).id;
  });

  it('removes exactly the batch, its cards, and nothing else', async () => {
    if (!database) {
      return;
    }

    const keeper = await repositories.notes.create({
      deckId,
      noteType: 'vocab',
      fields: { term: 'Bleibt', translation: 'stays' },
    });

    const batchId = uuidV7();

    await json(
      await server.request('/api/imports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: batchId,
          deckId,
          source: 'Undo me',
          notes: [note('Verschwindet'), note('Auch weg')],
        }),
      }),
      201,
    );

    const imported = (await repositories.notes.list({ source: 'Undo me' })).items;

    expect(imported).toHaveLength(2);

    const body = await json<{ undone: number }>(
      await server.request(`/api/imports/${batchId}/undo`, { method: 'POST' }),
      200,
    );

    expect(body.undone).toBe(2);
    expect((await repositories.notes.list({ source: 'Undo me' })).items).toHaveLength(0);
    expect(await repositories.notes.byId(keeper.id)).toBeDefined();

    // The cards go with their notes rather than at the next cleanup. A card
    // whose note is gone is a question with no answer, and it would keep coming
    // up due.
    for (const row of imported) {
      expect(await repositories.cards.forNote(row.id)).toHaveLength(0);
    }
  });

  it('says how much of the import has been answered before it is taken back', async () => {
    if (!database) {
      return;
    }

    const batchId = uuidV7();

    await json(
      await server.request('/api/imports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: batchId,
          deckId,
          source: 'Answered',
          notes: [note('Geantwortet'), note('Unberührt')],
        }),
      }),
      201,
    );

    const [first] = (await repositories.notes.list({ source: 'Answered' })).items;
    const [card] = await repositories.cards.forNote(first?.id ?? '');

    await repositories.reviews.record({
      cardId: card?.id ?? '',
      rating: RATING.good,
      now: new Date(),
    });

    const summary = await json<{ notes: number; cards: number; reviewedCards: number }>(
      await server.request(`/api/imports/${batchId}`),
      200,
    );

    expect(summary.notes).toBe(2);
    expect(summary.cards).toBe(2);
    expect(summary.reviewedCards).toBe(1);
  });
});

describe.skipIf(!database)('five thousand rows', () => {
  const SIZE = 5000;

  let repositories: Repositories;
  let server: Hono;
  let deckId: string;

  beforeAll(async () => {
    if (!database) {
      return;
    }

    await createUser(database, `${OWNER}-large`);

    repositories = repositoriesFor(database, `${OWNER}-large`);
    server = testServer(database, `${OWNER}-large`);
    deckId = (await repositories.decks.create({ name: 'Five thousand' })).id;
  });

  it('arrives in chunks and lands whole', async () => {
    if (!database) {
      return;
    }

    const words = Array.from({ length: SIZE }, (_, index) => note(`Wort${index}`));
    const batchId = uuidV7();

    await json(
      await server.request('/api/imports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: batchId, deckId, source: 'Frequency list' }),
      }),
      201,
    );

    const started = Date.now();

    for (let index = 0; index < words.length; index += IMPORT_CHUNK_SIZE) {
      await json(
        await server.request(`/api/imports/${batchId}/notes`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ notes: words.slice(index, index + IMPORT_CHUNK_SIZE) }),
        }),
        200,
      );
    }

    const seconds = Math.round((Date.now() - started) / 100) / 10;
    const summary = await json<{ notes: number; cards: number }>(
      await server.request(`/api/imports/${batchId}`),
      200,
    );

    console.log(`five thousand rows in ${SIZE / IMPORT_CHUNK_SIZE} chunks: ${seconds}s`);

    expect(summary.notes).toBe(SIZE);
    expect(summary.cards).toBe(SIZE);
  }, 600_000);

  it('checks five thousand words for duplicates in a bounded number of queries', async () => {
    if (!database) {
      return;
    }

    const counted = countingRepositories(database, `${OWNER}-large`);
    const terms = Array.from({ length: SIZE }, (_, index) => normaliseTerm(`Wort${index}`));

    counted.reset();

    let found = 0;

    // The client sends the words a chunk at a time, the same way it sends the
    // notes. What is being proved is that each chunk is one statement rather
    // than one per row.
    for (let index = 0; index < terms.length; index += 1000) {
      found += (await counted.repositories.notes.duplicatesOf(terms.slice(index, index + 1000)))
        .length;
    }

    const queries = counted.count();

    console.log(`duplicate check over ${SIZE} words: ${queries} queries, ${found} found`);

    expect(found).toBe(SIZE);
    // Five queries plus whatever the connection does to set itself up. The
    // number that matters is that it does not grow with the number of words.
    expect(queries).toBeLessThan(30);
  }, 300_000);
});

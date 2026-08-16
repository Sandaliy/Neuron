import { beforeAll, describe, expect, it } from 'vitest';

import { normaliseTerm } from '@neuron/shared';
import type { Deck, Note } from '@neuron/shared';

import { createUser, repositoriesFor, testDatabase } from '../db/testing/database.js';
import { json, testServer } from '../testing/server.js';

import type { Repositories } from '../db/repositories/index.js';
import type { Hono } from 'hono';

/**
 * Browsing a deck: searching it, filtering it, ordering it, and changing many
 * notes at once.
 *
 * The bulk actions are what make a large import usable at all. Without them,
 * removing the four hundred words already known out of a list of five thousand
 * is four hundred taps.
 */

const database = testDatabase();
const OWNER = 'browse-owner';

const WORDS = [
  { term: 'Apfel', translation: 'apple', rank: 300, tags: ['food'] },
  { term: 'Birne', translation: 'pear', rank: 900, tags: ['food'] },
  { term: 'Zaun', translation: 'fence', rank: 100, tags: ['house'] },
  { term: 'Sorgfalt', translation: 'care', rank: null, tags: ['work'] },
];

describe.skipIf(!database)('browsing notes', () => {
  let repositories: Repositories;
  let server: Hono;
  let deckId: string;
  let ids: Record<string, string>;

  beforeAll(async () => {
    if (!database) {
      return;
    }

    await createUser(database, OWNER);

    repositories = repositoriesFor(database, OWNER);
    server = testServer(database, OWNER);

    const deck = await json<{ deck: Deck }>(
      await server.request('/api/decks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Browsing' }),
      }),
      201,
    );

    deckId = deck.deck.id;
    ids = {};

    for (const word of WORDS) {
      const written = await json<{ note: Note }>(
        await server.request('/api/notes', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            deckId,
            noteType: 'vocab',
            fields: { term: word.term, translation: word.translation },
            tags: word.tags,
            rank: word.rank,
            source: 'Browsing list',
          }),
        }),
        201,
      );

      ids[word.term] = written.note.id;
    }
  });

  async function list(query: string) {
    return json<{ items: Note[]; nextCursor?: string }>(
      await server.request(`/api/notes?deckId=${deckId}&${query}`),
      200,
    );
  }

  function terms(items: readonly Note[]): string[] {
    return items.map((note) => String(note.fields['term']));
  }

  it('finds a note by its term', async () => {
    if (!database) {
      return;
    }

    expect(terms((await list('search=apfel')).items)).toEqual(['Apfel']);
  });

  it('finds a note by its translation', async () => {
    if (!database) {
      return;
    }

    expect(terms((await list('search=fence')).items)).toEqual(['Zaun']);
  });

  it('finds a note by a tag, which is a column and not a field', async () => {
    if (!database) {
      return;
    }

    expect(terms((await list('search=house')).items)).toEqual(['Zaun']);
  });

  it('treats a percent sign as a character rather than as a wildcard', async () => {
    if (!database) {
      return;
    }

    expect((await list('search=%25')).items).toHaveLength(0);
  });

  it('orders by the word itself', async () => {
    if (!database) {
      return;
    }

    expect(terms((await list('sort=alpha')).items)).toEqual(['Apfel', 'Birne', 'Sorgfalt', 'Zaun']);
  });

  it('orders by frequency, with the notes that have no rank last', async () => {
    if (!database) {
      return;
    }

    expect(terms((await list('sort=rank')).items)).toEqual(['Zaun', 'Apfel', 'Birne', 'Sorgfalt']);
  });

  it('pages through an order without losing or repeating a row', async () => {
    if (!database) {
      return;
    }

    const seen: string[] = [];
    let cursor: string | undefined;

    do {
      const page = await list(`sort=alpha&limit=1${cursor ? `&cursor=${cursor}` : ''}`);

      seen.push(...terms(page.items));
      cursor = page.nextCursor;
    } while (cursor !== undefined);

    expect(seen).toEqual(['Apfel', 'Birne', 'Sorgfalt', 'Zaun']);
  });

  it('filters by where the notes came from', async () => {
    if (!database) {
      return;
    }

    expect((await list('source=Browsing%20list')).items).toHaveLength(WORDS.length);
    expect((await list('source=Somewhere%20else')).items).toHaveLength(0);
  });

  it('filters by the state of a card, without repeating a note per card', async () => {
    if (!database) {
      return;
    }

    const fresh = await list('cardState=new');

    expect(fresh.items).toHaveLength(WORDS.length);
    expect(new Set(fresh.items.map((note) => note.id)).size).toBe(WORDS.length);
    expect((await list('cardState=review')).items).toHaveLength(0);
  });

  it('stores the comparable form of the term the same way the code does', async () => {
    if (!database) {
      return;
    }

    // The duplicate check compares this column against a string built in
    // TypeScript. A difference of one space between the two finds nothing and
    // lets a whole import in twice.
    const row = await repositories.notes.byId(ids['Sorgfalt'] ?? '');

    expect(row?.termKey).toBe(normaliseTerm('Sorgfalt'));
  });
});

describe.skipIf(!database)('changing many notes at once', () => {
  let repositories: Repositories;
  let server: Hono;
  let deckId: string;
  let elsewhere: string;
  let ids: string[];

  beforeAll(async () => {
    if (!database) {
      return;
    }

    await createUser(database, `${OWNER}-bulk`);

    repositories = repositoriesFor(database, `${OWNER}-bulk`);
    server = testServer(database, `${OWNER}-bulk`);

    deckId = (await repositories.decks.create({ name: 'Bulk' })).id;
    elsewhere = (await repositories.decks.create({ name: 'Bulk elsewhere' })).id;
    ids = [];

    for (const word of WORDS) {
      const written = await json<{ note: Note }>(
        await server.request('/api/notes', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            deckId,
            noteType: 'vocab',
            fields: { term: word.term, translation: word.translation },
            tags: ['import'],
          }),
        }),
        201,
      );

      ids.push(written.note.id);
    }
  });

  it('marks a selection as known in one request', async () => {
    if (!database) {
      return;
    }

    const body = await json<{ changed: number }>(
      await server.request('/api/notes/status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: ids.slice(0, 2), status: 'known' }),
      }),
      200,
    );

    expect(body.changed).toBe(2);
    expect((await repositories.notes.byId(ids[0] ?? ''))?.status).toBe('known');
  });

  it('moves a selection, taking the cards with it', async () => {
    if (!database) {
      return;
    }

    const body = await json<{ changed: number }>(
      await server.request('/api/notes/move', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [ids[0]], deckId: elsewhere }),
      }),
      200,
    );

    expect(body.changed).toBe(1);

    const cards = await repositories.cards.forNote(ids[0] ?? '');

    // The card carries a copy of its note's deck for the sake of the due query.
    // A bulk move that left it behind would leave the card counted under a deck
    // its note is no longer in.
    expect(cards.every((card) => card.deckId === elsewhere)).toBe(true);
  });

  it('adds and removes tags in one request', async () => {
    if (!database) {
      return;
    }

    await json<{ changed: number }>(
      await server.request('/api/notes/tags', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids, add: ['lesson-4'], remove: ['import'] }),
      }),
      200,
    );

    const row = await repositories.notes.byId(ids[1] ?? '');

    expect(row?.tags).toEqual(['lesson-4']);
  });

  it('writes nothing for a note that already reads that way', async () => {
    if (!database) {
      return;
    }

    const body = await json<{ changed: number }>(
      await server.request('/api/notes/tags', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids, add: ['lesson-4'] }),
      }),
      200,
    );

    expect(body.changed).toBe(0);
  });

  it('deletes a selection, cards and all', async () => {
    if (!database) {
      return;
    }

    const target = ids.at(-1) ?? '';

    const body = await json<{ deleted: number }>(
      await server.request('/api/notes/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [target] }),
      }),
      200,
    );

    expect(body.deleted).toBe(1);
    expect(await repositories.notes.byId(target)).toBeUndefined();
    expect(await repositories.cards.forNote(target)).toHaveLength(0);
  });

  it('refuses a batch larger than it is allowed to hold', async () => {
    if (!database) {
      return;
    }

    const response = await server.request('/api/notes/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: Array.from({ length: 501 }, () => ids[0]) }),
    });

    expect(response.status).toBe(400);
  });
});

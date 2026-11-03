import { Pool } from '@neondatabase/serverless';
import { beforeAll, describe, expect, it } from 'vitest';

import { RATING } from '@neuron/core';
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
    expect((await list('source=Browsing')).items).toHaveLength(0);
    expect(
      (await list('source=Browsing%20list&search=apple')).items.map((note) => note.id),
    ).toEqual([ids['Apfel']]);
  });

  it('keeps source conditions while a cursor advances', async () => {
    if (!database) return;
    const first = await list('source=Browsing%20list&sort=alpha&limit=1');
    const second = await list(
      `source=Browsing%20list&sort=alpha&limit=1&cursor=${first.nextCursor ?? ''}`,
    );
    expect(terms(first.items)).toEqual(['Apfel']);
    expect(terms(second.items)).toEqual(['Birne']);
  });

  it('filters by the state of a card, without repeating a note per card', async () => {
    if (!database) {
      return;
    }

    const fresh = await list('cardState=new');

    expect(fresh.items).toHaveLength(WORDS.length);
    expect(new Set(fresh.items.map((note) => note.id)).size).toBe(WORDS.length);
    expect((await list('cardState=review')).items).toHaveLength(0);
    expect(fresh.items.every((note) => note.cardStates?.new === 1)).toBe(true);
  });

  it('returns one bounded live-card summary per note, including mixed and empty notes', async () => {
    if (!database) return;
    const mixed = await repositories.notes.byId(ids['Apfel'] ?? '');
    const original = (await repositories.cards.forNote(mixed?.id ?? ''))[0];
    if (!mixed || !original) throw new Error('browse fixture missing its opening card');
    await repositories.cards.create({ noteId: mixed.id, direction: 'recall', due: new Date() });
    await repositories.reviews.record({
      cardId: original.id,
      rating: RATING.good,
      now: new Date(),
    });
    const gone = await repositories.notes.byId(ids['Birne'] ?? '');
    const goneCard = (await repositories.cards.forNote(gone?.id ?? ''))[0];
    if (!gone || !goneCard) throw new Error('browse fixture missing its second opening card');
    await repositories.cards.softDelete(goneCard.id);

    const page = await list('sort=alpha');
    const summaries = new Map(
      page.items.map((note) => [String(note.fields['term']), note.cardStates]),
    );
    expect(summaries.get('Apfel')).toEqual({ new: 1, learning: 1, review: 0, relearning: 0 });
    expect(summaries.get('Birne')).toEqual({ new: 0, learning: 0, review: 0, relearning: 0 });
    expect(
      (await list('cardState=new')).items.map((note) => String(note.fields['term'])),
    ).not.toContain('Birne');
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

describe.skipIf(!database)('account-wide Note browsing', () => {
  it('checks live parent links even when a legacy Deck has an incomplete cached path', async () => {
    if (!database) return;
    const owner = 'browse-library-parent-links';
    await createUser(database, owner);
    const repo = repositoriesFor(database, owner);
    const folder = await repo.decks.create({ name: 'Hidden folder', kind: 'folder' });
    const deck = await repo.decks.create({ name: 'Legacy Deck', parentId: folder.id });
    const note = await repo.notes.create({
      deckId: deck.id,
      noteType: 'basic',
      fields: { front: 'Legacy marker', back: 'Retained for recovery' },
    });
    const pool = new Pool({ connectionString: database.ownerUrl });
    try {
      // Model a legacy live child below a deleted parent without trusting path.
      await pool.query('update decks set deleted_at = now() where id = $1', [folder.id]);
      await pool.query("update decks set path = '{}'::uuid[] where id = $1", [deck.id]);
    } finally {
      await pool.end();
    }
    const server = testServer(database, owner);
    const page = await json<{ items: Note[] }>(
      await server.request('/api/notes?search=Legacy%20marker'),
      200,
    );
    expect(page.items).toEqual([]);
    expect((await repo.notes.list({ deckId: deck.id, includeSubtree: false })).items).toEqual([]);
    expect(await repo.notes.byId(note.id)).toBeDefined();
  });

  it('retains filters across Decks and cursor pages without exposing deleted or foreign Notes', async () => {
    if (!database) return;
    const owner = 'browse-library-owner';
    const outsider = 'browse-library-outsider';
    await createUser(database, owner);
    await createUser(database, outsider);
    const repo = repositoriesFor(database, owner);
    const foreign = repositoriesFor(database, outsider);
    const server = testServer(database, owner);
    const folder = await repo.decks.create({ name: 'Languages', kind: 'folder' });
    const nested = await repo.decks.create({ name: 'German', kind: 'folder', parentId: folder.id });
    const left = await repo.decks.create({ name: 'Lesson', parentId: folder.id });
    const right = await repo.decks.create({ name: 'Lesson', parentId: nested.id });
    const input = {
      noteType: 'vocab' as const,
      fields: { term: 'Matching word', translation: 'Library marker' },
      tags: ['shared'],
      source: 'Library search',
      status: 'active' as const,
    };
    const first = await repo.notes.create({ ...input, deckId: left.id, rank: 1 });
    const second = await repo.notes.create({ ...input, deckId: right.id, rank: 2 });
    const cardFor = (noteId: string) =>
      repo.cards.create({ noteId, direction: 'recognition', due: new Date() });
    await cardFor(first.id);
    await cardFor(second.id);
    await repo.cards.create({ noteId: first.id, direction: 'recall', due: new Date() });
    for (const excluded of [
      { tags: ['other'] },
      { source: 'Another source' },
      { status: 'known' as const },
      { fields: { term: 'Another word', translation: 'No match' } },
    ]) {
      const note = await repo.notes.create({ ...input, deckId: left.id, rank: 0, ...excluded });
      await cardFor(note.id);
    }
    // A matching Note without a new Card must not enter a card-state search.
    await repo.notes.create({ ...input, deckId: left.id, rank: 0 });
    const deleted = await repo.notes.create({ ...input, deckId: left.id, rank: 0 });
    await cardFor(deleted.id);
    await repo.notes.softDelete(deleted.id);
    const deletedFolder = await repo.decks.create({ name: 'Deleted', kind: 'folder' });
    const deletedDeck = await repo.decks.create({ name: 'Lesson', parentId: deletedFolder.id });
    const hidden = await repo.notes.create({ ...input, deckId: deletedDeck.id, rank: 0 });
    await cardFor(hidden.id);
    await repo.decks.softDelete(deletedFolder.id);
    // Collection deletion retains the Note itself for recovery.
    expect(await repo.notes.byId(hidden.id)).toBeDefined();
    expect((await repo.decks.listDeleted()).map((deck) => deck.id)).toContain(deletedDeck.id);
    const foreignDeck = await foreign.decks.create({ name: 'Lesson' });
    const foreignNote = await foreign.notes.create({ ...input, deckId: foreignDeck.id, rank: 0 });
    await foreign.cards.create({
      noteId: foreignNote.id,
      direction: 'recognition',
      due: new Date(),
    });

    const query = new URLSearchParams({
      search: 'library marker',
      tag: 'shared',
      source: 'Library search',
      status: 'active',
      cardState: 'new',
      sort: 'rank',
      limit: '1',
    });
    const firstPage = await json<{ items: Note[]; nextCursor?: string }>(
      await server.request(`/api/notes?${query}`),
      200,
    );
    expect(firstPage.items.map((note) => [note.id, note.deckId])).toEqual([[first.id, left.id]]);
    expect(firstPage.nextCursor).toBeTruthy();
    query.set('cursor', firstPage.nextCursor!);
    const secondPage = await json<{ items: Note[]; nextCursor?: string }>(
      await server.request(`/api/notes?${query}`),
      200,
    );
    expect(secondPage.items.map((note) => [note.id, note.deckId])).toEqual([[second.id, right.id]]);
    expect(secondPage.nextCursor).toBeUndefined();
    for (const deckId of [deletedDeck.id, deletedFolder.id]) {
      query.delete('cursor');
      query.set('deckId', deckId);
      const page = await json<{ items: Note[] }>(await server.request(`/api/notes?${query}`), 200);
      expect(page.items).toEqual([]);
      expect((await repo.notes.list({ deckId, includeSubtree: false })).items).toEqual([]);
    }
    await repo.decks.restore(deletedFolder.id);
    query.delete('deckId');
    const restored = await json<{ items: Note[] }>(
      await server.request(`/api/notes?${query}`),
      200,
    );
    expect(restored.items.map((note) => note.id)).toEqual([hidden.id]);
  });

  it.each(['created', 'alpha', 'rank'] as const)(
    'pages tied %s keys by id and retains a soft-deleted cursor',
    async (sort) => {
      if (!database) return;
      const owner = `browse-library-ties-${sort}`;
      await createUser(database, owner);
      const repo = repositoriesFor(database, owner);
      const server = testServer(database, owner);
      const left = await repo.decks.create({ name: 'Left' });
      const right = await repo.decks.create({ name: 'Right' });
      const ids = [1, 2, 3, 4, 5].map(
        (value) =>
          `01900000-0000-7000-8000-${sort === 'created' ? '1' : sort === 'alpha' ? '2' : '3'}${String(value).padStart(11, '0')}`,
      );
      const inserted = await repo.notes.createMany(
        [...ids].reverse().map((id, index) => ({
          id,
          deckId: index % 2 ? left.id : right.id,
          noteType: 'vocab' as const,
          fields: { term: 'Same term', translation: 'Tied library marker' },
          tags: ['ties'],
          source: 'Tied search',
          rank: ids.indexOf(id) < 3 ? 7 : null,
        })),
      );
      expect(new Set(inserted.map((note) => note.createdAt.toISOString())).size).toBe(1);
      const query = new URLSearchParams({
        search: 'tied library marker',
        tag: 'ties',
        source: 'Tied search',
        status: 'active',
        sort,
        limit: '1',
      });
      for (const [index, id] of ids.entries()) {
        const page = await json<{ items: Note[]; nextCursor?: string }>(
          await server.request(`/api/notes?${query}`),
          200,
        );
        expect(page.items.map((note) => note.id)).toEqual([id]);
        expect(page.nextCursor).toBe(index < ids.length - 1 ? id : undefined);
        if (page.nextCursor) query.set('cursor', page.nextCursor);
        // Recovery keeps the sort key available even after the cursor leaves browsing.
        await repo.notes.softDelete(id!);
      }
    },
  );
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

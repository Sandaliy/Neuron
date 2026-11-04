import { beforeAll, describe, expect, it } from 'vitest';

import {
  noteCategoryPageSchema,
  possibleDuplicateGroupsPageSchema,
  possibleDuplicateNotesPageSchema,
} from '@neuron/shared';

import { createDb } from '../db/client.js';
import { createRepositories } from '../db/repositories/index.js';
import { possibleDuplicateRepository } from '../db/repositories/possible-duplicates.js';
import { transactionRunner } from '../db/repositories/session.js';
import {
  asUser,
  countingRepositories,
  createUser,
  rawAppPool,
  rawOwnerPool,
  repositoriesFor,
  testDatabase,
} from '../db/testing/database.js';
import { json, testServer } from '../testing/server.js';

const database = testDatabase();
const OWNER = 'possible-duplicates-owner';
const OTHER = 'possible-duplicates-other';
describe.skipIf(!database)('possible duplicate inspection through PostgreSQL and RLS', () => {
  let deckId: string;
  let otherDeck: string;
  let folderId: string;
  let hiddenDeck: string;
  let measured: ReturnType<typeof countingRepositories>;
  let api: ReturnType<typeof testServer>;
  const repo = () => measured.repositories;
  const server = () => api;
  const groups = async (query = '') =>
    possibleDuplicateGroupsPageSchema.parse(
      await json(await server().request(`/api/notes/possible-duplicates?${query}`), 200),
    );
  const members = async (key: string, query = '') =>
    possibleDuplicateNotesPageSchema.parse(
      await json(
        await server().request(
          `/api/notes/possible-duplicates/notes?key=${encodeURIComponent(key)}&${query}`,
        ),
        200,
      ),
    );
  beforeAll(async () => {
    await createUser(database!, OWNER);
    await createUser(database!, OTHER);
    measured = countingRepositories(database!, OWNER);
    api = testServer(database!, OWNER);
    folderId = (await repo().decks.create({ name: 'Long source folder', kind: 'folder' })).id;
    deckId = (await repo().decks.create({ name: 'Lesson A', parentId: folderId })).id;
    otherDeck = (await repo().decks.create({ name: 'Lesson B' })).id;
    const hidden = await repo().decks.create({ name: 'Unavailable', kind: 'folder' });
    hiddenDeck = (await repo().decks.create({ name: 'Hidden child', parentId: hidden.id })).id;
    await repo().notes.createMany([
      {
        deckId,
        noteType: 'vocab',
        fields: { term: '  Bank\t ', translation: 'financial institution' },
        source: 'Oxford',
        tags: ['shared', 'shared'],
      },
      {
        deckId,
        noteType: 'vocab',
        fields: { term: 'BANK', translation: 'river edge' },
        source: 'River',
        tags: ['shared'],
      },
      {
        deckId: otherDeck,
        noteType: 'basic',
        fields: { front: 'bank', back: 'a seat' },
        source: 'Lesson',
        tags: ['shared'],
      },
      { deckId: otherDeck, noteType: 'cloze', fields: { text: '{{bank}}', note: 'context' } },
      { deckId: otherDeck, noteType: 'basic', fields: { front: '{{bank}}', back: 'context' } },
      ...['schon', 'schön', '% literal', 'z deletion', 'zz after'].flatMap((term) => [
        { deckId, noteType: 'vocab' as const, fields: { term, translation: 'shared translation' } },
        {
          deckId: otherDeck,
          noteType: 'vocab' as const,
          fields: { term, translation: 'another meaning' },
        },
      ]),
      { deckId, noteType: 'vocab', fields: { term: 'unique', translation: 'river edge' } },
      { deckId, noteType: 'vocab', fields: { term: 'only once', translation: 'same' } },
      {
        deckId: hiddenDeck,
        noteType: 'vocab',
        fields: { term: 'only once', translation: 'hidden' },
        source: 'Hidden source',
        tags: ['shared'],
      },
      {
        deckId: hiddenDeck,
        noteType: 'vocab',
        fields: { term: 'hidden pair', translation: 'hidden' },
      },
      {
        deckId: hiddenDeck,
        noteType: 'vocab',
        fields: { term: 'hidden pair', translation: 'hidden' },
      },
    ]);
    const foreign = repositoriesFor(database!, OTHER);
    const foreignDeck = await foreign.decks.create({ name: 'Foreign' });
    await foreign.notes.createMany(
      Array.from({ length: 2 }, () => ({
        deckId: foreignDeck.id,
        noteType: 'vocab',
        fields: { term: 'foreign pair', translation: 'private' },
      })),
    );
    const owner = rawOwnerPool(database!);
    try {
      // Deliberately stale materialized paths and child tombstones exercise parent-link visibility.
      await owner.query('update decks set deleted_at = now() where id = $1', [hidden.id]);
      await owner.query('update decks set path = array[]::uuid[] where id = $1', [hiddenDeck]);
    } finally {
      await owner.end();
    }
  });

  it('groups exact normalized keys across types, Decks, sources and meanings', async () => {
    const page = await groups();
    expect(page.items.find((group) => group.key === 'bank')?.count).toBe(3);
    expect(page.items.map((group) => group.key)).toContain('schon');
    expect(page.items.map((group) => group.key)).toContain('schön');
    expect(page.items.map((group) => group.key)).not.toContain('unique');
    const notes = await members('bank');
    expect(notes.items.map((note) => note.noteType).sort()).toEqual(['basic', 'vocab', 'vocab']);
    expect(notes.items.find((note) => note.source === 'Oxford')?.deckPath).toEqual([
      'Long source folder',
      'Lesson A',
    ]);
    expect(notes.items.some((note) => note.fields['translation'] === 'river edge')).toBe(true);
    expect((await groups(`deckId=${deckId}`)).items).toEqual([{ key: 'bank', count: 2 }]);
  });

  it('keeps category counts and exact Note filters consistent with duplicate members', async () => {
    const categories = async (kind: 'tag' | 'source') =>
      noteCategoryPageSchema.parse(
        await json(await server().request(`/api/notes/categories?kind=${kind}`), 200),
      );
    expect((await categories('tag')).items).toEqual([{ value: 'shared', count: 3 }]);
    const filtered = await json<{ items: { id: string }[] }>(
      await server().request('/api/notes?tag=shared'),
      200,
    );
    expect(filtered.items.map((note) => note.id).sort()).toEqual(
      (await members('bank')).items.map((note) => note.id).sort(),
    );
    const sources = await categories('source');
    expect(sources.items).toEqual([
      { value: 'Lesson', count: 1 },
      { value: 'Oxford', count: 1 },
      { value: 'River', count: 1 },
    ]);
    const oxford = await json<{ items: { id: string }[] }>(
      await server().request('/api/notes?source=Oxford'),
      200,
    );
    expect(oxford.items.map((note) => note.id)).toEqual(
      (await members('bank')).items
        .filter((note) => note.source === 'Oxford')
        .map((note) => note.id),
    );
  });

  it('searches full groups by member meaning, source, path and literal wildcard', async () => {
    for (const search of ['river edge', 'Oxford', 'Long source folder']) {
      const page = await groups(`search=${encodeURIComponent(search)}`);
      expect(page.items.find((group) => group.key === 'bank')?.count).toBe(3);
    }
    expect((await groups('search=%25')).items).toEqual([{ key: '% literal', count: 2 }]);
  });

  it('excludes deleted, purged, inaccessible and foreign content at both read boundaries', async () => {
    const deleted = await repo().notes.createMany(
      ['deleted', 'purged'].flatMap((term) =>
        Array.from({ length: 2 }, () => ({
          deckId,
          noteType: 'vocab' as const,
          fields: { term, translation: 'hidden' },
        })),
      ),
    );
    const owner = rawOwnerPool(database!);
    try {
      await owner.query(
        'update notes set deleted_at = now(), purged_at = case when term_key = $1 then now() else null end where id = any($2::uuid[])',
        ['purged', deleted.map((note) => note.id)],
      );
    } finally {
      await owner.end();
    }
    for (const key of ['deleted', 'purged', 'hidden pair', 'foreign pair', 'only once'])
      expect((await members(key)).items).toEqual([]);
    expect((await groups()).items.map((group) => group.key)).not.toEqual(
      expect.arrayContaining(['hidden pair', 'foreign pair', 'deleted', 'purged']),
    );
    expect((await groups(`deckId=${hiddenDeck}`)).items).toEqual([]);
    const pool = rawAppPool(database!);
    try {
      expect(
        (await asUser(pool, OWNER, (tx) => tx.query('select distinct user_id from notes'))).rows,
      ).toEqual([{ user_id: OWNER }]);
      expect((await asUser(pool, null, (tx) => tx.query('select id from notes'))).rows).toEqual([]);
    } finally {
      await pool.end();
    }
    const mismatched = possibleDuplicateRepository(
      OTHER,
      transactionRunner(createDb(database!.appUrl), OWNER),
    );
    expect((await mismatched.groups({ limit: 50 })).items).toEqual([]);
    expect((await mismatched.notes({ key: 'foreign pair', limit: 100 })).items).toEqual([]);
  });

  it('uses value cursors when the preceding group disappears or changes', async () => {
    const first = await groups('search=z&limit=1');
    expect(first.nextCursor).toBe('z deletion');
    const previous = await members('z deletion');
    for (const note of previous.items) await repo().notes.softDelete(note.id);
    expect(
      (await groups(`search=z&limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`)).items,
    ).toEqual([{ key: 'zz after', count: 2 }]);
    const notes = await members('bank', 'limit=1');
    const next = await members('bank', `limit=1&cursor=${notes.nextCursor}`);
    expect(next.items[0]?.id).not.toBe(notes.items[0]?.id);
    await repo().notes.updateFields(notes.items[0]!.id, {
      term: 'Changed term',
      translation: 'changed meaning',
    });
    expect((await members('bank', `limit=1&cursor=${notes.nextCursor}`)).items[0]?.id).toBe(
      next.items[0]?.id,
    );
  });

  it('bounds responses and statements over 6500 Notes without reading Cards', async () => {
    await repo().notes.createMany(
      Array.from({ length: 6500 }, (_, at) => ({
        deckId: at % 2 ? deckId : otherDeck,
        noteType: 'vocab',
        fields: {
          term:
            at < 1500 ? 'large group' : at < 5500 ? `unique ${at}` : `pair ${Math.floor(at / 2)}`,
          translation: `meaning ${at}`,
        },
      })),
    );
    const statements: { query: string; params: unknown[] }[] = [];
    const observed = createRepositories(
      createDb(database!.appUrl, {
        logger: {
          logQuery(query, params) {
            statements.push({ query, params });
          },
        },
      }),
      OWNER,
    );
    const started = performance.now();
    const page = await observed.possibleDuplicates.groups({ limit: 50 });
    const groupMs = performance.now() - started;
    const memberStarted = performance.now();
    const memberPage = await observed.possibleDuplicates.notes({ key: 'large group', limit: 100 });
    const memberMs = performance.now() - memberStarted;
    expect(page.items).toHaveLength(50);
    expect(memberPage.items).toHaveLength(100);
    expect(memberPage.nextCursor).toBeDefined();
    expect(
      memberPage.items.every(
        (note) => note.cardStates === undefined && note.studyCards === undefined,
      ),
    ).toBe(true);
    // BEGIN, account context, one SELECT and COMMIT per repository call.
    expect(statements.length).toBeLessThanOrEqual(8);
    expect(
      statements.every(({ query }) => !/\b(cards|reviews|update|insert|delete)\b/i.test(query)),
    ).toBe(true);
    const pool = rawAppPool(database!);
    const plans: number[] = [];
    try {
      for (const statement of statements.filter(({ query }) => query.includes('with recursive'))) {
        const explained = await asUser(pool, OWNER, (tx) =>
          tx.query(`explain (analyze, buffers, format json) ${statement.query}`, statement.params),
        );
        plans.push(Number(explained.rows[0]['QUERY PLAN'][0]['Execution Time']));
      }
    } finally {
      await pool.end();
    }
    const ids = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await repo().possibleDuplicates.notes({
        key: 'large group',
        limit: 200,
        ...(cursor ? { cursor } : {}),
      });
      for (const note of page.items) {
        expect(ids.has(note.id)).toBe(false);
        ids.add(note.id);
      }
      cursor = page.nextCursor;
    } while (cursor);
    expect(ids.size).toBe(1500);
    const keys = new Set<string>();
    cursor = undefined;
    do {
      const page = await repo().possibleDuplicates.groups({
        limit: 77,
        search: 'pair',
        ...(cursor ? { cursor } : {}),
      });
      for (const group of page.items) {
        expect(keys.has(group.key)).toBe(false);
        keys.add(group.key);
      }
      cursor = page.nextCursor;
    } while (cursor);
    expect(keys.size).toBe(500);
    console.info(
      `Duplicate query benchmark: 6500+ Notes; groups ${groupMs.toFixed(1)} ms; 100 members ${memberMs.toFixed(1)} ms; PostgreSQL execution ${plans.join(' / ')} ms`,
    );
  });

  it('accepts the complete PostgreSQL key for long supplementary-Unicode terms', async () => {
    const prefix = '😀'.repeat(200);
    await repo().notes.createMany(
      ['a', 'b'].map((ending) => ({
        deckId,
        noteType: 'vocab',
        fields: { term: prefix + ending, translation: ending },
      })),
    );
    const page = await groups(`search=${encodeURIComponent('😀')}`);
    expect(page.items).toEqual([{ key: prefix, count: 2 }]);
    expect((await members(prefix)).items).toHaveLength(2);
  });

  it('rejects oversized or malformed pages, scopes and cursors', async () => {
    for (const query of [
      'limit=101',
      'limit=0',
      'deckId=other',
      'cursor=',
      `cursor=${'a'.repeat(201)}`,
    ])
      expect((await server().request(`/api/notes/possible-duplicates?${query}`)).status).toBe(400);
    expect(
      (await server().request('/api/notes/possible-duplicates/notes?key=bank&cursor=wrong')).status,
    ).toBe(400);
  });
});

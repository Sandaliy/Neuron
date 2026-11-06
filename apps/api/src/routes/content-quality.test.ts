import { beforeAll, describe, expect, it } from 'vitest';

import { CONTENT_CHECKS, contentChecks, contentQualityPageSchema } from '@neuron/shared';
import type { NoteTypeName } from '@neuron/shared';

import { createDb } from '../db/client.js';
import { contentQualityRepository } from '../db/repositories/content-quality.js';
import { createRepositories } from '../db/repositories/index.js';
import { transactionRunner } from '../db/repositories/session.js';
import {
  asUser,
  createUser,
  rawAppPool,
  rawOwnerPool,
  repositoriesFor,
  testDatabase,
} from '../db/testing/database.js';
import { json, testServer } from '../testing/server.js';

const database = testDatabase();
const OWNER = 'content-quality-owner';
const OTHER = 'content-quality-other';
describe.skipIf(!database)('content checks through real PostgreSQL and restricted RLS', () => {
  let deckId: string;
  let otherDeck: string;
  let hiddenDeck: string;
  const repo = () => repositoriesFor(database!, OWNER);
  const inspect = async (query = '') =>
    contentQualityPageSchema.parse(
      await json(
        await testServer(database!, OWNER).request(`/api/notes/content-quality?${query}`),
        200,
      ),
    );
  beforeAll(async () => {
    await createUser(database!, OWNER);
    await createUser(database!, OTHER);
    const folder = await repo().decks.create({ name: 'Imported context', kind: 'folder' });
    deckId = (await repo().decks.create({ name: 'Lesson A', parentId: folder.id })).id;
    otherDeck = (await repo().decks.create({ name: 'Lesson B' })).id;
    const hidden = await repo().decks.create({ name: 'Unavailable', kind: 'folder' });
    hiddenDeck = (await repo().decks.create({ name: 'Hidden child', parentId: hidden.id })).id;
    await repo().notes.createMany([
      {
        deckId,
        noteType: 'vocab',
        fields: { term: 'Orphan', translation: 'meaning', exampleTranslation: 'translated source' },
        source: '100%_literal',
        status: 'known',
      },
      {
        deckId: otherDeck,
        noteType: 'vocab',
        fields: { term: 'Example', translation: 'meaning', example: 'Example sentence' },
        status: 'draft',
      },
      {
        deckId,
        noteType: 'vocab',
        fields: { term: 'Bare', translation: 'meaning' },
        tags: ['topic'],
        status: 'suspended',
      },
      {
        deckId: otherDeck,
        noteType: 'vocab',
        fields: {
          term: 'Full',
          translation: 'meaning',
          example: 'source',
          exampleTranslation: 'translation',
          definition: 'definition',
        },
      },
      { deckId, noteType: 'basic', fields: { front: 'Q', back: 'A' } },
      { deckId, noteType: 'cloze', fields: { text: 'A {{gap}}.' } },
      { deckId: hiddenDeck, noteType: 'vocab', fields: { term: 'Hidden', translation: 'hidden' } },
    ]);
    const foreign = repositoriesFor(database!, OTHER);
    const foreignDeck = await foreign.decks.create({ name: 'Foreign' });
    await foreign.notes.create({
      deckId: foreignDeck.id,
      noteType: 'vocab',
      fields: { term: 'Private', translation: 'private' },
    });
    const owner = rawOwnerPool(database!);
    try {
      await owner.query('update decks set deleted_at = now() where id = $1', [hidden.id]);
      await owner.query('update decks set path = array[]::uuid[] where id = $1', [hiddenDeck]);
    } finally {
      await owner.end();
    }
  });

  it('counts overlapping checks once per Note and leaves valid optional omissions outside validation', async () => {
    const summary = await inspect();
    expect(summary.vocabularyCount).toBe(4);
    expect(summary.items).toEqual([]);
    expect(summary.counts).toEqual({
      'translation-without-example': 1,
      'example-without-translation': 1,
      'missing-example': 2,
      'missing-definition': 3,
    });
    for (const category of CONTENT_CHECKS) {
      const page = await inspect(`category=${category}`);
      expect(page.items.length).toBe(summary.counts[category]);
      expect(
        page.items.every((note) => contentChecks(note.noteType, note.fields).includes(category)),
      ).toBe(true);
      expect(page.items.every((note) => note.noteType === 'vocab')).toBe(true);
    }
    const orphan = await inspect('category=translation-without-example');
    expect(orphan.items[0]?.deckPath).toEqual(['Imported context', 'Lesson A']);
  });
  it('applies search and Deck to counts and results, including literal SQL wildcards', async () => {
    for (const search of ['100%_', 'translated source', 'Imported context', 'topic', 'MEANING']) {
      const page = await inspect(
        `category=missing-example&search=${encodeURIComponent(search)}&deckId=${deckId}`,
      );
      expect(page.items.length).toBe(page.counts['missing-example']);
      expect(page.items.length).toBeGreaterThan(0);
      expect(page.items.every((note) => note.deckId === deckId)).toBe(true);
    }
    expect((await inspect('search=100%25_')).vocabularyCount).toBe(1);
    expect((await inspect('search=absent')).vocabularyCount).toBe(0);
  });
  it('uses an identity cursor after deletion of its boundary and reflects edited content', async () => {
    const first = await inspect('category=missing-definition&limit=1');
    const id = first.items[0]!.id;
    const note = await repo().notes.byId(id);
    await repo().notes.updateFields(id, { ...note!.fields, definition: 'Added context' });
    expect(
      (await inspect('category=missing-definition')).items.some((note) => note.id === id),
    ).toBe(false);
    await repo().notes.softDelete(id);
    const next = await inspect(`category=missing-definition&limit=1&cursor=${first.nextCursor}`);
    expect(next.items).toHaveLength(1);
    expect(next.items[0]!.id > id).toBe(true);
    expect(next.counts['missing-definition']).toBe(2);
  });
  it('excludes tombstones, unavailable ancestry, foreign scopes and mismatched repository context', async () => {
    const rows = await repo().notes.createMany(
      ['deleted', 'purged'].map((term) => ({
        deckId,
        noteType: 'vocab' as const,
        fields: { term, translation: 'hidden' },
      })),
    );
    const owner = rawOwnerPool(database!);
    try {
      await owner.query(
        'update notes set deleted_at = now(), purged_at = case when id = $1 then now() else null end where id = any($2::uuid[])',
        [rows[1]!.id, rows.map((note) => note.id)],
      );
    } finally {
      await owner.end();
    }
    expect((await inspect(`deckId=${hiddenDeck}&category=missing-example`)).vocabularyCount).toBe(
      0,
    );
    const page = await inspect('category=missing-example');
    expect(
      page.items.some((note) =>
        ['Hidden', 'Private', 'deleted', 'purged'].includes(String(note.fields['term'])),
      ),
    ).toBe(false);
    const mismatched = contentQualityRepository(
      OTHER,
      transactionRunner(createDb(database!.appUrl), OWNER),
    );
    expect(
      (await mismatched.inspect({ limit: 100, category: 'missing-example' })).vocabularyCount,
    ).toBe(0);
    const pool = rawAppPool(database!);
    try {
      expect(
        (await asUser(pool, OWNER, (tx) => tx.query('select distinct user_id from notes'))).rows,
      ).toEqual([{ user_id: OWNER }]);
      expect((await asUser(pool, null, (tx) => tx.query('select id from notes'))).rows).toEqual([]);
      const role = await pool.query(
        'select rolsuper, rolbypassrls from pg_roles where rolname = current_user',
      );
      expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    } finally {
      await pool.end();
    }
  });
  it('treats whitespace-only optional context as absent in the same way as the local rules', async () => {
    const note = await repo().notes.create({
      deckId,
      noteType: 'vocab',
      fields: { term: 'Whitespace', translation: 'meaning' },
    });
    const fields = {
      term: 'Whitespace',
      translation: 'meaning',
      example: '\u00a0\ufeff\u3000\n\t',
      exampleTranslation: 'text',
      definition: ' ',
    };
    const owner = rawOwnerPool(database!);
    try {
      await owner.query('update notes set fields = $1::jsonb where id = $2', [
        JSON.stringify(fields),
        note.id,
      ]);
    } finally {
      await owner.end();
    }
    for (const category of CONTENT_CHECKS) {
      const page = await inspect(`search=Whitespace&category=${category}`);
      expect(page.counts[category]).toBe(contentChecks('vocab', fields).includes(category) ? 1 : 0);
      expect(page.items.length).toBe(page.counts[category]);
    }
  });
  it('bounds pages and executes the actual production plans over 6500 mixed Notes', async () => {
    const bulkOwner = 'content-quality-benchmark';
    await createUser(database!, bulkOwner);
    const bulk = repositoriesFor(database!, bulkOwner);
    const folder = await bulk.decks.create({ name: 'Large import', kind: 'folder' });
    const decks: string[] = [];
    for (let at = 0; at < 12; at++)
      decks.push((await bulk.decks.create({ name: `Deck ${at}`, parentId: folder.id })).id);
    const input = Array.from({ length: 6500 }, (_, at) => ({
      deckId: decks[at % decks.length]!,
      noteType: (at < 5500 ? 'vocab' : at < 6000 ? 'basic' : 'cloze') as NoteTypeName,
      fields:
        at < 5500
          ? {
              term: `Word ${at}`,
              translation: `meaning ${at}`,
              ...(at % 4 < 2 ? { example: 'An example sentence. '.repeat(12) } : {}),
              ...(at % 4 === 0 || at % 4 === 2
                ? { exampleTranslation: 'Translation of context. '.repeat(8) }
                : {}),
              ...(at % 4 === 0 ? { definition: 'Definition. '.repeat(12) } : {}),
            }
          : at < 6000
            ? { front: `Question ${at}`, back: 'Answer' }
            : { text: `A {{gap ${at}}}.` },
      source: `Source ${at % 5}`,
      tags: ['imported', `topic ${at % 50}`],
    }));
    await bulk.notes.createMany(input);
    const statements: { query: string; params: unknown[] }[] = [];
    const observed = createRepositories(
      createDb(database!.appUrl, {
        logger: {
          logQuery(query, params) {
            statements.push({ query, params });
          },
        },
      }),
      bulkOwner,
    );
    const started = performance.now();
    const first = await observed.contentQuality.inspect({
      category: 'missing-definition',
      limit: 100,
    });
    const elapsedMs = performance.now() - started;
    expect(first.vocabularyCount).toBe(5500);
    for (const category of CONTENT_CHECKS)
      expect(first.counts[category]).toBe(
        input.filter((note) => contentChecks(note.noteType, note.fields).includes(category)).length,
      );
    expect(first.items).toHaveLength(100);
    await observed.contentQuality.inspect({ limit: 100 });
    await observed.contentQuality.inspect({
      category: 'missing-definition',
      cursor: first.nextCursor!,
      limit: 100,
    });
    await observed.contentQuality.inspect({
      category: 'missing-example',
      deckId: decks[0]!,
      search: 'meaning 12',
      limit: 100,
    });
    expect(statements.length).toBeLessThanOrEqual(16);
    expect(
      statements.every(({ query }) => !/\b(cards|reviews|update|insert|delete)\b/i.test(query)),
    ).toBe(true);
    const pool = rawAppPool(database!);
    const plans: unknown[] = [];
    try {
      for (const statement of statements.filter(({ query }) => query.includes('with recursive'))) {
        const explained = await asUser(pool, bulkOwner, (tx) =>
          tx.query(`explain (analyze, buffers, format json) ${statement.query}`, statement.params),
        );
        const plan = explained.rows[0]['QUERY PLAN'][0];
        const nodes: string[] = [];
        const visit = (node: Record<string, unknown>) => {
          nodes.push(
            `${node['Node Type']}:${node['Relation Name'] ?? node['CTE Name'] ?? ''}:${node['Actual Rows']}`,
          );
          for (const child of (node['Plans'] ?? []) as Record<string, unknown>[]) visit(child);
        };
        visit(plan['Plan']);
        plans.push({
          executionMs: plan['Execution Time'],
          sharedHits: plan['Plan']['Shared Hit Blocks'],
          tempWrites: plan['Plan']['Temp Written Blocks'],
          nodes,
        });
        expect(Number(plan['Execution Time'])).toBeLessThan(500);
        expect(Number(plan['Plan']['Temp Written Blocks'])).toBe(0);
      }
    } finally {
      await pool.end();
    }
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await bulk.contentQuality.inspect({
        category: 'missing-definition',
        limit: 200,
        ...(cursor ? { cursor } : {}),
      });
      for (const note of page.items) {
        expect(seen.has(note.id)).toBe(false);
        seen.add(note.id);
      }
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen.size).toBe(first.counts['missing-definition']);
    console.info(
      JSON.stringify({
        contentQualityBenchmark: true,
        notes: 6500,
        vocabulary: 5500,
        firstPageMs: elapsedMs,
        plans,
      }),
    );
  });
  it('rejects malformed categories, cursors, scopes and oversized requests', async () => {
    for (const query of [
      'category=invalid',
      'cursor=wrong',
      'deckId=wrong',
      'limit=0',
      'limit=201',
      `search=${'x'.repeat(101)}`,
    ])
      expect(
        (await testServer(database!, OWNER).request(`/api/notes/content-quality?${query}`)).status,
      ).toBe(400);
  });
});

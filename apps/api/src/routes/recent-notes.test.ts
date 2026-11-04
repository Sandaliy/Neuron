import { Pool } from '@neondatabase/serverless';
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { uuidV7 } from '@neuron/shared';
import type { Note, RecentNoteSort } from '@neuron/shared';

import { noteBrowseStatement } from '../db/repositories/notes.js';
import { nameUser } from '../db/repositories/session.js';
import { appClient, createUser, repositoriesFor, testDatabase } from '../db/testing/database.js';
import { json, testServer } from '../testing/server.js';

const database = testDatabase();
const owner = 'recent-browser';
const foreign = 'recent-foreign';
const id = (n: number) => `01800000-0000-7000-8000-${String(n).padStart(12, '0')}`;

describe.skipIf(!database)('recent Note browsing', () => {
  const repo = database ? repositoriesFor(database, owner) : undefined!;
  const server = database ? testServer(database, owner) : undefined!;
  let deckId: string;
  let secondDeck: string;
  async function page(sort: string, cursor?: string, extra: Record<string, string> = {}) {
    return json<{ items: Note[]; nextCursor?: string }>(
      await server.request(
        `/api/notes?${new URLSearchParams({ sort, limit: '2', ...extra, ...(cursor ? { cursor } : {}) })}`,
      ),
      200,
    );
  }
  beforeAll(async () => {
    if (!database) return;
    await createUser(database, owner);
    await createUser(database, foreign);
    deckId = (await repo.decks.create({ name: 'Recent one' })).id;
    secondDeck = (await repo.decks.create({ name: 'Recent two' })).id;
    await repo.notes.createMany(
      Array.from({ length: 6 }, (_, at) => ({
        id: id(at + 1),
        deckId: at % 2 ? deckId : secondDeck,
        noteType: 'basic',
        fields: { front: 'Recent ' + (at + 1), back: 'Meaning' },
        tags: ['recent'],
      })),
    );
    const pool = new Pool({ connectionString: database.ownerUrl });
    try {
      await pool.query(
        `update notes set created_at = case when id = $2 then '2026-01-02T00:00:00.000001Z'::timestamptz else '2026-01-01T00:00:00.000002Z'::timestamptz end, updated_at = '2026-01-01T00:00:00.000002Z' where user_id = $1`,
        [owner, id(1)],
      );
    } finally {
      await pool.end();
    }
  });

  it('uses actual creation instants and sub-millisecond ties while preserving file order', async () => {
    const first = await page('created-desc');
    expect(first.items.map((row) => row.id)).toEqual([id(1), id(6)]);
    expect(first.items[0]!.createdAt).toBe('2026-01-02T00:00:00.000001Z');
    const seen = [...first.items];
    let cursor = first.nextCursor;
    while (cursor) {
      const next = await page('created-desc', cursor);
      seen.push(...next.items);
      cursor = next.nextCursor;
    }
    expect(seen.map((row) => row.id)).toEqual([1, 6, 5, 4, 3, 2].map(id));
    expect((await page('created', undefined, { limit: '10' })).items.map((row) => row.id)).toEqual(
      [1, 2, 3, 4, 5, 6].map(id),
    );
  });

  it('keeps captured boundaries through bulk status/tag changes, moves and deletion', async () => {
    const first = await page('updated-desc');
    expect(first.items.map((row) => row.id)).toEqual([id(6), id(5)]);
    await repo.notes.setStatusMany([id(5), id(2)], 'known');
    await repo.notes.tagMany([id(1), id(3)], { add: ['bulk'] });
    await repo.notes.moveMany([id(4)], secondDeck);
    expect((await page('updated-desc', first.nextCursor)).items).toEqual([]);
    const changed = await page('updated-desc', undefined, {
      tag: 'bulk',
      search: 'Recent',
      limit: '10',
    });
    expect(changed.items.map((row) => row.id).sort()).toEqual([id(1), id(3)]);
    expect(
      (await page('updated-desc', undefined, { status: 'known', limit: '10' })).items
        .map((row) => row.id)
        .sort(),
    ).toEqual([id(2), id(5)]);
    const current = await page('created-desc');
    await repo.notes.softDelete(id(6));
    expect((await page('created-desc', current.nextCursor)).items.map((row) => row.id)).toEqual([
      id(5),
      id(4),
    ]);
  });

  it('shows real imported Notes by arrival time and retains their supplied creation order', async () => {
    const batch = await json<{ import: { id: string } }>(
      await server.request('/api/imports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: uuidV7(), deckId, source: 'Recent import', format: 'json' }),
      }),
      201,
    );
    const imported = [
      '01000000-0000-7000-8000-000000000001',
      '01000000-0000-7000-8000-000000000002',
    ];
    await json(
      await server.request(`/api/imports/${batch.import.id}/notes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          notes: imported.map((id, i) => ({
            id,
            noteType: 'basic',
            fields: { front: 'Import ' + i, back: 'Meaning' },
          })),
        }),
      }),
      200,
    );
    expect(
      (await page('created-desc', undefined, { source: 'Recent import' })).items.map(
        (row) => row.id,
      ),
    ).toEqual([...imported].reverse());
    expect(
      (await page('created', undefined, { source: 'Recent import' })).items.map((row) => row.id),
    ).toEqual(imported);
  });

  it('excludes foreign, deleted, purged and inaccessible ancestry under RLS and validates cursors', async () => {
    if (!database) return;
    const other = repositoriesFor(database, foreign);
    const otherDeck = (await other.decks.create({ name: 'Foreign recent' })).id;
    const otherNote = await other.notes.create({
      deckId: otherDeck,
      noteType: 'basic',
      fields: { front: 'Hidden', back: 'Meaning' },
    });
    const folder = await repo.decks.create({ name: 'Hidden recent', kind: 'folder' });
    const hiddenDeck = await repo.decks.create({ name: 'Hidden leaf', parentId: folder.id });
    const hiddenNote = await repo.notes.create({
      deckId: hiddenDeck.id,
      noteType: 'basic',
      fields: { front: 'Hidden', back: 'Meaning' },
    });
    const pool = new Pool({ connectionString: database.ownerUrl });
    try {
      await pool.query('update decks set deleted_at = now() where id = $1', [folder.id]);
      await pool.query('update notes set purged_at = now() where id = $1', [id(6)]);
    } finally {
      await pool.end();
    }
    for (const sort of ['created-desc', 'updated-desc'] as const) {
      const all = await page(sort, undefined, { limit: '100' });
      for (const hidden of [otherNote.id, hiddenNote.id, id(6)])
        expect(all.items.map((row) => row.id)).not.toContain(hidden);
      const rows = await appClient(database).transaction(async (tx) => {
        await nameUser(tx, foreign);
        return noteBrowseStatement(tx, owner, { sort });
      });
      expect(rows).toEqual([]);
    }
    expect((await server.request('/api/notes?sort=updated-desc&cursor=not-a-cursor')).status).toBe(
      400,
    );
    const created = await page('created-desc');
    expect(
      (
        await server.request(
          `/api/notes?${new URLSearchParams({ sort: 'updated-desc', cursor: created.nextCursor! })}`,
        )
      ).status,
    ).toBe(400);
  });

  it.each(['created-desc', 'updated-desc'] as const)(
    'bounds the production %s statement over 6000 Notes under RLS',
    async (sort: RecentNoteSort) => {
      if (!database) return;
      const benchmarkOwner = `recent-benchmark-${sort}`;
      await createUser(database, benchmarkOwner);
      const pool = new Pool({ connectionString: database.ownerUrl });
      try {
        await pool.query(
          `insert into decks (id, user_id, name, position) select gen_random_uuid(), $1, 'Deck ' || n, n from generate_series(1,80) n`,
          [benchmarkOwner],
        );
        await pool.query(
          `with destinations as (select array_agg(id order by position) ids from decks where user_id = $1)
        insert into notes (id,user_id,deck_id,note_type_id,fields,created_at,updated_at)
        select gen_random_uuid(), $1, ids[1 + n % 80], (select id from note_types where name = 'basic' and user_id is null),
        jsonb_build_object('front','Word ' || n,'back','Meaning'), now() - n * interval '1 millisecond', now() - n * interval '1 millisecond' from generate_series(1,6000) n cross join destinations`,
          [benchmarkOwner],
        );
        await pool.query('analyze notes');
      } finally {
        await pool.end();
      }
      for (const cursor of [
        undefined,
        (await repositoriesFor(database, benchmarkOwner).notes.list({ sort, limit: 1000 }))
          .nextCursor,
      ]) {
        const result = await appClient(database).transaction(async (tx) => {
          await nameUser(tx, benchmarkOwner);
          return tx.execute<{ 'QUERY PLAN': Array<Record<string, unknown>> }>(
            sql`explain (analyze, buffers, format json) ${noteBrowseStatement(tx, benchmarkOwner, { sort, limit: 1000, cursor })}`,
          );
        });
        const plan = result.rows[0]!['QUERY PLAN'][0]!;
        const nodes: unknown[] = [];
        const inspect = (node: Record<string, unknown>) => {
          nodes.push({
            node: node['Node Type'],
            index: node['Index Name'],
            relation: node['Relation Name'],
            rows: node['Actual Rows'],
            loops: node['Actual Loops'],
          });
          for (const child of (node['Plans'] ?? []) as Record<string, unknown>[]) inspect(child);
        };
        inspect(plan['Plan'] as Record<string, unknown>);
        console.info(
          JSON.stringify({ sort, laterPage: !!cursor, executionMs: plan['Execution Time'], nodes }),
        );
        expect((plan['Plan'] as Record<string, unknown>)['Actual Rows']).toBe(1001);
        expect((plan['Plan'] as Record<string, unknown>)['Temp Written Blocks']).toBe(0);
        expect(JSON.stringify(nodes)).not.toContain('"relation":"cards"');
      }
    },
  );
});

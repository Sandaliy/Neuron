import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { uuidV7 } from '@neuron/shared';

import { rawOwnerPool, testDatabase } from './testing/database.js';

const database = testDatabase();
const migration = readFileSync(
  new URL('../../drizzle/0012_collection_integrity.sql', import.meta.url),
  'utf8',
);

describe.skipIf(!database)('legacy collection migration', () => {
  for (const deleted of [false, true]) {
    it(`preserves mixed ${deleted ? 'deleted' : 'live'} nodes, notes, cards and review history`, async () => {
      const pool = rawOwnerPool(database!);
      const connection = await pool.connect();
      const root = uuidV7(),
        child = uuidV7(),
        note = uuidV7(),
        card = uuidV7(),
        review = uuidV7(),
        leaf = uuidV7();
      try {
        await connection.query('begin');
        await connection.query(`create schema migration_fixture;
          set local search_path = migration_fixture;
          create table "user"(id text primary key, current_rev bigint not null default 0);
          create table decks(id uuid primary key,user_id text not null,parent_id uuid references decks(id),name text not null,
            position integer not null default 0,path uuid[] not null default '{}',settings jsonb,
            created_at timestamptz default now(),updated_at timestamptz default now(),deleted_at timestamptz,rev bigint default 0,
            constraint decks_name_not_blank check(length(btrim(name))>0));
          create table notes(id uuid primary key,user_id text,deck_id uuid references decks(id),fields jsonb,deleted_at timestamptz,rev bigint default 0);
          create table cards(id uuid primary key,user_id text,note_id uuid references notes(id),deck_id uuid references decks(id),
            stability double precision,due timestamptz,deleted_at timestamptz,rev bigint default 0);
          create table reviews(id uuid primary key,card_id uuid references cards(id),rating text,reviewed_at timestamptz);
          create table import_batches(id uuid primary key,user_id text,deck_id uuid references decks(id),rev bigint default 0);
          create table sync_conflicts(id uuid primary key,user_id text,entity text,entity_id uuid,losing jsonb,kept jsonb);
          insert into "user" values('legacy',7);`);
        await connection.query(
          `insert into decks(id,user_id,name,deleted_at) values($1,'legacy','Deutsch',$2),($3,'legacy','Oxford 5000',null)`,
          [root, deleted ? new Date() : null, leaf],
        );
        await connection.query(
          `insert into decks(id,user_id,parent_id,name,path) values($1,'legacy',$2,'B1',array[]::uuid[])`,
          [child, root],
        );
        await connection.query(
          `insert into notes(id,user_id,deck_id,fields) values($1,'legacy',$2,'{"front":"Question","back":"Answer"}')`,
          [note, root],
        );
        await connection.query(
          `insert into cards(id,user_id,note_id,deck_id,stability,due) values($1,'legacy',$2,$3,13.123456789,now())`,
          [card, note, root],
        );
        await connection.query(`insert into reviews values($1,$2,'good',now())`, [review, card]);
        const before = (await connection.query('select * from reviews')).rows;
        const beforeCard = (await connection.query('select id,note_id,stability,due from cards'))
          .rows;
        await connection.query(migration);
        const rows = (await connection.query('select * from decks')).rows;
        expect(rows).toHaveLength(4);
        const original = rows.find((row) => row.id === root);
        const generated = rows.find((row) => row.id !== child && row.parent_id === root);
        expect(original.kind).toBe('folder');
        expect(generated.kind).toBe('deck');
        expect(generated.name).toBe('Deutsch');
        expect(generated.deleted_at).toEqual(original.deleted_at);
        expect(rows.find((row) => row.id === leaf).kind).toBe('deck');
        expect(rows.find((row) => row.id === child).path).toEqual([root]);
        expect((await connection.query('select deck_id from notes')).rows[0]?.deck_id).toBe(
          generated.id,
        );
        expect((await connection.query('select deck_id from cards')).rows[0]?.deck_id).toBe(
          generated.id,
        );
        expect((await connection.query('select id,note_id,stability,due from cards')).rows).toEqual(
          beforeCard,
        );
        expect((await connection.query('select * from reviews')).rows).toEqual(before);
      } finally {
        await connection.query('rollback');
        connection.release();
        await pool.end();
      }
    });
  }
});

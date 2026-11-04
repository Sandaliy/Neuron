import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyMigrations } from '../migrate/main.js';
import { installSystemNoteTypes } from '../system-note-types.js';
import { withPool } from '../tooling.js';

import { inspectMigrationJournal } from './journal-verification.js';
import { ensureProductionMigrations } from './production.js';

const configured = Boolean(process.env['DATABASE_URL_TEST'] && process.env['DATABASE_URL']);
const databaseName = `neuron_recent_indexes_${process.pid}_${Date.now()}`;
const migrations = fileURLToPath(new URL('../../../drizzle', import.meta.url));
const tip = '0019_recent_note_order';
const copies: string[] = [];
let ownerUrl = '';
let appUrl = '';
let baseline: unknown;

function migrationCopy(behind = false) {
  const folder = mkdtempSync(join(tmpdir(), 'neuron-recent-migration-'));
  copies.push(folder);
  cpSync(migrations, folder, { recursive: true });
  if (behind) {
    const journalFile = join(folder, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalFile, 'utf8')) as { entries: { tag: string }[] };
    expect(journal.entries.at(-1)?.tag).toBe(tip);
    journal.entries.pop();
    writeFileSync(journalFile, JSON.stringify(journal));
  }
  return folder;
}

function sqlState(error: unknown): unknown {
  if (!error || typeof error !== 'object') return undefined;
  if ('code' in error) return error.code;
  return 'cause' in error ? sqlState(error.cause) : undefined;
}

async function fingerprint() {
  return withPool(ownerUrl, async (pool) => {
    const rows = [];
    for (const table of ['notes', 'cards', 'reviews', 'decks', 'user']) {
      const result = await pool.query(
        `select count(*)::int as count, md5(string_agg(row_to_json(t)::text, '' order by id)) as digest from "${table}" t`,
      );
      rows.push({ table, ...result.rows[0] });
    }
    return rows;
  });
}

async function recentIndexes() {
  return withPool(
    ownerUrl,
    async (pool) =>
      (
        await pool.query(
          `select c.relname as name, i.indisvalid as valid, i.indisready as ready, pg_get_indexdef(i.indexrelid) as definition
     from pg_index i join pg_class c on c.oid = i.indexrelid
     where c.relname in ('notes_user_created_recent_idx', 'notes_user_updated_recent_idx') order by c.relname`,
        )
      ).rows,
  );
}

describe.skipIf(!configured)('recent Note index migration safety', () => {
  beforeAll(async () => {
    const base = process.env['DATABASE_URL_TEST']!;
    const target = new URL(base);
    target.pathname = `/${databaseName}`;
    ownerUrl = target.toString();
    const role = new URL(process.env['DATABASE_URL']!);
    target.username = role.username;
    target.password = role.password;
    appUrl = target.toString();
    await withPool(base, async (pool) => {
      await pool.query(`create database ${databaseName}`);
    });
    await applyMigrations(ownerUrl, migrationCopy(true));
    await withPool(ownerUrl, async (pool) => {
      await installSystemNoteTypes(pool);
      await pool.query(
        `insert into "user" (id,name,email) values ('index-owner','Owner','owner@index.test'), ('index-foreign','Other','other@index.test')`,
      );
      await pool.query(
        `insert into decks (id,user_id,name,position) select gen_random_uuid(), case when n = 81 then 'index-foreign' else 'index-owner' end, 'Deck ' || n, n from generate_series(1,81) n`,
      );
      await pool.query(`with destinations as (select array_agg(id order by position) ids from decks)
        insert into notes (id,user_id,deck_id,note_type_id,fields,tags,source,created_at,updated_at)
        select gen_random_uuid(), case when n % 17 = 0 then 'index-foreign' else 'index-owner' end,
        ids[case when n % 17 = 0 then 81 else 1 + n % 80 end],
        (select id from note_types where name = 'basic' and user_id is null),
        jsonb_build_object('front','Word ' || n,'back','Meaning'), array['shared'], 'Migration fixture',
        now() - n * interval '1 millisecond', now() - (n % 100) * interval '1 millisecond'
        from generate_series(1,20000) n cross join destinations`);
      await pool.query(`insert into cards (id,user_id,note_id,deck_id,direction,state,due)
        select gen_random_uuid(),user_id,id,deck_id,'recognition','new',now() from notes order by id limit 2`);
      await pool.query(`insert into reviews (id,user_id,card_id,reviewed_at,rating,elapsed_days,scheduled_days,placed_due,state_before)
        select gen_random_uuid(),user_id,id,now(),'good',0,0,now(),'new' from cards order by id limit 1`);
    });
    baseline = await fingerprint();
  });

  afterAll(async () => {
    if (ownerUrl)
      await withPool(process.env['DATABASE_URL_TEST']!, async (pool) => {
        await pool.query(
          'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
          [databaseName],
        );
        await pool.query(`drop database if exists ${databaseName}`);
      });
    for (const folder of copies) {
      if (!resolve(folder).startsWith(resolve(tmpdir(), 'neuron-recent-migration-')))
        throw new Error('Unexpected migration fixture path');
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it('refuses an existing writer immediately and leaves the journal and data unchanged', async () => {
    await withPool(ownerUrl, async (pool) => {
      const writer = await pool.connect();
      try {
        await writer.query('begin');
        await writer.query('lock table notes in row exclusive mode');
        const failure = await applyMigrations(ownerUrl).then(
          () => undefined,
          (error: unknown) => error,
        );
        expect(sqlState(failure)).toBe('55P03');
      } finally {
        await writer.query('rollback');
        writer.release();
      }
    });
    expect((await inspectMigrationJournal(ownerUrl)).state).toBe('behind');
    expect(await recentIndexes()).toEqual([]);
    expect(await fingerprint()).toEqual(baseline);
  });

  it('cancels a slow statement after the first index and rolls back both the index and journal', async () => {
    const folder = migrationCopy();
    const file = join(folder, `${tip}.sql`);
    // Fault injection exercises the actual transaction and the migration's own timeout.
    writeFileSync(
      file,
      readFileSync(file, 'utf8').replace(
        'CREATE INDEX "notes_user_updated_recent_idx"',
        'SELECT pg_sleep(3);--> statement-breakpoint\nCREATE INDEX "notes_user_updated_recent_idx"',
      ),
    );
    const failure = await applyMigrations(ownerUrl, folder).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(sqlState(failure)).toBe('57014');
    expect((await inspectMigrationJournal(ownerUrl)).state).toBe('behind');
    expect(await recentIndexes()).toEqual([]);
    expect(await fingerprint()).toEqual(baseline);
  });

  it('restores the statement timeout and keeps the idle-client guard until the transaction ends', async () => {
    await withPool(ownerUrl, async (pool) => {
      const connection = await pool.connect();
      const settings = () =>
        connection.query(
          "select current_setting('statement_timeout') as statement, current_setting('idle_in_transaction_session_timeout') as idle",
        );
      try {
        const before = (await settings()).rows[0];
        await connection.query('begin');
        for (const statement of readFileSync(join(migrations, `${tip}.sql`), 'utf8').split(
          '--> statement-breakpoint',
        ))
          await connection.query(statement);
        expect((await settings()).rows[0]).toEqual({ statement: before.statement, idle: '5s' });
        await connection.query('rollback');
        expect((await settings()).rows[0]).toEqual(before);
      } finally {
        await connection.query('rollback');
        connection.release();
      }
    });
    expect(await recentIndexes()).toEqual([]);
    expect(await fingerprint()).toEqual(baseline);
  });

  it('applies through the trusted production policy, keeps all data/timestamps and retains restricted-role RLS', async () => {
    const started = performance.now();
    const result = await ensureProductionMigrations({
      inspect: () => inspectMigrationJournal(ownerUrl),
      migrate: () => applyMigrations(ownerUrl),
      verify: async () => {
        const state = await inspectMigrationJournal(ownerUrl);
        expect(state.state).toBe('current');
        return state.migration;
      },
    });
    console.info(
      JSON.stringify({
        migration: tip,
        fixtureNotes: 20000,
        workflowMs: performance.now() - started,
      }),
    );
    expect(result.migrated).toBe(true);
    const indexes = await recentIndexes();
    expect(indexes).toHaveLength(2);
    for (const index of indexes) {
      expect(index['valid']).toBe(true);
      expect(index['ready']).toBe(true);
      expect(index['definition']).toContain('(user_id,');
      expect(index['definition']).toContain('deleted_at IS NULL');
      expect(index['definition']).toContain('purged_at IS NULL');
    }
    expect(await fingerprint()).toEqual(baseline);
    await withPool(appUrl, async (pool) => {
      await pool.query('begin');
      await pool.query("select set_config('app.user_id', 'index-owner', true)");
      const rows = await pool.query(
        "select count(*)::int as visible, count(*) filter (where user_id <> 'index-owner')::int as foreign_rows from notes",
      );
      expect(rows.rows[0]).toEqual({ visible: 20000 - Math.floor(20000 / 17), foreign_rows: 0 });
      expect(
        (
          await pool.query(
            "select count(*)::int as count from notes where user_id = 'index-foreign'",
          )
        ).rows[0]?.count,
      ).toBe(0);
      await pool.query('rollback');
    });
    await applyMigrations(ownerUrl);
    expect(await recentIndexes()).toEqual(indexes);
    expect(await fingerprint()).toEqual(baseline);
  });
});

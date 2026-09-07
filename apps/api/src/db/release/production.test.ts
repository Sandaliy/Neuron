import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { applyMigrations } from '../migrate/main.js';
import { withPool } from '../tooling.js';

import { inspectMigrationJournal, verifyMigrationJournal } from './journal-verification.js';
import { ensureProductionMigrations } from './production.js';

interface Journal {
  readonly entries: readonly { readonly tag: string }[];
}

const configured = Boolean(process.env['DATABASE_URL_TEST']);
const databaseName = `neuron_production_migration_${process.pid}_${Date.now()}`;
const migrationsFolder = fileURLToPath(new URL('../../../drizzle', import.meta.url));
const apiRoot = fileURLToPath(new URL('../../..', import.meta.url));
const sharedDist = fileURLToPath(new URL('../../../../../packages/shared/dist', import.meta.url));
let ownerUrl = '';

describe.skipIf(!configured)('trusted production migration policy', () => {
  beforeAll(async () => {
    const baseOwnerUrl = process.env['DATABASE_URL_TEST'];

    if (!baseOwnerUrl) {
      return;
    }

    ownerUrl = connectionForDatabase(baseOwnerUrl, databaseName);
    await createDatabase(baseOwnerUrl, databaseName);
    await applyMigrations(ownerUrl);
  });

  afterAll(async () => {
    const baseOwnerUrl = process.env['DATABASE_URL_TEST'];

    if (baseOwnerUrl) {
      await dropDatabase(baseOwnerUrl, databaseName);
    }
  });

  it('does not run migrations when the journal is current', async () => {
    const migrate = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    const result = await ensureProductionMigrations({
      inspect: () => inspectMigrationJournal(ownerUrl),
      migrate,
      verify: () => verifyMigrationJournal(ownerUrl),
    });

    expect(result.migrated).toBe(false);
    expect(migrate).not.toHaveBeenCalled();
  });

  it('runs migrations only after an actual behind journal and then verifies it', async () => {
    const behindName = `${databaseName}_behind`;
    const behindUrl = connectionForDatabase(process.env['DATABASE_URL_TEST'] ?? '', behindName);
    const behindFolder = createBehindMigrationFolder();
    const migrate = vi.fn<() => Promise<void>>(() => applyMigrations(behindUrl));

    try {
      await createDatabase(process.env['DATABASE_URL_TEST'] ?? '', behindName);
      await applyMigrations(behindUrl, behindFolder);

      const result = await ensureProductionMigrations({
        inspect: () => inspectMigrationJournal(behindUrl),
        migrate,
        verify: () => verifyMigrationJournal(behindUrl),
      });

      expect(result.migrated).toBe(true);
      expect(migrate).toHaveBeenCalledTimes(1);
    } finally {
      await dropDatabase(process.env['DATABASE_URL_TEST'] ?? '', behindName);
      rmSync(behindFolder, { recursive: true, force: true });
    }
  });

  it('never migrates after verifier, credential, or configuration failures', async () => {
    for (const failure of [
      new Error('journal verifier crashed'),
      new Error('password authentication failed'),
      new Error('DATABASE_URL_OWNER is not set'),
    ]) {
      const migrate = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      await expect(
        ensureProductionMigrations({
          inspect: () => Promise.reject(failure),
          migrate,
          verify: () => Promise.resolve('unused'),
        }),
      ).rejects.toBe(failure);
      expect(migrate).not.toHaveBeenCalled();
    }
  });

  it('never migrates when the journal verifier is pointed at the wrong database', async () => {
    const migrate = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    await expect(
      ensureProductionMigrations({
        inspect: () => inspectMigrationJournal(ownerUrl, `${databaseName}_wrong`),
        migrate,
        verify: () => verifyMigrationJournal(ownerUrl),
      }),
    ).rejects.toThrow(/owner URL targets/);
    expect(migrate).not.toHaveBeenCalled();
  });

  it('inspects the journal from a fresh install without shared runtime artifacts', () => {
    const heldDist = `${sharedDist}.journal-import-${process.pid}`;
    const childEnvironment: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL_OWNER: ownerUrl,
    };

    delete childEnvironment['DATABASE_URL'];
    delete childEnvironment['DATABASE_URL_AUTH'];
    delete childEnvironment['DATABASE_URL_TEST'];

    if (existsSync(sharedDist)) {
      renameSync(sharedDist, heldDist);
    }

    try {
      const output = execFileSync(
        process.execPath,
        [
          '--import',
          'tsx',
          '--import',
          './src/db/release/test-setup.ts',
          './src/db/release/journal.ts',
        ],
        { cwd: apiRoot, encoding: 'utf8', env: childEnvironment },
      );

      expect(output).toMatch(/required migration .* is applied/);
    } finally {
      if (existsSync(heldDist)) {
        renameSync(heldDist, sharedDist);
      }
    }
  });
});

async function createDatabase(baseUrl: string, database: string): Promise<void> {
  await withPool(baseUrl, async (pool) => {
    await pool.query(`create database ${database}`);
  });
}

async function dropDatabase(baseUrl: string, database: string): Promise<void> {
  await withPool(baseUrl, async (pool) => {
    await pool.query(
      `select pg_terminate_backend(pid)
         from pg_stat_activity
        where datname = $1 and pid <> pg_backend_pid()`,
      [database],
    );
    await pool.query(`drop database if exists ${database}`);
  });
}

function createBehindMigrationFolder(): string {
  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'),
  ) as Journal;
  const required = journal.entries.at(-1);

  if (!required) {
    throw new Error('The production migration fixture needs at least one migration.');
  }

  const folder = mkdtempSync(join(tmpdir(), 'neuron-production-behind-'));

  cpSync(migrationsFolder, folder, { recursive: true });
  writeFileSync(
    join(folder, 'meta', '_journal.json'),
    `${JSON.stringify({ ...journal, entries: journal.entries.slice(0, -1) }, null, 2)}\n`,
  );
  rmSync(join(folder, `${required.tag}.sql`));

  return folder;
}

function connectionForDatabase(connectionString: string, database: string): string {
  const url = new URL(connectionString);

  url.pathname = `/${database}`;

  return url.toString();
}

import { fileURLToPath } from 'node:url';

import { readMigrationFiles } from 'drizzle-orm/migrator';

import { withPool } from '../tooling.js';

export interface MigrationJournalState {
  readonly migration: string;
  readonly state: 'current' | 'behind';
}

const migrationsFolder = fileURLToPath(new URL('../../../drizzle', import.meta.url));

/**
 * Reads only the local migration metadata and the target's Drizzle journal.
 * It intentionally does not import runtime schemas or workspace packages.
 */
export async function inspectMigrationJournal(
  ownerUrl: string,
  expectedDatabase = databaseFromUrl(ownerUrl),
): Promise<MigrationJournalState> {
  assertUrlTargetsDatabase('owner', ownerUrl, expectedDatabase);
  const migrations = readMigrationFiles({ migrationsFolder });
  const required = migrations.at(-1);

  if (!required) {
    throw new Error('No migrations are declared for this release.');
  }

  const state = await withPool(ownerUrl, async (pool) => {
    await assertConnectedDatabase('owner', pool, expectedDatabase);
    const applied = await pool.query<{ hash: string }>(
      `select hash
         from drizzle.__drizzle_migrations
        where created_at = $1`,
      [required.folderMillis],
    );

    return applied.rows[0]?.hash === required.hash ? 'current' : 'behind';
  });

  return { migration: String(required.folderMillis), state };
}

/** Throws when the exact latest migration is not present in the target journal. */
export async function verifyMigrationJournal(
  ownerUrl: string,
  expectedDatabase = databaseFromUrl(ownerUrl),
): Promise<string> {
  const result = await inspectMigrationJournal(ownerUrl, expectedDatabase);

  if (result.state === 'behind') {
    throw new Error(
      `The production database is missing the required migration at ${result.migration}.`,
    );
  }

  return result.migration;
}

export function databaseFromUrl(connectionString: string): string {
  const database = decodeURIComponent(new URL(connectionString).pathname.slice(1));

  if (!database) {
    throw new Error('Release verification requires an explicit database in every connection URL.');
  }

  return database;
}

export function assertUrlTargetsDatabase(
  connection: string,
  connectionString: string,
  expectedDatabase: string,
): void {
  const actualDatabase = databaseFromUrl(connectionString);

  if (actualDatabase !== expectedDatabase) {
    throw new Error(
      `Release verification ${connection} URL targets ${actualDatabase}, expected ${expectedDatabase}.`,
    );
  }
}

export async function assertConnectedDatabase(
  connection: string,
  pool: Parameters<Parameters<typeof withPool>[1]>[0],
  expectedDatabase: string,
): Promise<void> {
  const identity = await pool.query<{ database: string }>('select current_database() as database');
  const actualDatabase = identity.rows[0]?.database;

  if (actualDatabase !== expectedDatabase) {
    throw new Error(
      `Release verification ${connection} connection reached ${actualDatabase ?? 'an unknown database'}, expected ${expectedDatabase}.`,
    );
  }
}

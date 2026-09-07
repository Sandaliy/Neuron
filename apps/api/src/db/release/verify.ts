import { fileURLToPath } from 'node:url';

import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle } from 'drizzle-orm/neon-serverless';

import { verifyRuntimeDatabase } from '../compatibility.js';
import { authSchema, schema } from '../schema/index.js';
import { withPool } from '../tooling.js';

export interface ReleaseVerification {
  readonly migration: string;
  readonly database: string;
  readonly applicationRole: string;
  readonly authenticationRole: string;
}

const migrationsFolder = fileURLToPath(new URL('../../../drizzle', import.meta.url));

/** Proves the exact latest migration in this checkout exists in the target journal. */
export async function verifyMigrationJournal(
  ownerUrl: string,
  expectedDatabase = databaseFromUrl(ownerUrl),
): Promise<string> {
  assertUrlTargetsDatabase('owner', ownerUrl, expectedDatabase);
  const migrations = readMigrationFiles({ migrationsFolder });
  const required = migrations.at(-1);

  if (!required) {
    throw new Error('No migrations are declared for this release.');
  }

  await withPool(ownerUrl, async (pool) => {
    await assertConnectedDatabase('owner', pool, expectedDatabase);
    const applied = await pool.query<{ hash: string }>(
      `select hash
         from drizzle.__drizzle_migrations
        where created_at = $1`,
      [required.folderMillis],
    );

    if (applied.rows[0]?.hash !== required.hash) {
      throw new Error(
        `The production database is missing the required migration at ${required.folderMillis}.`,
      );
    }
  });

  return String(required.folderMillis);
}

/** Verifies both connections that deployed request code receives. */
export async function verifyRuntimeConnections(
  applicationUrl: string,
  authenticationUrl: string,
  expectedDatabase = databaseFromUrl(applicationUrl),
): Promise<{ applicationRole: string; authenticationRole: string }> {
  assertUrlTargetsDatabase('application', applicationUrl, expectedDatabase);
  assertUrlTargetsDatabase('authentication', authenticationUrl, expectedDatabase);
  const application = await withPool(applicationUrl, async (pool) => {
    await assertConnectedDatabase('application', pool, expectedDatabase);

    return verifyRuntimeDatabase(drizzle(pool, { schema }), 'neuron_app');
  });
  const authentication = await withPool(authenticationUrl, async (pool) => {
    await assertConnectedDatabase('authentication', pool, expectedDatabase);

    return verifyRuntimeDatabase(drizzle(pool, { schema: authSchema }), 'neuron_auth');
  });

  return {
    applicationRole: application.role,
    authenticationRole: authentication.role,
  };
}

/** The complete release contract, with the owner used only for the journal. */
export async function verifyRelease(
  ownerUrl: string,
  applicationUrl: string,
  authenticationUrl: string,
  expectedDatabase = databaseFromUrl(ownerUrl),
): Promise<ReleaseVerification> {
  assertUrlTargetsDatabase('owner', ownerUrl, expectedDatabase);
  assertUrlTargetsDatabase('application', applicationUrl, expectedDatabase);
  assertUrlTargetsDatabase('authentication', authenticationUrl, expectedDatabase);
  const migration = await verifyMigrationJournal(ownerUrl, expectedDatabase);
  const runtime = await verifyRuntimeConnections(
    applicationUrl,
    authenticationUrl,
    expectedDatabase,
  );

  return { migration, database: expectedDatabase, ...runtime };
}

function databaseFromUrl(connectionString: string): string {
  const database = decodeURIComponent(new URL(connectionString).pathname.slice(1));

  if (!database) {
    throw new Error('Release verification requires an explicit database in every connection URL.');
  }

  return database;
}

function assertUrlTargetsDatabase(
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

async function assertConnectedDatabase(
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

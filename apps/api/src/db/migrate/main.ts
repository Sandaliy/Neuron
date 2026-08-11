import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/neon-serverless';
import { migrate } from 'drizzle-orm/neon-serverless/migrator';

import { describeConnection, requireUrl, withPool } from '../tooling.js';

/**
 * Applies the migrations.
 *
 * Drizzle Kit can do this too, but it reports a failure as an exit code and
 * nothing else, which turns a one line syntax error into an afternoon. This
 * runs the same files, in the same order, through the same journal, and prints
 * what went wrong.
 *
 * It also gives the test setup something to call: the test database has to be
 * brought up to the current schema before every run, and shelling out to a
 * command line tool from inside a test is worse than calling a function.
 */

const migrationsFolder = fileURLToPath(new URL('../../../drizzle', import.meta.url));

/**
 * Brings one database up to date.
 *
 * @param connectionString the database to migrate, as the owner
 */
export async function applyMigrations(connectionString: string): Promise<void> {
  await withPool(connectionString, async (pool) => {
    await migrate(drizzle(pool), { migrationsFolder });
  });
}

async function main(): Promise<void> {
  const target = process.argv.includes('--test') ? 'DATABASE_URL_TEST' : 'DATABASE_URL_OWNER';
  const url = requireUrl(
    target,
    target === 'DATABASE_URL_TEST'
      ? 'It is the connection string of the Neon branch the tests are allowed to wipe.'
      : 'It is the connection string Neon shows under Connect, for the neondb_owner role.',
  );

  console.log(`migrating ${describeConnection(url)}`);

  await applyMigrations(url);

  await withPool(url, async (pool) => {
    const tables = await pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by 1",
    );

    console.log(`tables: ${tables.rows.map((row) => row.table_name).join(', ')}`);
  });
}

// Only when run directly, so importing applyMigrations from a test does not
// start migrating something.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/'))) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  });
}

import process from 'node:process';

import { applyMigrations } from '../migrate/main.js';
import { describeConnection, requireUrl, withPool, writeEnvVariable } from '../tooling.js';

/**
 * Creates the throwaway database the tests are allowed to empty, and writes its
 * connection string into .env.
 *
 * A Neon branch does the same job and is what the Neon console offers. This
 * exists because a second database on the same branch needs no console visit,
 * costs nothing extra, and gives the tests the same guarantee: a different
 * database from the one holding real cards. If you would rather use a branch,
 * create it in the console and put its connection string in DATABASE_URL_TEST
 * by hand. Everything downstream works the same way.
 */

const TEST_DATABASE = 'neuron_test';

async function main(): Promise<void> {
  const ownerUrl = requireUrl(
    'DATABASE_URL_OWNER',
    'Creating a database needs the owner, which is the connection Neon shows under Connect.',
  );

  const target = new URL(ownerUrl);
  const current = target.pathname.replace('/', '');

  if (current === TEST_DATABASE) {
    throw new Error(`DATABASE_URL_OWNER already points at ${TEST_DATABASE}, which is the test one.`);
  }

  await withPool(ownerUrl, async (pool) => {
    const exists = await pool.query('select 1 from pg_database where datname = $1', [
      TEST_DATABASE,
    ]);

    if (exists.rowCount === 0) {
      // Not parameterised because CREATE DATABASE cannot take one. The name is
      // a constant in this file, not anything that arrived from outside.
      await pool.query(`create database ${TEST_DATABASE}`);
      console.log(`created database ${TEST_DATABASE}`);
    } else {
      console.log(`database ${TEST_DATABASE} was already there`);
    }
  });

  target.pathname = `/${TEST_DATABASE}`;

  const testUrl = target.toString();

  await applyMigrations(testUrl);

  writeEnvVariable('DATABASE_URL_TEST', testUrl);

  console.log(`migrated and wrote DATABASE_URL_TEST for ${describeConnection(testUrl)}`);
  console.log(`to undo: drop database ${TEST_DATABASE}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});

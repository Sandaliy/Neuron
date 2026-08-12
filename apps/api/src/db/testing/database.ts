import process from 'node:process';

import { Pool } from '@neondatabase/serverless';

import { createDb } from '../client.js';
import { applyMigrations } from '../migrate/main.js';
import { createRepositories } from '../repositories/index.js';
import { installSystemNoteTypes } from '../system-note-types.js';
import { loadDotEnv } from '../tooling.js';

import type { Database } from '../client.js';
import type { Repositories } from '../repositories/index.js';
import type { PoolClient } from '@neondatabase/serverless';

/**
 * Everything the database tests need in order to run against a real Postgres.
 *
 * They run against a real one on purpose. A mocked test of row level security
 * proves that the mock returns what the test told it to, which is not a fact
 * about the database and not a fact about the application either. The isolation
 * these tests cover is the second barrier around user data, so it is checked
 * where it actually lives.
 */

/**
 * Three ways in, which is the point.
 *
 * The owner set the tables up. `neuron_app` is what the api uses for the
 * collection. `neuron_auth` is what Better Auth uses for the four tables it
 * owns. The isolation tests need all three, because most of what they prove is
 * about what one role cannot do that another can.
 */
export interface TestDatabase {
  readonly ownerUrl: string;
  readonly appUrl: string;
  /** Undefined until `pnpm db:role` has written DATABASE_URL_AUTH. */
  readonly authUrl: string | undefined;
}

/**
 * Sockets per pool in the tests.
 *
 * The files run side by side and each builds pools of its own, all against one
 * Neon endpoint. The driver's default of ten each adds up to more connections
 * than the endpoint will give out, and the symptom is not a clear refusal: it
 * is a `begin` that times out in the middle of an unrelated test.
 */
const TEST_MAX_SOCKETS = 2;

let resolved: TestDatabase | undefined | null = null;

/**
 * Works out where the tests are allowed to write, or reports that they are not.
 *
 * DATABASE_URL_TEST is the owner connection for a throwaway database. The
 * connection for the restricted role is derived from it by taking the
 * credentials out of DATABASE_URL, which works whether the throwaway is a Neon
 * branch, where roles are copied from the parent, or a second database on the
 * same branch, where roles are shared by the whole cluster.
 *
 * @returns the two connection strings, or undefined when nothing is configured
 */
export function testDatabase(): TestDatabase | undefined {
  if (resolved !== null) {
    return resolved;
  }

  loadDotEnv();

  const ownerUrl = process.env['DATABASE_URL_TEST'];
  const liveUrl = process.env['DATABASE_URL'];

  if (!ownerUrl || !liveUrl) {
    resolved = undefined;

    return resolved;
  }

  const owner = new URL(ownerUrl);
  const live = new URL(liveUrl);

  // The guard that matters. These tests empty every table they can reach, so
  // pointing them at the database holding real cards has to be impossible
  // rather than merely discouraged.
  if (owner.hostname === live.hostname && owner.pathname === live.pathname) {
    throw new Error(
      [
        'DATABASE_URL_TEST points at the same database as DATABASE_URL.',
        'The tests empty every table, so this would erase your collection.',
        'Point it at a separate Neon branch or database.',
      ].join('\n'),
    );
  }

  const app = new URL(ownerUrl);

  app.username = live.username;
  app.password = live.password;

  resolved = { ownerUrl, appUrl: app.toString(), authUrl: authConnection(ownerUrl) };

  return resolved;
}

/**
 * The authentication role's connection to the test database.
 *
 * Built the same way as the application one: the throwaway database's host,
 * with the credentials taken from the live connection string. Neon copies roles
 * to a branch, so the same password works on both.
 *
 * @param ownerUrl the test database, as its owner
 * @returns the connection string, or undefined when db:role has not been run
 */
function authConnection(ownerUrl: string): string | undefined {
  const configured = process.env['DATABASE_URL_AUTH'];

  if (!configured) {
    return undefined;
  }

  const auth = new URL(ownerUrl);
  const live = new URL(configured);

  auth.username = live.username;
  auth.password = live.password;

  return auth.toString();
}

/** Says why the tests that need the authentication role are not running. */
export function describeAuthSkipReason(): string {
  return [
    'DATABASE_URL_AUTH is not set, so the tests covering the authentication role did not run.',
    'Run: pnpm db:role',
  ].join(' ');
}

/** Says once, loudly, why the database tests are not running. */
export function describeSkipReason(): string {
  return [
    'DATABASE_URL_TEST is not set, so the database tests did not run.',
    'They need a throwaway database, because they empty every table.',
    'Run: pnpm --filter @neuron/api db:test-db',
  ].join(' ');
}

let migrated = false;

/**
 * Brings the test database up to the current schema, once per run.
 *
 * @param database the test connections
 */
export async function prepareSchema(database: TestDatabase): Promise<void> {
  if (migrated) {
    return;
  }

  await applyMigrations(database.ownerUrl);
  migrated = true;
}

/**
 * Empties the database and puts the shared note types back.
 *
 * Truncating `user` reaches everything a user owns through the foreign keys.
 * It also empties note_types, because a cascading truncate takes the whole
 * referencing table rather than the matching rows, so the built in types are
 * written again afterwards.
 *
 * `rate_limits` and `registration_counts` are named separately because neither
 * belongs to a user and neither has a key pointing at one, so the cascade never
 * reaches them. Left alone, one test's failed sign ins and another's
 * registrations decide whether a third test is allowed to run at all.
 *
 * @param database the test connections
 */
export async function resetDatabase(database: TestDatabase): Promise<void> {
  const pool = new Pool({ connectionString: database.ownerUrl });

  try {
    await pool.query('truncate table "user" cascade');
    await pool.query('truncate table note_types cascade');
    await pool.query('truncate table rate_limits');
    await pool.query('truncate table registration_counts');

    // The same function the seed uses, so both put the built in types in with
    // the same ids. Two versions of this is how they end up disagreeing.
    await installSystemNoteTypes(pool);
  } finally {
    await pool.end();
  }
}

/**
 * Creates a user row, the way signing up would.
 *
 * @param database the test connections
 * @param id the user id
 * @param overrides anything to set other than the defaults
 */
export async function createUser(
  database: TestDatabase,
  id: string,
  overrides: { readonly timezone?: string; readonly settings?: unknown } = {},
): Promise<void> {
  const pool = new Pool({ connectionString: database.ownerUrl });

  try {
    await pool.query(
      `insert into "user" (id, name, email, timezone, settings)
       values ($1, $1, $2, $3, $4)`,
      [
        id,
        `${id}@neuron.test`,
        overrides.timezone ?? 'Europe/Moscow',
        JSON.stringify(overrides.settings ?? {}),
      ],
    );
  } finally {
    await pool.end();
  }
}

/** A client connected as the restricted role, the way the api connects. */
export function appClient(database: TestDatabase): Database {
  return createDb(database.appUrl);
}

/** The repositories for one user, over the restricted role. */
export function repositoriesFor(database: TestDatabase, userId: string): Repositories {
  return createRepositories(appClient(database), userId);
}

/**
 * A raw connection as the restricted role, for the tests that have to go around
 * the repositories rather than through them.
 *
 * The isolation tests use this. Checking row level security through the
 * repository layer would only prove that the layer does what it says, which is
 * the thing row level security exists to be independent of.
 *
 * @param database the test connections
 * @returns a pool the caller has to close
 */
export function rawAppPool(database: TestDatabase): Pool {
  return new Pool({ connectionString: database.appUrl, max: TEST_MAX_SOCKETS });
}

/** A raw connection as the owner, for setup and for teardown. */
export function rawOwnerPool(database: TestDatabase): Pool {
  return new Pool({ connectionString: database.ownerUrl, max: TEST_MAX_SOCKETS });
}

/** A raw connection as the authentication role, for the tests about it. */
export function rawAuthPool(database: TestDatabase): Pool {
  if (!database.authUrl) {
    throw new Error(
      'DATABASE_URL_AUTH is not set, so there is no authentication role to connect as',
    );
  }

  return new Pool({ connectionString: database.authUrl, max: TEST_MAX_SOCKETS });
}

/**
 * Runs statements as the restricted role with a user named for the transaction,
 * exactly as the repository layer does, and rolls back afterwards.
 *
 * @param pool the connection
 * @param userId who to claim to be, or null to claim nobody
 * @param work what to run
 * @returns whatever the work returned
 */
export async function asUser<T>(
  pool: Pool,
  userId: string | null,
  work: (connection: PoolClient) => Promise<T>,
): Promise<T> {
  const connection = await pool.connect();

  try {
    await connection.query('begin');

    if (userId !== null) {
      await connection.query('select set_config($1, $2, true)', ['app.user_id', userId]);
    }

    return await work(connection);
  } finally {
    await connection.query('rollback');
    connection.release();
  }
}

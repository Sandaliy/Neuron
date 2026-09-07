import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { mountApp } from '../../create-app.js';
import { parseEnv } from '../../env.js';
import { createAuthDb, createDb } from '../client.js';
import { applyMigrations } from '../migrate/main.js';
import { withPool } from '../tooling.js';

import { verifyRelease } from './verify.js';

import type { Mailer } from '../../mailer.js';

interface Journal {
  readonly dialect: string;
  readonly entries: readonly {
    readonly breakpoints: boolean;
    readonly idx: number;
    readonly tag: string;
    readonly version: string;
    readonly when: number;
  }[];
  readonly version: string;
}

const configured = Boolean(
  process.env['DATABASE_URL_TEST'] &&
  process.env['DATABASE_URL'] &&
  process.env['DATABASE_URL_AUTH'],
);
const databaseName = `neuron_release_${process.pid}_${Date.now()}`;
const migrationsFolder = fileURLToPath(new URL('../../../drizzle', import.meta.url));
let behindFolder = '';
let ownerUrl = '';
let applicationUrl = '';
let authenticationUrl = '';

describe.skipIf(!configured)('production migration safety', () => {
  beforeAll(async () => {
    const baseOwnerUrl = process.env['DATABASE_URL_TEST'];
    const configuredApplicationUrl = process.env['DATABASE_URL'];
    const configuredAuthenticationUrl = process.env['DATABASE_URL_AUTH'];

    if (!baseOwnerUrl || !configuredApplicationUrl || !configuredAuthenticationUrl) {
      return;
    }

    ownerUrl = connectionForDatabase(baseOwnerUrl, databaseName);
    applicationUrl = restrictedConnection(ownerUrl, configuredApplicationUrl, 'neuron_app');
    authenticationUrl = restrictedConnection(ownerUrl, configuredAuthenticationUrl, 'neuron_auth');

    await withPool(baseOwnerUrl, async (pool) => {
      await pool.query(`create database ${databaseName}`);
    });

    behindFolder = createBehindMigrationFolder();
    await applyMigrations(ownerUrl, behindFolder);

    await withPool(ownerUrl, async (pool) => {
      await setRolePassword(pool, applicationUrl, 'neuron_app');
      await setRolePassword(pool, authenticationUrl, 'neuron_auth');
    });
  });

  afterAll(async () => {
    if (!ownerUrl) {
      return;
    }

    const baseOwnerUrl = process.env['DATABASE_URL_TEST'];

    if (baseOwnerUrl) {
      await withPool(baseOwnerUrl, async (pool) => {
        await pool.query(
          `select pg_terminate_backend(pid)
             from pg_stat_activity
            where datname = $1 and pid <> pg_backend_pid()`,
          [databaseName],
        );
        await pool.query(`drop database if exists ${databaseName}`);
      });
    }

    if (behindFolder) {
      rmSync(behindFolder, { recursive: true, force: true });
    }
  });

  it('fails closed, migrates through the owner path, then passes on restricted roles', async () => {
    const ambientApplicationUrl = connectionForDatabase(
      applicationUrl,
      databaseFromConnection(process.env['DATABASE_URL_TEST'] ?? ''),
    );

    await expect(
      verifyRelease(ownerUrl, ambientApplicationUrl, authenticationUrl, databaseName),
    ).rejects.toThrow(
      `Release verification application URL targets ${databaseFromConnection(ambientApplicationUrl)}, expected ${databaseName}.`,
    );
    await expect(
      verifyRelease(ownerUrl, applicationUrl, authenticationUrl, databaseName),
    ).rejects.toThrow(/missing the required migration/);
    const release = releaseServer(applicationUrl, authenticationUrl);

    try {
      const behindHealth = await release.server.request('/health');

      expect(behindHealth.status).toBe(503);

      await applyMigrations(ownerUrl);

      const verification = await verifyRelease(
        ownerUrl,
        applicationUrl,
        authenticationUrl,
        databaseName,
      );
      expect(verification.database).toBe(databaseName);
      expect(verification.applicationRole).toBe('neuron_app');
      expect(verification.authenticationRole).toBe('neuron_auth');

      const currentHealth = await release.server.request('/health');

      expect(currentHealth.status).toBe(200);
      await expect(currentHealth.json()).resolves.toMatchObject({
        status: 'ok',
        schema: 'compatible',
      });
    } finally {
      await release.close();
    }
  });
});

function releaseServer(
  appUrl: string,
  authUrl: string,
): { readonly server: Hono; readonly close: () => Promise<void> } {
  const env = parseEnv({
    DATABASE_URL: appUrl,
    DATABASE_URL_AUTH: authUrl,
    DATABASE_URL_OWNER: ownerUrl,
    BETTER_AUTH_SECRET: 'release-safety-secret-release-safety-secret',
    APP_ORIGIN: 'https://neuron.test',
    NODE_ENV: 'test',
  });
  const mailer: Mailer = {
    async send() {},
  };

  expect(env).not.toHaveProperty('DATABASE_URL_OWNER');

  const db = createDb(env.DATABASE_URL);
  const authDb = createAuthDb(env.DATABASE_URL_AUTH);
  const server = mountApp(new Hono(), {
    env,
    db,
    authDb,
    mailer,
  });

  return {
    server,
    async close() {
      await Promise.all([db.$client.end(), authDb.$client.end()]);
    },
  };
}

function createBehindMigrationFolder(): string {
  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'),
  ) as Journal;
  const required = journal.entries.at(-1);
  const previous = journal.entries.at(-2);

  if (!required || !previous) {
    throw new Error('The migration safety fixture needs at least two migrations.');
  }

  const folder = mkdtempSync(join(tmpdir(), 'neuron-behind-'));

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

function databaseFromConnection(connectionString: string): string {
  const database = decodeURIComponent(new URL(connectionString).pathname.slice(1));

  if (!database) {
    throw new Error('The release safety fixture requires an explicit database name.');
  }

  return database;
}

function restrictedConnection(ownerConnection: string, configured: string, role: string): string {
  const source = new URL(configured);

  if (source.username !== role || !/^[A-Za-z0-9]+$/.test(source.password)) {
    throw new Error(`${role} must use its generated alphanumeric credential.`);
  }

  const target = new URL(ownerConnection);

  target.username = source.username;
  target.password = source.password;

  return target.toString();
}

async function setRolePassword(
  pool: Parameters<Parameters<typeof withPool>[1]>[0],
  url: string,
  role: string,
): Promise<void> {
  const password = new URL(url).password;

  await pool.query(`alter role ${role} with login password '${password}'`);
}

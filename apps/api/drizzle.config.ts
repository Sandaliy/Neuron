import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'drizzle-kit';

/**
 * Configuration for the migration tool, not for the server. It runs from a
 * terminal, so it reads .env itself.
 *
 * It connects as the database owner, which is the only role allowed to change
 * the shape of the database. The server connects as a restricted role through
 * DATABASE_URL and cannot create or drop anything. Keeping the two apart is
 * what makes the isolation policies mean something: Neon grants its owner role
 * BYPASSRLS, so an application connected as the owner would walk straight
 * through every policy in the schema.
 */

try {
  process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
} catch {
  // Not there, so the value has to come from the shell.
}

const url = process.env['DATABASE_URL_OWNER'];

if (!url) {
  throw new Error(
    [
      'DATABASE_URL_OWNER is missing.',
      '',
      'It is the connection string Neon shows on the Connect button, the one',
      'for the neondb_owner role. Migrations run as the owner; the api does',
      'not, and uses DATABASE_URL instead.',
    ].join('\n'),
  );
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});

import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'drizzle-kit';

/**
 * Configuration for the migration tool, not for the server. It runs from a
 * terminal, so it reads .env itself and only needs the one variable. The
 * server still gets its configuration through src/env.ts.
 */

try {
  process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
} catch {
  // Not there, so the value has to come from the shell.
}

const url = process.env['DATABASE_URL'];

if (!url) {
  throw new Error(
    'DATABASE_URL is missing. Put the connection string from Neon into the .env file at the top of the project.',
  );
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});

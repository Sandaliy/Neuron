import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { serve } from '@hono/node-server';

/**
 * The local development server. On Vercel the platform provides the
 * environment, so this file is not used there.
 */

const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));

try {
  process.loadEnvFile(envFile);
} catch {
  // No .env file. The variables may still come from the shell, and if they do
  // not, the check below says exactly which one is missing.
}

const { loadEnv } = await import('./env.js');
const { createApp } = await import('./create-app.js');

const env = loadEnv();

serve({ fetch: createApp().fetch, port: env.PORT }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
  console.log(`stack check page: http://localhost:${info.port}/spike`);
});

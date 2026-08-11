import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';

import { schema } from './schema/index.js';

/**
 * Neon over WebSockets, not over HTTP.
 *
 * The HTTP driver is lighter, but it cannot run transactions, and Better Auth
 * wraps user creation in one. The WebSocket driver keeps the connection per
 * invocation rather than holding a long lived pool, which is what a serverless
 * function needs.
 */

export type Database = ReturnType<typeof createDb>;

export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString });

  return drizzle(pool, { schema });
}

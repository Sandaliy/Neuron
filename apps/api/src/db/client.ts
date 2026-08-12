import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';

import { authSchema, schema } from './schema/index.js';

/**
 * Neon over WebSockets, not over HTTP.
 *
 * The HTTP driver is lighter, but it cannot run transactions, and Better Auth
 * wraps user creation in one. The WebSocket driver keeps the connection per
 * invocation rather than holding a long lived pool, which is what a serverless
 * function needs.
 *
 * There are two connections, not one. The application connects as `neuron_app`,
 * which reaches the collection and ten columns of `user`. Better Auth connects
 * as `neuron_auth`, which reaches the four tables it owns and nothing else.
 * Splitting them is what makes an email address and a password hash
 * unreachable from a route handler, rather than merely unreached.
 */

export type Database = ReturnType<typeof createDb>;

/**
 * How many sockets one pool may hold open.
 *
 * The driver's default is ten. That is right for a long lived server and wrong
 * here twice over: a serverless invocation handles one request, so nine of the
 * ten are never used, and the test run builds a couple of dozen pools against
 * one Neon endpoint, where ten each is enough to exhaust it. Two, so a
 * transaction and the statement that starts it are never waiting on each other.
 */
const MAX_SOCKETS = 2;

export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString, max: MAX_SOCKETS });

  return drizzle(pool, { schema });
}

export type AuthDatabase = ReturnType<typeof createAuthDb>;

/**
 * The authentication connection.
 *
 * @param connectionString DATABASE_URL_AUTH, using the neuron_auth role
 * @returns a client that can see the auth tables and no others
 */
export function createAuthDb(connectionString: string) {
  const pool = new Pool({ connectionString, max: MAX_SOCKETS });

  return drizzle(pool, { schema: authSchema });
}

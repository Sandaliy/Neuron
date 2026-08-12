import { Hono } from 'hono';

import { mountCollection } from '../create-app.js';
import { appClient } from '../db/testing/database.js';
import { createPermissiveRateLimiter } from '../rate-limit.js';

import type { Auth } from '../auth.js';
import type { AuthDatabase } from '../db/client.js';
import type { TestDatabase } from '../db/testing/database.js';

/**
 * The real routes, over the real database, behind a session that is stubbed.
 *
 * Everything under test here is the request path: validation, the error shape,
 * what the server recomputes rather than believes, whether a retry is harmless.
 * None of that is about Better Auth, and standing Better Auth up to reach it
 * would mean a sign up, a password hash and a cookie jar in front of every
 * assertion.
 *
 * So the session is the one thing replaced. Everything after it, including the
 * repository layer and the isolation policies in the database, is the code that
 * actually ships.
 */

/**
 * Builds a server that believes one particular person is signed in.
 *
 * @param database the test connections
 * @param userId who every request is from
 * @returns an app with `request`, as Hono provides it
 */
export function testServer(database: TestDatabase, userId: string): Hono {
  const auth = {
    api: {
      getSession: () =>
        Promise.resolve({
          user: {
            id: userId,
            name: userId,
            email: `${userId}@neuron.test`,
            image: null,
            // Verified, because these tests are about the collection rather
            // than about signing in. The unverified case has its own tests,
            // against the real Better Auth, in src/auth/.
            emailVerified: true,
          },
          session: { passwordChangeRequired: false },
        }),
    },
  } as unknown as Auth;

  const db = appClient(database);

  return mountCollection(
    new Hono(),
    {
      db,
      // The routes that need this are the ones about leaving, and those are
      // covered where the account deletion is, not here.
      authDb: db as unknown as AuthDatabase,
      auth,
      limiter: createPermissiveRateLimiter(),
      requireVerifiedEmail: false,
    },
    'http://localhost:8787',
  );
}

/** A server that believes nobody is signed in. */
export function signedOutServer(database: TestDatabase): Hono {
  const auth = { api: { getSession: () => Promise.resolve(null) } } as unknown as Auth;
  const db = appClient(database);

  return mountCollection(
    new Hono(),
    {
      db,
      authDb: db as unknown as AuthDatabase,
      auth,
      limiter: createPermissiveRateLimiter(),
      requireVerifiedEmail: false,
    },
    'http://localhost:8787',
  );
}

/** Reads a JSON response, failing loudly when it is not the status expected. */
export async function json<T>(response: Response, expected: number): Promise<T> {
  const body = (await response.json()) as T;

  if (response.status !== expected) {
    throw new Error(`expected ${expected}, got ${response.status}: ${JSON.stringify(body)}`);
  }

  return body;
}

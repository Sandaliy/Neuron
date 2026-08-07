import { cors } from 'hono/cors';

import { createAuth } from './auth.js';
import { createDb } from './db/client.js';
import { readDatabaseTime } from './db/health.js';
import { loadEnv } from './env.js';
import { createInMemoryRateLimiter } from './rate-limit.js';
import { spikePage } from './spike-page.js';

import type { Hono } from 'hono';

const AUTH_ATTEMPTS_PER_WINDOW = 20;
const AUTH_WINDOW_MS = 60_000;

/**
 * Mounts every route onto an app the caller owns.
 *
 * The Hono instance is created by the caller rather than here, because the
 * Vercel builder looks for an entry file that imports hono itself and refuses
 * to deploy when it only finds an import of a neighbouring module.
 */
export function registerRoutes(app: Hono): Hono {
  const env = loadEnv();
  const db = createDb(env.DATABASE_URL);
  const auth = createAuth({ env, db });
  const authLimiter = createInMemoryRateLimiter({
    limit: AUTH_ATTEMPTS_PER_WINDOW,
    windowMs: AUTH_WINDOW_MS,
  });

  // One origin, no wildcard. Credentials are on because the session lives in a
  // cookie the browser has to send back.
  app.use(
    '*',
    cors({
      origin: env.APP_ORIGIN,
      credentials: true,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['content-type'],
    }),
  );

  app.get('/health', (c) => c.json({ status: 'ok', time: new Date().toISOString() }));

  app.get('/db-check', async (c) => {
    try {
      return c.json({ status: 'ok', databaseTime: await readDatabaseTime(db) });
    } catch {
      // The reason stays in the server logs. The caller gets a sentence it can
      // act on, never a driver error or a connection string.
      return c.json(
        { status: 'error', message: 'The database did not answer. Check DATABASE_URL and retry.' },
        503,
      );
    }
  });

  app.get('/me', async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    if (!session) {
      return c.json({ message: 'You are not signed in. Sign in and try again.' }, 401);
    }

    return c.json({ user: session.user });
  });

  // Rate limiting sits in front of the auth routes only, keyed by client
  // address. No email, no password, nothing identifying goes into the key.
  app.use('/api/auth/*', async (c, next) => {
    if (c.req.method !== 'POST') {
      return next();
    }

    const address = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const decision = authLimiter.take(address, Date.now());

    if (!decision.allowed) {
      c.header('retry-after', String(decision.retryAfterSeconds));

      return c.json(
        {
          message: `Too many attempts. Wait ${decision.retryAfterSeconds} seconds and try again.`,
        },
        429,
      );
    }

    return next();
  });

  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

  // TEMPORARY. DELETE IN PHASE 5.
  app.get('/spike', (c) => c.html(spikePage));

  app.notFound((c) => c.json({ message: 'No such address.' }, 404));

  return app;
}

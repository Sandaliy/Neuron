import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { uuidV7 } from '@neuron/shared';

import { createAuth } from './auth.js';
import { addressFromHeaders, clientAddress, requireSession, signedIn } from './context.js';
import { createAuthDb, createDb } from './db/client.js';
import { readDatabaseTime } from './db/health.js';
import { loadEnv } from './env.js';
import { ApiError, respondWithError } from './errors.js';
import { createMailer } from './mailer.js';
import { openApiDocument } from './openapi.js';
import { isTrustedOrigin } from './origins.js';
import {
  AUTH_ACCOUNT_LIMIT,
  AUTH_LIMIT,
  SYNC_LIMIT,
  WRITE_LIMIT,
  createRateLimiter,
} from './rate-limit.js';
import { accountRoutes } from './routes/account.js';
import { cardRoutes, unlockRoute } from './routes/cards.js';
import { deckRoutes } from './routes/decks.js';
import { noteRoutes } from './routes/notes.js';
import { reviewRoutes } from './routes/reviews.js';
import { importRoutes, presetRoutes } from './routes/study.js';
import { syncRoutes } from './routes/sync.js';

import type { RequestBindings, ServerParts } from './context.js';
import type { AuthDatabase, Database } from './db/client.js';
import type { Env } from './env.js';
import type { Mailer } from './mailer.js';
import type { RateLimitRule } from './rate-limit.js';
import type { Context, MiddlewareHandler } from 'hono';

/**
 * Mounts every route onto an app the caller owns.
 *
 * The Hono instance is created by the caller rather than here, because the
 * Vercel builder looks for an entry file that imports hono itself and refuses
 * to deploy when it only finds an import of a neighbouring module.
 */
export function registerRoutes(app: Hono): Hono {
  const env = loadEnv();

  return mountApp(app, {
    env,
    db: createDb(env.DATABASE_URL),
    authDb: createAuthDb(env.DATABASE_URL_AUTH),
    mailer: createMailer(env),
  });
}

/** What a whole server is built from. */
export interface AppParts {
  readonly env: Env;
  readonly db: Database;
  readonly authDb: AuthDatabase;
  readonly mailer: Mailer;
}

/**
 * The whole api, from parts the caller supplies.
 *
 * Split out of `registerRoutes` so the authentication tests can stand a real
 * server up against the test database with the flags set however the test
 * needs them, and read the verification token back out of the mailer they
 * passed in. Every one of those tests runs this exact function, so what they
 * cover is the server rather than an arrangement resembling it.
 *
 * @param app the app to mount onto
 * @param parts the environment, the two connections, and the mailer
 * @returns the same app
 */
export function mountApp(app: Hono, parts: AppParts): Hono {
  const { env, db, authDb, mailer } = parts;
  const auth = createAuth({ env, db: authDb, mailer, addressOf: addressFromHeaders });
  const limiter = createRateLimiter(db);

  /*
   * The same list Better Auth trusts, never a wildcard `*` in the header.
   *
   * Credentials are on because the session lives in a cookie the browser has to
   * send back, and a browser refuses `Access-Control-Allow-Origin: *` outright
   * when they are. Answering with the origin that asked, and only when it is on
   * the list, is what keeps both true at once.
   *
   * Reading from the same parsed list as the origin check matters more than it
   * looks: when these two disagree, a request passes one and is refused by the
   * other, and the failure appears in the browser as a network error with no
   * body to read.
   */
  app.use(
    '*',
    cors({
      origin: (origin) => (isTrustedOrigin(env.APP_ORIGIN, origin) ? origin : null),
      credentials: true,
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['content-type'],
    }),
  );

  app.get('/health', (context) =>
    context.json({
      status: 'ok',
      time: new Date().toISOString(),
      /*
       * The addresses this deployment answers to, so the question can be
       * answered with one request instead of by reading a dashboard.
       *
       * Not a secret: every one of these is already visible in the CORS header
       * of any request that asks. Saying it here is what turns "sign in is
       * refused and I cannot see why" into one curl.
       */
      canonicalUrl: env.APP_ORIGIN.canonical,
      trustedOrigins: env.APP_ORIGIN.trusted,
      // Both are visible from the sign in screen anyway: whether it offers a
      // registration form, and whether it asks for a confirmation link. Saying
      // so here is what makes a fresh deploy checkable without a browser.
      registrationOpen: env.AUTH_REGISTRATION_OPEN,
      emailVerificationRequired: env.AUTH_REQUIRE_EMAIL_VERIFICATION,
    }),
  );

  app.get('/db-check', async (context) => {
    try {
      return context.json({ status: 'ok', databaseTime: await readDatabaseTime(db) });
    } catch (error) {
      throw new ApiError('service_unavailable', { cause: error });
    }
  });

  /**
   * Rate limiting in front of the auth routes, twice over.
   *
   * Once per address, which catches a script working through a list of
   * passwords, and once per account, which catches the same script spread over
   * a botnet where each address only tries a few times. Neither key is stored
   * in the clear: both are hashed before they reach the table.
   */
  app.use('/api/auth/*', async (context, next) => {
    if (context.req.method !== 'POST') {
      return next();
    }

    await spend(AUTH_LIMIT, clientAddress(context));

    const account = await accountFromBody(context.req.raw);

    if (account) {
      await spend(AUTH_ACCOUNT_LIMIT, account);
    }

    return next();
  });

  /**
   * Better Auth answers for itself, with a correlation id added on the way out.
   *
   * Its refusals carry a code and an English sentence and nothing to find them
   * by, so "sign in does not work" meant reading the log by timestamp and
   * hoping. Every failure now leaves with an id that is also in the log line,
   * and the origin of a refused request is named there, because that one fact
   * is the whole diagnosis when a deployment is reached by the wrong address.
   *
   * The body is added to rather than replaced. Better Auth's own client reads
   * `code` off it, and rewriting the shape here would break every screen to
   * make a log line nicer.
   */
  app.on(['GET', 'POST'], '/api/auth/*', async (context) => {
    const response = await auth.handler(context.req.raw);

    return response.ok ? response : traceable(response, context);
  });

  mountCollection(
    app,
    {
      db,
      authDb,
      auth,
      limiter,
      requireVerifiedEmail: env.AUTH_REQUIRE_EMAIL_VERIFICATION,
    },
    env.APP_ORIGIN.canonical,
  );

  return app;

  /**
   * Spends one attempt, and refuses with a wait when there are none left.
   *
   * @param rule which limit
   * @param identifier what is being limited
   */
  async function spend(rule: RateLimitRule, identifier: string): Promise<void> {
    const decision = await limiter.take(rule, identifier, new Date());

    if (!decision.allowed) {
      throw new ApiError('rate_limited', {
        details: { retryAfterSeconds: decision.retryAfterSeconds },
      });
    }
  }
}

/**
 * Everything behind a session, mounted on an app the caller owns.
 *
 * Separate from the function above so that a test can supply its own parts: a
 * real database and a stubbed session, which is what makes the routes testable
 * without standing up Better Auth and signing somebody in.
 *
 * @param app the app to mount onto
 * @param parts the database connections, the auth instance and the limiter
 * @param baseUrl where the api answers, for the generated description
 * @returns the same app
 */
export function mountCollection(app: Hono, parts: ServerParts, baseUrl: string): Hono {
  const limiter = parts.limiter;

  // Everything answers in one shape, including the failures nobody wrote a
  // handler for. A route can throw and be sure the caller gets a code and a
  // correlation id rather than a stack trace.
  app.onError(respondWithError);

  /**
   * Everything from here needs a session, and everything from here sits under
   * `/api`.
   *
   * The middleware builds the repositories for whoever signed in and puts them
   * on the request. There is no other way to reach the database from a handler,
   * and no way to build them without a user, so a handler cannot read somebody
   * else's rows by forgetting a clause.
   *
   * A sub app rather than routes on the app itself, because everything the
   * browser asks for has to sit under one prefix: the web app forwards `/api`
   * to this deployment with a single path preserving rule, and the browser must
   * never see a second origin or it will not send the session cookie. Better
   * Auth already answered under `/api/auth`. The collection used to answer at
   * the root, so no one rule could have covered both.
   *
   * The error handler and the not found handler stay on the app outside this
   * one. Hono runs a sub app's own error handler in place of the parent's when
   * it has one, so registering `onError` here would quietly take over the shape
   * of every failure under `/api`.
   */
  const api = new Hono<RequestBindings>();

  /**
   * Each resource twice: the collection and everything under it.
   *
   * Hono treats `/decks` and `/decks/*` as different patterns, so a middleware
   * registered only on the second would leave `POST /decks` open. Listing both
   * is duplication; a route that answered without a session would be a hole.
   */
  const collections = [
    '/decks',
    '/notes',
    '/cards',
    '/presets',
    '/imports',
    '/reviews',
    '/account',
  ];

  for (const path of [...collections, '/sync']) {
    api.use(path, requireSession(parts));
    api.use(`${path}/*`, requireSession(parts));
  }

  api.use('/docs', requireSession(parts));

  // The generous limits, per account rather than per address, because these are
  // requests from somebody already signed in and the address they arrive from
  // changes every time a phone moves between wifi and a mobile network.
  for (const path of collections) {
    api.use(path, perAccount(WRITE_LIMIT));
    api.use(`${path}/*`, perAccount(WRITE_LIMIT));
  }

  // Sync gets its own, higher, because a phone coming back from a week offline
  // pushes a burst and that burst is the system working.
  api.use('/sync', perAccount(SYNC_LIMIT));
  api.use('/sync/*', perAccount(SYNC_LIMIT));

  api.route('/decks', deckRoutes());
  api.route('/notes', noteRoutes());
  api.route('/notes', unlockRoute());
  api.route('/cards', cardRoutes());
  api.route('/presets', presetRoutes());
  api.route('/imports', importRoutes());
  api.route('/reviews', reviewRoutes());
  api.route('/sync', syncRoutes());
  api.route('/account', accountRoutes(parts));

  /**
   * The api described, behind a session.
   *
   * Generated from the same schemas the routes validate with, so it cannot
   * drift. Behind a session because a public description of every endpoint is a
   * head start nobody needs, and the only people who want it are already
   * signed in.
   */
  // The document's server url carries the prefix the routes are mounted
  // behind, so the paths in it are the paths a client types.
  api.get('/docs', (context) => context.json(openApiDocument(new URL('/api', baseUrl).toString())));

  app.route('/api', api);

  app.notFound((context) => respondWithError(new ApiError('not_found'), context));

  return app;

  /** The generous limits, keyed on the person signed in. */
  function perAccount(rule: RateLimitRule): MiddlewareHandler<RequestBindings> {
    return async (context, next) => {
      const decision = await limiter.take(rule, signedIn(context).id, new Date());

      if (!decision.allowed) {
        throw new ApiError('rate_limited', {
          details: { retryAfterSeconds: decision.retryAfterSeconds },
        });
      }

      return next();
    };
  }
}

/**
 * The origin checks, by the name Better Auth gives each of them.
 *
 * All five mean the same thing: the page asking is at an address this
 * deployment does not trust, so the request was refused before a password was
 * looked at. Worth telling apart in the log from a wrong password, because the
 * fix is a configuration change and not a person remembering something.
 */
const ORIGIN_REFUSALS = new Set([
  'INVALID_ORIGIN',
  'MISSING_OR_NULL_ORIGIN',
  'CROSS_SITE_NAVIGATION_LOGIN_BLOCKED',
  'INVALID_CALLBACK_URL',
  'INVALID_REDIRECT_URL',
]);

/**
 * Logs a failure Better Auth produced and gives it back with an id on it.
 *
 * @param response what Better Auth answered
 * @param context the request, for the method, the path and the origin
 * @returns the same failure, carrying a correlationId
 */
async function traceable(response: Response, context: Context): Promise<Response> {
  const correlationId = uuidV7();
  const path = new URL(context.req.url).pathname;

  let body: unknown;

  try {
    body = await response.clone().json();
  } catch {
    body = undefined;
  }

  const code =
    typeof body === 'object' && body !== null && 'code' in body
      ? String((body as { code: unknown }).code)
      : 'unknown';

  const line = `[${correlationId}] ${context.req.method} ${path} -> ${response.status} ${code}`;

  if (ORIGIN_REFUSALS.has(code)) {
    // The origin is the diagnosis. Without it this line says a request was
    // refused and leaves the reader to guess which address it came from.
    console.warn(`${line} from ${context.req.header('origin') ?? 'no origin header'}`);
  } else if (response.status >= 500) {
    console.error(line);
  } else {
    console.warn(line);
  }

  if (typeof body !== 'object' || body === null) {
    return response;
  }

  /*
   * Every header Better Auth set is kept, because some failures still carry a
   * cookie. The two that describe the old body are dropped, since the body is
   * a byte longer than it was.
   */
  const headers = new Headers(response.headers);

  headers.delete('content-length');
  headers.delete('content-encoding');
  headers.set('content-type', 'application/json');

  return new Response(JSON.stringify({ ...body, correlationId }), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * The account an auth request is about, for the second limit.
 *
 * Read out of the body and hashed before it goes anywhere, so no address is
 * stored. A body that is not JSON, or one with no email in it, simply gives
 * nothing: the per address limit still applies, and a request with no account
 * to attack cannot be attacking one.
 *
 * @param request the live request, cloned here because reading a body consumes it
 * @returns the address, lowercased, or undefined
 */
async function accountFromBody(request: Request): Promise<string | undefined> {
  try {
    const body: unknown = await request.clone().json();

    if (typeof body !== 'object' || body === null || !('email' in body)) {
      return undefined;
    }

    const email = (body as { email: unknown }).email;

    return typeof email === 'string' && email.length > 0 ? email.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

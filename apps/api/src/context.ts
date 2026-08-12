import { createRepositories } from './db/repositories/index.js';
import { ApiError } from './errors.js';

import type { Auth } from './auth.js';
import type { AuthDatabase, Database } from './db/client.js';
import type { Repositories } from './db/repositories/index.js';
import type { RateLimiter } from './rate-limit.js';
import type { Context, MiddlewareHandler } from 'hono';

/**
 * What every route handler is given.
 *
 * The repositories arrive already bound to the person who signed in. There is
 * no way to reach the database in a handler except through them, and no way to
 * build them without a user, so a handler cannot read somebody else's rows by
 * forgetting a clause. That is the first of the two barriers around user data;
 * the second is in the database and applies whatever this layer does.
 */

/** The signed in person, as much of them as a route ever needs. */
export interface SignedIn {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly image: string | null;
}

export interface RequestBindings {
  Variables: {
    user: SignedIn;
    repositories: Repositories;
  };
}

export interface ServerParts {
  readonly db: Database;
  /**
   * The authentication connection.
   *
   * Reachable from exactly one route outside Better Auth itself: deleting an
   * account, which has to remove the credentials and the sessions and cannot do
   * that over the application connection, because the application connection
   * cannot see them.
   */
  readonly authDb: AuthDatabase;
  readonly auth: Auth;
  readonly limiter: RateLimiter;
  /**
   * Whether an unconfirmed address is allowed to reach the collection.
   *
   * Comes from AUTH_REQUIRE_EMAIL_VERIFICATION. False today, because there is
   * no mail sender, and the path behind it is written and tested regardless.
   */
  readonly requireVerifiedEmail: boolean;
}

/**
 * Refuses anything without a session, and hands the rest their repositories.
 *
 * @param parts the server's shared pieces
 * @returns middleware to put in front of every route that touches a collection
 */
export function requireSession(parts: ServerParts): MiddlewareHandler<RequestBindings> {
  return async (context, next) => {
    const session = await parts.auth.api.getSession({ headers: context.req.raw.headers });

    if (!session) {
      throw new ApiError('not_authenticated');
    }

    /**
     * A session opened with a recovery code may do exactly one thing.
     *
     * That one thing lives under `/api/auth/recovery/complete`, which is not
     * behind this middleware, so refusing here refuses everything else: the
     * whole collection, the account, sync. A recovery code is the entire
     * credential, and until it has been traded for a password the account is
     * only half in the hands of whoever is holding it.
     */
    if (session.session.passwordChangeRequired) {
      throw new ApiError('password_change_required');
    }

    /**
     * An account that has not confirmed its address, when that is required.
     *
     * Better Auth refuses to sign such an account in at all while the flag is
     * on, so this is the second barrier rather than the first. It matters
     * because the flag can be turned on while somebody already holds a session
     * from before it was.
     */
    if (parts.requireVerifiedEmail && !session.user.emailVerified) {
      throw new ApiError('email_not_verified');
    }

    context.set('user', {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image ?? null,
    });
    context.set('repositories', createRepositories(parts.db, session.user.id));

    return next();
  };
}

/** The signed in person. Only callable behind requireSession. */
export function signedIn(context: Context<RequestBindings>): SignedIn {
  return context.get('user');
}

/** The repositories for this request. Only callable behind requireSession. */
export function repositoriesOf(context: Context<RequestBindings>): Repositories {
  return context.get('repositories');
}

/**
 * The caller's address, as far as it can be known behind a proxy.
 *
 * Vercel sets x-forwarded-for and the leftmost entry is the client. It can be
 * forged by anyone talking to the api directly, which is why it keys the limit
 * on signing in but never decides who anybody is.
 *
 * @param context the request
 * @returns the address, or a constant when there is none to read
 */
export function clientAddress(context: Context): string {
  return addressFromHeaders(context.req.raw.headers);
}

/**
 * The same, from bare headers.
 *
 * Better Auth hands its plugins a `Headers` rather than a Hono context, and the
 * registration cap has to key on the same address the rate limiter does. One
 * function, so the two cannot come to different conclusions about who is
 * calling.
 *
 * @param headers the request headers, if there are any
 * @returns the address, or a constant when there is none to read
 */
export function addressFromHeaders(headers: Headers | undefined): string {
  const forwarded = headers?.get('x-forwarded-for')?.split(',')[0]?.trim();

  return forwarded ?? headers?.get('x-real-ip') ?? 'unknown';
}

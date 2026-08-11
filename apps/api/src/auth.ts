import { hash, verify } from '@node-rs/argon2';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createAuthMiddleware } from 'better-auth/api';
import { eq } from 'drizzle-orm';

import { authSchema, session as sessionTable } from './db/schema/index.js';

import type { AuthDatabase } from './db/client.js';
import type { Env } from './env.js';

/**
 * Password hashing parameters. These are the values OWASP recommends for
 * argon2id: 19 MiB of memory, two passes, one lane. Hashing takes roughly
 * 100 ms, which is the point. It is what makes a stolen table useless.
 */
const argon2Options = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

const THIRTY_DAYS_IN_SECONDS = 60 * 60 * 24 * 30;
const ONE_DAY_IN_SECONDS = 60 * 60 * 24;
const ONE_HOUR_IN_SECONDS = 60 * 60;

/**
 * The endpoints after which every other session has to go.
 *
 * Changing a password is how someone reacts to thinking their account has been
 * reached. If the sessions opened with the old password survive it, the action
 * did nothing about the thing they were worried about. Better Auth leaves this
 * to a flag the client may or may not send, so it is decided here instead.
 */
const CREDENTIAL_CHANGE_PATHS = ['/change-password', '/set-password', '/reset-password'];

export type Auth = ReturnType<typeof createAuth>;

/**
 * Whether sign in with Google can be offered.
 *
 * @param env the parsed environment
 * @returns true when both halves of the credential are present
 */
export function googleIsConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID) && Boolean(env.GOOGLE_CLIENT_SECRET);
}

export function createAuth({ env, db }: { env: Env; db: AuthDatabase }) {
  const isProduction = env.NODE_ENV === 'production';

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_ORIGIN],

    database: drizzleAdapter(db, { provider: 'pg', schema: authSchema }),

    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      /**
       * Verification stays off until there is a domain to send mail from.
       *
       * Not an oversight and not a shortcut taken for speed: a free mail
       * service will only deliver to arbitrary addresses from a verified
       * domain, and the domain is deferred. Written down in the known
       * limitations section of docs/architecture.md, with the phase that
       * closes it.
       */
      requireEmailVerification: false,
      revokeSessionsOnPasswordReset: true,
      password: {
        hash: (password) => hash(password, argon2Options),
        verify: ({ hash: stored, password }) => verify(stored, password, argon2Options),
      },
    },

    /**
     * Google, when the credentials are there.
     *
     * Absent, the object is empty and the provider simply is not offered, so
     * the server runs before anyone has been through the Google console.
     */
    socialProviders: googleIsConfigured(env)
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID ?? '',
            clientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
          },
        }
      : {},

    account: {
      accountLinking: {
        /**
         * Signing in with Google using the address of an existing password
         * account attaches to that account rather than making a second one.
         *
         * Google is trusted for this because it tells us whether it verified
         * the address itself, which is a stronger claim than the one we can
         * make without a mail sender of our own.
         */
        enabled: true,
        trustedProviders: ['google'],
        requireLocalEmailVerified: false,
      },
    },

    session: {
      expiresIn: THIRTY_DAYS_IN_SECONDS,
      // The session is extended when it is used, so an active user is never
      // signed out at the thirty day mark. Signing in always writes a new row
      // with a new token, so the token in the cookie is rotated by definition.
      updateAge: ONE_DAY_IN_SECONDS,
      /**
       * How recently someone has to have signed in for a change of password or
       * email to be accepted. An hour, because the alternative is that a
       * borrowed laptop left open a month ago is enough.
       */
      freshAge: ONE_HOUR_IN_SECONDS,
    },

    user: {
      // Deleting an account goes through DELETE /account, which anonymises the
      // row and marks it for the cleanup that runs as the database owner.
      // Better Auth's own version removes the user row, and the cascade from
      // that would hit the trigger that keeps the review log append only.
      deleteUser: { enabled: false },
    },

    hooks: {
      after: createAuthMiddleware(async (context) => {
        if (!CREDENTIAL_CHANGE_PATHS.includes(context.path)) {
          return;
        }

        const userId = context.context.session?.session.userId;

        if (!userId) {
          return;
        }

        // Every session, including the one that made the request. The person
        // signs in again with the password they just chose, which is the
        // behaviour that matches what they were trying to achieve.
        await db.delete(sessionTable).where(eq(sessionTable.userId, userId));
      }),
    },

    advanced: {
      useSecureCookies: isProduction,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction,
      },
    },
  });
}

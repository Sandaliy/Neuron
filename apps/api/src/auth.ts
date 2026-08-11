import { hash, verify } from '@node-rs/argon2';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import { schema } from './db/schema/index.js';

import type { Database } from './db/client.js';
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

export type Auth = ReturnType<typeof createAuth>;

export function createAuth({ env, db }: { env: Env; db: Database }) {
  const isProduction = env.NODE_ENV === 'production';

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_ORIGIN],

    database: drizzleAdapter(db, { provider: 'pg', schema }),

    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      // Verification is off for the spike. It turns on in phase 4, together
      // with the email sender, and then this becomes true.
      requireEmailVerification: false,
      password: {
        hash: (password) => hash(password, argon2Options),
        verify: ({ hash: stored, password }) => verify(stored, password, argon2Options),
      },
    },

    // Google sign in goes here in phase 4. It needs GOOGLE_CLIENT_ID and
    // GOOGLE_CLIENT_SECRET, which are already listed in .env.example.
    socialProviders: {},

    session: {
      expiresIn: THIRTY_DAYS_IN_SECONDS,
      // The session is extended when it is used, so an active user is never
      // signed out at the thirty day mark.
      updateAge: ONE_DAY_IN_SECONDS,
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

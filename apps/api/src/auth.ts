import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createAuthMiddleware } from 'better-auth/api';
import { twoFactor } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';

import { hashSecret, verifySecret } from './auth/hashing.js';
import { neuronAuth } from './auth/plugin.js';
import { storeHashed } from './auth/reset-tokens.js';
import { TOTP_DIGITS, TOTP_PERIOD_SECONDS } from './auth/totp-replay.js';
import { authSchema, session as sessionTable } from './db/schema/index.js';
import { actionLink } from './mailer.js';

import type { AuthDatabase } from './db/client.js';
import type { Env } from './env.js';
import type { Mailer } from './mailer.js';

/**
 * Better Auth, configured.
 *
 * Email and password only. Google was removed in phase 4.5, on purpose, and
 * what putting it back would involve is written down in docs/architecture.md so
 * that a future reader does not take its absence for an oversight.
 *
 * Three plugins are in use, and no cryptography is written here:
 *
 *   `two-factor`, which brings TOTP and the codes for a lost phone. The secret
 *     and those codes are encrypted with BETTER_AUTH_SECRET before they reach
 *     the database.
 *   `neuron-auth`, this project's own, in `src/auth/plugin.ts`. It holds the
 *     account recovery codes, the password policy, the two guards on open
 *     registration, and replay rejection for authenticator codes.
 *   the Drizzle adapter, over the authentication connection.
 */

const THIRTY_DAYS_IN_SECONDS = 60 * 60 * 24 * 30;
const ONE_DAY_IN_SECONDS = 60 * 60 * 24;
const ONE_HOUR_IN_SECONDS = 60 * 60;

/**
 * How long a verification or reset link lasts.
 *
 * An hour. Long enough to walk away from the computer and come back, short
 * enough that a link sitting in an inbox somebody else later reads is usually
 * already dead.
 */
const LINK_LIFETIME_IN_SECONDS = ONE_HOUR_IN_SECONDS;

/**
 * The endpoints after which every other session has to go.
 *
 * Changing a password is how someone reacts to thinking their account has been
 * reached. If the sessions opened with the old password survive it, the action
 * did nothing about the thing they were worried about. Better Auth leaves this
 * to a flag the client may or may not send, so it is decided here instead.
 *
 * `/recovery/complete` is deliberately not on this list. The sessions were
 * already all closed when the recovery code was spent, and the one left is the
 * one the person is sitting in front of.
 */
const CREDENTIAL_CHANGE_PATHS = ['/change-password', '/set-password', '/reset-password'];

export type Auth = ReturnType<typeof createAuth>;

export interface CreateAuthOptions {
  readonly env: Env;
  readonly db: AuthDatabase;
  readonly mailer: Mailer;
  /** Where the caller is, for the per address registration cap. */
  readonly addressOf: (headers: Headers | undefined) => string;
}

export function createAuth({ env, db, mailer, addressOf }: CreateAuthOptions) {
  const isProduction = env.NODE_ENV === 'production';

  return betterAuth({
    appName: 'Neuron',
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_ORIGIN],

    database: drizzleAdapter(db, { provider: 'pg', schema: authSchema }),

    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      /**
       * Off, and the whole path behind it is written and tested.
       *
       * There is no mail sender, because a free service will only deliver to
       * arbitrary addresses from a verified domain and the domain is deferred.
       * What this flag controls is not a stub: with it on, an unverified
       * account is refused everywhere, both links expire in an hour, and the
       * tests drive the whole flow by reading the token back out of the
       * LogMailer. Turning mail on is a domain, a provider and this variable.
       *
       * The reset token is a row, consumed on use, and stored as a digest. The
       * verification token is a signed JWT rather than a row, so it is not
       * consumed; using it twice gains nothing, because the second use returns
       * before it would create a session. Both are written up under Known
       * limitations in docs/architecture.md.
       */
      requireEmailVerification: env.AUTH_REQUIRE_EMAIL_VERIFICATION,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: LINK_LIFETIME_IN_SECONDS,
      // The length rules live in packages/shared and are applied by the neuron
      // plugin, which also refuses the passwords a list attack starts with.
      // These two are Better Auth's own floor and ceiling, set to agree.
      minPasswordLength: 10,
      maxPasswordLength: 200,
      password: {
        hash: hashSecret,
        verify: ({ hash: stored, password }) => verifySecret(stored, password),
      },
      sendResetPassword: async ({ user, token }) => {
        // The row Better Auth has just written holds this token in the clear.
        // Rewritten here, before the token leaves the server, so what is kept
        // is a digest and what is mailed is the key.
        await storeHashed(db, token);

        await mailer.send({
          to: user.email,
          subject: 'Reset your Neuron password',
          body: [
            'Somebody asked to reset the password on this account.',
            '',
            actionLink(env.APP_ORIGIN, '/reset-password', token),
            '',
            'The link works once and stops working in an hour.',
            'If this was not you, nothing has changed and you can ignore this.',
          ].join('\n'),
        });
      },
    },

    emailVerification: {
      /**
       * Sent as soon as somebody registers, when verification is on at all.
       *
       * With the flag off this never runs, so nothing reaches the log and
       * nothing waits on a link that is not coming.
       */
      sendOnSignUp: env.AUTH_REQUIRE_EMAIL_VERIFICATION,
      autoSignInAfterVerification: true,
      expiresIn: LINK_LIFETIME_IN_SECONDS,
      sendVerificationEmail: ({ user, token }) =>
        mailer.send({
          to: user.email,
          subject: 'Confirm your email for Neuron',
          body: [
            'Confirm this address to finish setting up your account.',
            '',
            actionLink(env.APP_ORIGIN, '/verify-email', token),
            '',
            'The link works once and stops working in an hour.',
          ].join('\n'),
        }),
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
      additionalFields: {
        /**
         * Set on the one session a recovery code opens.
         *
         * Declared here so `getSession` returns it, which is what lets the
         * session middleware refuse everything except choosing a password
         * without asking the database a second question on every request.
         */
        passwordChangeRequired: {
          type: 'boolean',
          defaultValue: false,
          // Never set by anything a client sends. Only the recovery endpoint
          // writes it, and only the recovery endpoint clears it.
          input: false,
        },
      },
    },

    user: {
      // Deleting an account goes through DELETE /account, which anonymises the
      // row and marks it for the cleanup that runs as the database owner.
      // Better Auth's own version removes the user row, and the cascade from
      // that would hit the trigger that keeps the review log append only.
      deleteUser: { enabled: false },
    },

    plugins: [
      twoFactor({
        issuer: 'Neuron',
        /**
         * The QR code is not enough on its own.
         *
         * Enrollment stays inactive until the person types a code the app
         * produced, so a QR read wrong, or read into an app that is then
         * deleted, locks nobody out. It is the difference between an optional
         * second factor and a way to lose an account.
         */
        skipVerificationOnEnable: false,
        totpOptions: {
          digits: TOTP_DIGITS,
          period: TOTP_PERIOD_SECONDS,
        },
        backupCodeOptions: {
          /**
           * Encrypted, not left as plain JSON, which is the default.
           *
           * Encrypted rather than hashed, unlike the account recovery codes,
           * and the difference is forced: this plugin has to be able to list
           * the codes that are left, and a hash cannot be read back. Said out
           * loud in the known limitations rather than glossed over.
           */
          storeBackupCodes: 'encrypted',
        },
      }),
      neuronAuth({ env, db, addressOf }),
    ],

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

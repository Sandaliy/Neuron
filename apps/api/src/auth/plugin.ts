import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  getSessionFromCtx,
  sessionMiddleware,
} from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { symmetricDecrypt } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import * as z from 'zod';

import {
  completeRecoverySchema,
  passwordProblem,
  recoverySignInSchema,
  regenerateRecoveryCodesSchema,
} from '@neuron/shared';

import { session as sessionTable, twoFactor } from '../db/schema/index.js';

import { wasteVerificationTime } from './hashing.js';
import {
  countRecoveryCodes,
  isLow,
  issueRecoveryCodes,
  spendRecoveryCode,
} from './recovery-codes.js';
import { recordRegistration, registrationAllowed } from './registration.js';
import { hashIncoming } from './reset-tokens.js';
import { claimStep, matchingStep } from './totp-replay.js';

import type { AuthDatabase } from '../db/client.js';
import type { Env } from '../env.js';
import type { BetterAuthPlugin } from 'better-auth';

/**
 * Everything Neuron adds to Better Auth.
 *
 * Four things, and they are here together because they are all answers to the
 * same fact: there is no mail sender yet, so the account cannot lean on the
 * address for anything.
 *
 *   the two guards on open registration, both temporary
 *   the recovery codes, which are the only way back into an account
 *   the password policy, applied everywhere a password is chosen
 *   replay rejection for authenticator codes
 *
 * Written as a plugin rather than as middleware in front of the handler,
 * because a plugin runs inside Better Auth's request: it can read the parsed
 * body, reach the same adapter, and set the session cookie through the same
 * code path. Middleware outside it would have to reimplement all three, and the
 * reimplementation is where the holes are.
 */

/** The cookie Better Auth sets between the password and the second factor. */
const TWO_FACTOR_COOKIE = 'two_factor';

/**
 * As much of the request as the replay guard reads.
 *
 * Written out rather than imported, because Better Auth's hook context is a
 * deep partial of several types at once and naming the three things this needs
 * says more about what the guard touches than the real type would.
 */
interface TwoFactorContext {
  readonly context: {
    readonly createAuthCookie: (name: string) => { readonly name: string };
    readonly secret: string;
    readonly internalAdapter: {
      readonly findVerificationValue: (identifier: string) => Promise<{ value: string } | null>;
    };
  };
  readonly getSignedCookie: (name: string, secret: string) => Promise<string | undefined | null>;
}

/** Paths where a password is being chosen, so the policy has to apply. */
const PASSWORD_CHOICE_PATHS = [
  '/sign-up/email',
  '/reset-password',
  '/change-password',
  '/set-password',
];

/** Where the field holding the new password is on each of them. */
const PASSWORD_FIELDS = ['password', 'newPassword'] as const;

export interface NeuronAuthOptions {
  readonly env: Env;
  /** The authentication connection, for the tables Better Auth does not own. */
  readonly db: AuthDatabase;
  /** Where the caller is, for the per address registration cap. */
  readonly addressOf: (headers: Headers | undefined) => string;
}

/**
 * Refuses with one of Neuron's error codes.
 *
 * Better Auth answers in its own shape rather than through the api's error
 * handler, because these routes are handed to its handler whole. What can be
 * kept consistent is the code, so the client has one list of codes to translate
 * rather than two.
 *
 * @param status the http status
 * @param code the code from packages/shared
 * @param message what the log should say
 */
function refuse(
  status: 'BAD_REQUEST' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'CONFLICT' | 'TOO_MANY_REQUESTS',
  code: string,
  message: string,
): APIError {
  return APIError.from(status, { message, code });
}

export function neuronAuth(options: NeuronAuthOptions): BetterAuthPlugin {
  const { env, db, addressOf } = options;

  return {
    id: 'neuron-auth',

    endpoints: {
      /**
       * Signing in with a recovery code.
       *
       * No password, because the situation this exists for is not having one.
       * The code is spent, every session the account had is closed, and the
       * session this opens may do exactly one thing: choose a new password.
       */
      recoverySignIn: createAuthEndpoint(
        '/recovery/sign-in',
        { method: 'POST', body: z.any() },
        async (ctx) => {
          const body = recoverySignInSchema.safeParse(ctx.body);

          if (!body.success) {
            throw refuse(
              'BAD_REQUEST',
              'invalid_recovery_code',
              'the body was not a recovery attempt',
            );
          }

          const { email, code } = body.data;
          const user = await ctx.context.internalAdapter.findUserByEmail(email);

          if (!user) {
            // The same work a real attempt does, so the time taken does not say
            // whether this address has an account.
            await wasteVerificationTime(code);

            throw refuse('UNAUTHORIZED', 'invalid_recovery_code', 'no account at that address');
          }

          const result = await spendRecoveryCode(db, user.user.id, code);

          if (!result.spent) {
            throw refuse(
              result.remaining === 0 ? 'FORBIDDEN' : 'UNAUTHORIZED',
              result.remaining === 0 ? 'no_recovery_codes' : 'invalid_recovery_code',
              'the recovery code was wrong or already spent',
            );
          }

          // Everything the account had open, gone. Somebody reaching for a
          // recovery code is somebody who thinks they have lost control of the
          // account, and leaving the other sessions alive would do nothing
          // about the thing they are worried about.
          await ctx.context.internalAdapter.deleteUserSessions(user.user.id);

          // The last argument matters. Without it, `createSession` writes the
          // declared default for every additional field after applying the
          // override, so the flag would be set and then immediately unset, and
          // the session would come out looking like an ordinary one.
          const session = await ctx.context.internalAdapter.createSession(
            user.user.id,
            true,
            { passwordChangeRequired: true },
            true,
          );

          // Through Better Auth's own cookie writer, so this session carries
          // exactly the attributes every other session carries. A cookie set by
          // hand here is a cookie that quietly loses `Secure` the next time the
          // options change.
          await setSessionCookie(ctx, { session, user: user.user });

          return ctx.json({ remaining: result.remaining, passwordChangeRequired: true });
        },
      ),

      /**
       * Finishing what a recovery code started.
       *
       * The only thing the session opened above is allowed to do. Setting the
       * password clears the flag, and from then on it is an ordinary session.
       */
      completeRecovery: createAuthEndpoint(
        '/recovery/complete',
        { method: 'POST', body: z.any(), use: [sessionMiddleware] },
        async (ctx) => {
          const body = completeRecoverySchema.safeParse(ctx.body);

          if (!body.success) {
            throw refuse('BAD_REQUEST', 'weak_password', 'the new password was refused');
          }

          const userId = ctx.context.session.user.id;

          await ctx.context.internalAdapter.updatePassword(
            userId,
            await ctx.context.password.hash(body.data.password),
          );

          // This session survives, because the person is sitting in front of
          // it and has just proved twice over that the account is theirs.
          // Everything else was already closed when the code was spent.
          await db
            .update(sessionTable)
            .set({ passwordChangeRequired: false })
            .where(eq(sessionTable.id, ctx.context.session.session.id));

          return ctx.json({ status: true });
        },
      ),

      /** How many codes are left. */
      recoveryStatus: createAuthEndpoint(
        '/recovery/status',
        { method: 'GET', use: [sessionMiddleware] },
        async (ctx) => {
          const remaining = await countRecoveryCodes(db, ctx.context.session.user.id);

          return ctx.json({ remaining, low: isLow(remaining) });
        },
      ),

      /**
       * A fresh set, which throws away the old set.
       *
       * Costs the current password, because otherwise anybody who reached an
       * unlocked laptop could quietly mint themselves a permanent way back in
       * and the owner would never see a sign of it.
       */
      regenerateRecoveryCodes: createAuthEndpoint(
        '/recovery/regenerate',
        { method: 'POST', body: z.any(), use: [sessionMiddleware] },
        async (ctx) => {
          const body = regenerateRecoveryCodesSchema.safeParse(ctx.body);

          if (!body.success) {
            throw refuse('BAD_REQUEST', 'invalid_credentials', 'no password was given');
          }

          await ctx.context.password.checkPassword(ctx.context.session.user.id, ctx);

          const issued = await issueRecoveryCodes(db, ctx.context.session.user.id);

          return ctx.json({
            recoveryCodes: issued.codes,
            warningKey: 'auth.recoveryCodes.warning',
          });
        },
      ),
    },

    hooks: {
      before: [
        {
          /** The password policy, everywhere a password is chosen. */
          matcher: (context) => PASSWORD_CHOICE_PATHS.includes(context.path ?? ''),
          handler: createAuthMiddleware((ctx) => {
            const body = ctx.body as Record<string, unknown> | undefined;

            for (const field of PASSWORD_FIELDS) {
              const value = body?.[field];

              if (typeof value !== 'string') {
                continue;
              }

              const problem = passwordProblem(value);

              if (problem) {
                throw refuse('BAD_REQUEST', 'weak_password', `the password was ${problem}`);
              }
            }

            return Promise.resolve();
          }),
        },
        {
          /**
           * The reset token, hashed before Better Auth looks it up.
           *
           * The other half of this lives in `sendResetPassword`, which rewrites
           * the row it was stored in. Both halves have to agree, so both use
           * the same function.
           */
          matcher: (context) => context.path === '/reset-password',
          handler: createAuthMiddleware((ctx) => {
            const body = ctx.body as { token?: unknown } | undefined;

            if (body && typeof body.token === 'string') {
              body.token = hashIncoming(body.token);
            }

            return Promise.resolve();
          }),
        },
        {
          /** The two guards on open registration. */
          matcher: (context) => context.path === '/sign-up/email',
          handler: createAuthMiddleware(async (ctx) => {
            if (!env.AUTH_REGISTRATION_OPEN) {
              throw refuse('FORBIDDEN', 'registration_closed', 'registration is closed');
            }

            const allowed = await registrationAllowed(
              db,
              addressOf(ctx.headers),
              env.AUTH_MAX_REGISTRATIONS_PER_DAY,
              new Date(),
            );

            if (!allowed) {
              throw refuse(
                'TOO_MANY_REQUESTS',
                'rate_limited',
                'this address has created its allowance of accounts today',
              );
            }
          }),
        },
        {
          /**
           * Replay rejection for authenticator codes.
           *
           * Before the plugin verifies, not after, because after is too late:
           * by then the code has been accepted and a session exists. The check
           * runs only when the code is genuinely one of this account's, so a
           * wrong code still reaches the plugin and is still counted against
           * the lockout budget.
           */
          matcher: (context) => context.path === '/two-factor/verify-totp',
          handler: createAuthMiddleware(async (ctx) => {
            const code = (ctx.body as { code?: unknown } | undefined)?.code;

            if (typeof code !== 'string') {
              return;
            }

            const userId = await twoFactorSubject(ctx as unknown as TwoFactorContext);

            if (!userId) {
              return;
            }

            const rows = await db
              .select({ secret: twoFactor.secret })
              .from(twoFactor)
              .where(eq(twoFactor.userId, userId));

            const stored = rows[0]?.secret;

            if (!stored) {
              return;
            }

            const secret = await symmetricDecrypt({ key: ctx.context.secretConfig, data: stored });
            const step = await matchingStep(secret, code, new Date());

            // Not one of ours. Let the plugin refuse it, so the failure is
            // counted where every other failure is counted.
            if (step === undefined) {
              return;
            }

            if (!(await claimStep(db, userId, step))) {
              throw refuse(
                'UNAUTHORIZED',
                'two_factor_code_reused',
                'that authenticator code has already been used',
              );
            }
          }),
        },
      ],

      after: [
        {
          /**
           * Registration succeeded, so the codes are issued and the address is
           * charged for the account it just made.
           *
           * After rather than before, because both are about an account that
           * exists. A count incremented before the insert would charge somebody
           * for a registration that failed on a duplicate address.
           */
          matcher: (context) => context.path === '/sign-up/email',
          handler: createAuthMiddleware(async (ctx) => {
            const returned = ctx.context.returned;

            if (!returned || typeof returned !== 'object' || !('user' in returned)) {
              return;
            }

            const user = (returned as { user: { id?: unknown } }).user;

            if (typeof user?.id !== 'string') {
              return;
            }

            const issued = await issueRecoveryCodes(db, user.id);

            await recordRegistration(db, addressOf(ctx.headers), new Date());

            ctx.context.returned = {
              ...returned,
              recoveryCodes: issued.codes,
              warningKey: 'auth.recoveryCodes.warning',
            };
          }),
        },
      ],
    },
  };
}

/**
 * Whose second factor a verification request is about.
 *
 * Two cases. Somebody already signed in, confirming an enrollment, has a
 * session. Somebody halfway through signing in does not: they hold the two
 * factor cookie Better Auth set when the password checked out, which points at
 * a verification row holding the user id.
 *
 * Resolved the same way the plugin resolves it, and read only: nothing is
 * consumed here, so the plugin still finds what it expects.
 *
 * @param ctx the request, as the middleware receives it
 * @returns the user id, or undefined when neither is present
 */
async function twoFactorSubject(ctx: TwoFactorContext): Promise<string | undefined> {
  const session = await getSessionFromCtx(ctx as never);

  if (session) {
    return session.user.id;
  }

  const cookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE);
  const signed = await ctx.getSignedCookie(cookie.name, ctx.context.secret);

  if (!signed) {
    return undefined;
  }

  return (await ctx.context.internalAdapter.findVerificationValue(signed))?.value;
}

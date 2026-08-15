import { twoFactorClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

import { API_ERROR_CODES } from '@neuron/shared';
import type { MessageKey, MessageValues } from '@neuron/shared';

import { API_BASE } from './api';

import type { FailureCode } from './api';

/**
 * A request that never arrived, turned into an answer.
 *
 * Better Auth only fills in `error` when a response came back. When the
 * request never leaves the device its client throws instead, out of the middle
 * of a submit handler that is not watching for it, and the button spins for
 * ever with nothing on screen. Answering with a status of our own keeps every
 * caller on one shape and lets the person be told the truth, which is that
 * this device could not reach anything.
 *
 * 599 is unassigned, so it cannot be confused with something a server said.
 */
const UNREACHABLE = 'NETWORK_UNREACHABLE';

const fetchOrSaySo: typeof fetch = async (input, init) => {
  try {
    return await fetch(input, init);
  } catch (cause) {
    // An abort is the app tidying up after itself, not a failure to report.
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      throw cause;
    }

    return new Response(JSON.stringify({ code: UNREACHABLE }), {
      status: 599,
      headers: { 'content-type': 'application/json' },
    });
  }
};

/**
 * Better Auth, from the browser.
 *
 * No `baseURL`: the client then talks to the origin the page came from, which
 * after the rewrite is the api. Handing it the api's own hostname would put the
 * session cookie on a different site and the browser would stop sending it
 * back, which looks exactly like being signed out at random.
 *
 * The two factor plugin is the client half of the server plugin in
 * `apps/api/src/auth.ts`. The recovery endpoints below are Neuron's own, from
 * `apps/api/src/auth/plugin.ts`, and are called directly because their server
 * plugin is not published to this package.
 */
export const authClient = createAuthClient({
  basePath: `${API_BASE}/auth`,
  plugins: [twoFactorClient()],
  fetchOptions: { customFetchImpl: fetchOrSaySo },
});

export const { useSession, signIn, signOut, signUp, twoFactor, changePassword } = authClient;

/**
 * Better Auth's own error codes, in the vocabulary the catalogue speaks.
 *
 * Better Auth answers with its own upper case names, and Neuron's endpoints
 * answer with the codes in `packages/shared`. Both reach a person as a
 * sentence, so both have to arrive at the same set of keys.
 */
const BETTER_AUTH_CODES: Record<string, FailureCode> = {
  INVALID_EMAIL_OR_PASSWORD: 'invalid_credentials',
  INVALID_PASSWORD: 'invalid_credentials',
  USER_NOT_FOUND: 'invalid_credentials',
  USER_ALREADY_EXISTS: 'email_taken',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'email_taken',
  PASSWORD_TOO_SHORT: 'weak_password',
  PASSWORD_TOO_LONG: 'weak_password',
  EMAIL_NOT_VERIFIED: 'email_not_verified',
  INVALID_TOKEN: 'invalid_token',
  TOKEN_EXPIRED: 'invalid_token',
  INVALID_TWO_FACTOR_AUTHENTICATION: 'invalid_two_factor_code',
  INVALID_TWO_FACTOR_COOKIE: 'two_factor_unavailable',
  TWO_FACTOR_NOT_ENABLED: 'two_factor_unavailable',
  OTP_NOT_ENABLED: 'two_factor_unavailable',
  BACKUP_CODES_NOT_ENABLED: 'two_factor_unavailable',
  [UNREACHABLE]: 'network_unreachable',
  /*
   * The page is at an address the server does not trust.
   *
   * Every one of these is the same situation wearing a different name: the
   * origin the browser sent is not on the api's list, so the request is refused
   * before a password is ever looked at. It is a deployment mistake rather than
   * anything the person did, and until this was mapped it arrived on screen as
   * a flat 403 and the words "You cannot do that", which sent the reader
   * looking at their own password.
   */
  INVALID_ORIGIN: 'untrusted_origin',
  MISSING_OR_NULL_ORIGIN: 'untrusted_origin',
  CROSS_SITE_NAVIGATION_LOGIN_BLOCKED: 'untrusted_origin',
  INVALID_CALLBACK_URL: 'untrusted_origin',
  INVALID_REDIRECT_URL: 'untrusted_origin',
};

/** What Better Auth hands back when a call fails. */
export interface AuthError {
  readonly code?: string | undefined;
  readonly status?: number | undefined;
  readonly message?: string | undefined;
  /**
   * The id this failure is written under in the server log.
   *
   * Not Better Auth's: the api adds it to every failure on the way out, so
   * that a refusal nobody predicted can be traced to one request instead of
   * being looked for by timestamp.
   */
  readonly correlationId?: string | undefined;
}

/**
 * Turns an authentication failure into a message key.
 *
 * Never uses `error.message`. Better Auth writes those in English, and half the
 * people using this read Russian.
 *
 * Three outcomes, deliberately: the server refused and said why, the request
 * never arrived, or nobody predicted this. The last one carries the correlation
 * id, because an unexpected failure that cannot be found in the log is one
 * nobody will ever fix.
 *
 * @param error what the call answered with
 * @returns the key and the values its placeholders need
 */
export function describeAuthError(error: AuthError | null | undefined): {
  key: MessageKey;
  values: MessageValues;
} {
  const code = error?.code;
  const correlationId = error?.correlationId ?? '';

  if (code && (API_ERROR_CODES as readonly string[]).includes(code)) {
    return { key: `error.${code}` as MessageKey, values: { seconds: 60, correlationId } };
  }

  const mapped = code ? BETTER_AUTH_CODES[code] : undefined;

  if (mapped) {
    return { key: `error.${mapped}` as MessageKey, values: { seconds: 60, correlationId } };
  }

  if (error?.status === 429) {
    return { key: 'error.rate_limited', values: { seconds: 60 } };
  }

  /*
   * Nothing on either list. Saying anything about the password here would be a
   * guess, and a guess sends somebody to reset a password that was fine, so
   * this says only what is certainly true and hands over the reference.
   */
  return correlationId.length > 0
    ? { key: 'error.internal_error', values: { correlationId } }
    : { key: 'error.unexpected', values: {} };
}

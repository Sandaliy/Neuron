import { twoFactorClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

import { API_ERROR_CODES } from '@neuron/shared';
import type { ApiErrorCode, MessageKey, MessageValues } from '@neuron/shared';

import { API_BASE } from './api';

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
});

export const { useSession, signIn, signOut, signUp, twoFactor, changePassword } = authClient;

/**
 * Better Auth's own error codes, in the vocabulary the catalogue speaks.
 *
 * Better Auth answers with its own upper case names, and Neuron's endpoints
 * answer with the codes in `packages/shared`. Both reach a person as a
 * sentence, so both have to arrive at the same set of keys.
 */
const BETTER_AUTH_CODES: Record<string, ApiErrorCode> = {
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
};

/** What Better Auth hands back when a call fails. */
export interface AuthError {
  readonly code?: string | undefined;
  readonly status?: number | undefined;
  readonly message?: string | undefined;
}

/**
 * Turns an authentication failure into a message key.
 *
 * Never uses `error.message`. Better Auth writes those in English, and half the
 * people using this read Russian.
 *
 * @param error what the call answered with
 * @returns the key and the values its placeholders need
 */
export function describeAuthError(error: AuthError | null | undefined): {
  key: MessageKey;
  values: MessageValues;
} {
  const code = error?.code;

  if (code && (API_ERROR_CODES as readonly string[]).includes(code)) {
    return { key: `error.${code}` as MessageKey, values: { seconds: 60, correlationId: '' } };
  }

  const mapped = code ? BETTER_AUTH_CODES[code] : undefined;

  if (mapped) {
    return { key: `error.${mapped}` as MessageKey, values: {} };
  }

  return { key: `error.${fromStatus(error?.status)}` as MessageKey, values: { seconds: 60 } };
}

/**
 * The last resort, when a failure carries no code this build knows.
 *
 * Deliberately vague rather than wrong. Claiming the password was incorrect
 * when the server is on fire sends somebody to reset a password that was fine.
 */
function fromStatus(status: number | undefined): ApiErrorCode {
  if (status === 429) {
    return 'rate_limited';
  }

  if (status === 403) {
    return 'not_allowed';
  }

  if (status !== undefined && status >= 500) {
    return 'service_unavailable';
  }

  return 'invalid_request';
}

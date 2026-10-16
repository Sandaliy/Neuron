import { useQuery } from '@tanstack/react-query';

import { meSchema } from '@neuron/shared';
import type { Me } from '@neuron/shared';

import { ApiFailure, request } from './api';
import { lifecycle } from './lifecycle';
import {
  acceptAccount,
  accountEpoch,
  beginAccountValidation,
  endAccountValidation,
  connectionEpoch,
  locallySignedOut,
  connectionUncertain,
  accountValidationFailed,
  accountServerUnavailable,
  retainedAccount,
  rememberedAccount,
} from './offline';

/**
 * Who is signed in.
 *
 * This query doubles as the session check for the whole app. Better Auth has a
 * hook of its own, but the question worth asking is not "is there a cookie",
 * it is "does the api accept this cookie", and those come apart in exactly the
 * cases that matter: an expired session, a session invalidated by a password
 * change somewhere else, and a session that may only set a new password.
 */
export const ACCOUNT_KEY = ['account'] as const;

/**
 * The query itself, apart from the hook that reads it.
 *
 * Written out so it can be started before anything renders. The gate is the
 * first thing on screen and every signed in screen is behind it, so this
 * request is on the critical path of the whole app and it should not wait for
 * React to decide that it wants it.
 */
export function accountQuery() {
  return {
    queryKey: ACCOUNT_KEY,
    networkMode: 'always',
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      if (locallySignedOut())
        throw new ApiFailure({
          code: 'not_authenticated',
          status: 401,
          correlationId: 'local-sign-out',
        });
      const epoch = accountEpoch();
      const connection = beginAccountValidation();
      const started = Date.now();
      const transport = new AbortController();
      lifecycle('account-start');
      const cancel = () => transport.abort();
      signal.addEventListener('abort', cancel, { once: true });
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const localDeadline = setTimeout(() => {
        if (!signal.aborted && epoch === accountEpoch() && connection === connectionEpoch())
          connectionUncertain(started);
      }, 4000);
      try {
        const account = await Promise.race([
          request<Me>('/account', { signal: transport.signal }),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => {
              lifecycle('account-deadline');
              reject(
                new ApiFailure({
                  code: 'network_unreachable',
                  status: 0,
                  correlationId: 'account-deadline',
                }),
              );
              transport.abort();
            }, 8000);
          }),
        ]);
        const parsed = meSchema.parse(account);
        acceptAccount(parsed, epoch, connection);
        return parsed;
      } catch (error) {
        if (
          error instanceof ApiFailure &&
          (error.code === 'network_unreachable' || error.status >= 500) &&
          epoch === accountEpoch()
        ) {
          if (connection === connectionEpoch()) {
            if (error.code === 'network_unreachable')
              accountValidationFailed(started, error.correlationId !== 'account-deadline');
            else accountServerUnavailable(started);
          }
          const remembered =
            retainedAccount() ?? (await rememberedAccount().catch(() => undefined));
          if (remembered) return remembered;
        }
        throw error;
      } finally {
        endAccountValidation(connection);
        clearTimeout(timeout);
        clearTimeout(localDeadline);
        signal.removeEventListener('abort', cancel);
      }
    },
    // A failure here is a signed out person or a server that is down. Both are
    // handled by the gate above the screens, and neither is helped by retrying.
    retry: false,
    staleTime: 30_000,
  } as const;
}

export function useAccount() {
  return useQuery(accountQuery());
}

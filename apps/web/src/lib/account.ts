import { useQuery } from '@tanstack/react-query';

import type { Me } from '@neuron/shared';

import { ApiFailure, request } from './api';
import {
  acceptAccount,
  accountEpoch,
  connectionEpoch,
  locallySignedOut,
  rememberedAccount,
  revokeOffline,
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
      const connection = connectionEpoch();
      try {
        const account = await request<Me>('/account', { signal });
        acceptAccount(account, epoch, connection);
        return account;
      } catch (error) {
        if (
          error instanceof ApiFailure &&
          (error.code === 'not_authenticated' || error.code === 'password_change_required')
        )
          revokeOffline();
        if (
          error instanceof ApiFailure &&
          error.code === 'network_unreachable' &&
          epoch === accountEpoch()
        ) {
          const remembered = await rememberedAccount().catch(() => undefined);
          if (remembered) return remembered;
        }
        throw error;
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

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Me, UpdatePreferencesBody } from '@neuron/shared';

import { request } from './api';

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

export function useAccount() {
  return useQuery({
    queryKey: ACCOUNT_KEY,
    queryFn: () => request<Me>('/account'),
    // A failure here is a signed out person or a server that is down. Both are
    // handled by the gate above the screens, and neither is helped by retrying.
    retry: false,
    staleTime: 30_000,
  });
}

export function useUpdatePreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: UpdatePreferencesBody) =>
      request<Partial<Me>>('/account', { method: 'PATCH', body }),
    onSuccess: (updated) => {
      // Patched into the cache rather than refetched. The person is looking at
      // the control they just moved, and a round trip would move it back for a
      // moment first.
      queryClient.setQueryData<Me>(ACCOUNT_KEY, (current) =>
        current ? { ...current, ...updated } : current,
      );
    },
  });
}

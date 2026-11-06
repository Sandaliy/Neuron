import { hashKey, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import type { QueryKey } from '@tanstack/react-query';

/** Immediate form state, retained in the account-scoped visit cache for Back navigation. */
export function useBrowseState<T extends object>(key: QueryKey, initial: T) {
  const client = useQueryClient();
  const identity = hashKey(key);
  const cached = useQuery({
    queryKey: key,
    queryFn: () => initial,
    initialData: initial,
    enabled: false,
    staleTime: Infinity,
    gcTime: Infinity,
  }).data;
  const [local, setLocal] = useState({ identity, value: cached });
  // A new account, scope or history entry must never inherit the previous draft.
  if (local.identity !== identity) setLocal({ identity, value: cached });
  const update = useCallback(
    (patch: Partial<T>) => {
      const value = client.setQueryData<T>(key, (current) => ({
        ...initial,
        ...current,
        ...patch,
      }))!;
      // Query observers notify asynchronously. Controlled inputs need the new value
      // in this editing event, before React restores their DOM value and selection.
      setLocal({ identity, value });
    },
    [client, identity, key, initial],
  );
  return [local.identity === identity ? local.value : cached, update] as const;
}

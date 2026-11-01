import type { DailyStudySession, Me } from '@neuron/shared';

import { localStudyPlan } from './offline-study';
import { initialStudyQuery } from './study-plan';

import type { QueryClient } from '@tanstack/react-query';

/**
 * The default Daily Study plan, read for its waves.
 *
 * It is the plan Today starts from, not a second calculation: online it is the
 * server's early default plan, offline the device's own plan over the download.
 * Every write that changes Study invalidates `study-plan`, this key included.
 */
export function wavePlanQuery(account: Me | undefined, offline: boolean) {
  return {
    queryKey: ['study-plan', 'waves', account?.id, account?.revision, offline] as const,
    queryFn: ({
      signal,
      client,
    }: {
      signal: AbortSignal;
      client: QueryClient;
    }): Promise<DailyStudySession> =>
      offline ? localStudyPlan({}, signal, account) : client.fetchQuery(initialStudyQuery()),
    enabled: !!account,
    networkMode: 'always' as const,
    retry: false,
    staleTime: 15_000,
  };
}

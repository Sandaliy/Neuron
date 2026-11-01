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

/**
 * The last waves this device planned, shown while a newer plan is made, so the
 * card is there at once instead of arriving and pushing the Notes down.
 */
export function lastWavePlan(client: QueryClient, accountId: string | undefined) {
  if (!accountId) return undefined;
  const candidates = [
    ...client.getQueriesData<DailyStudySession>({ queryKey: ['study-plan', 'waves', accountId] }),
    ...client.getQueriesData<DailyStudySession>({ queryKey: initialStudyQuery().queryKey }),
  ]
    .map(([key, data]) => ({ data, at: client.getQueryState(key)?.dataUpdatedAt ?? 0 }))
    // The early plan is not keyed by account; its planning context says whose it is.
    .filter((entry) => entry.data?.waves && entry.data.planningContext?.accountId === accountId)
    .sort((a, b) => b.at - a.at);
  return candidates[0]?.data;
}

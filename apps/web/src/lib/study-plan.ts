import { dayIndexOf } from '@neuron/core';
import { dailyStudySessionSchema } from '@neuron/shared';
import type { LanguageCode, Me } from '@neuron/shared';

import { request } from './api';

import type { StudyPlanProjection } from './note-projection';
import type { QueryClient } from '@tanstack/react-query';

/** The server chooses the default language; account/collection loading need not precede it. */
export function initialStudyQuery() {
  return {
    queryKey: ['study-plan', 'initial'] as const,
    queryFn: async ({ signal, client }: { signal: AbortSignal; client: QueryClient }) => {
      let invalidated = false;
      const unsubscribe = client.getQueryCache().subscribe((event) => {
        if (
          event.type === 'updated' &&
          event.action.type === 'invalidate' &&
          event.query.queryKey[0] === 'study-plan' &&
          event.query.queryKey[1] === 'initial'
        )
          invalidated = true;
      });
      try {
        const data = dailyStudySessionSchema.parse(
          await request('/study/session', { method: 'POST', signal, body: {} }),
        );
        // A response which overlapped an invalidating write cannot erase that
        // evidence by finishing later and clearing the query's stale flag.
        return invalidated ? { ...data, planningContext: undefined } : data;
      } finally {
        unsubscribe();
      }
    },
    retry: false,
    staleTime: 15_000,
    placeholderData: () => undefined,
  };
}

/** Early data is usable only after its owner, revision, language and time bounds agree. */
export function confirmedInitialPlan(
  client: QueryClient,
  account: Me | undefined,
  language: LanguageCode | null,
) {
  const state = client.getQueryState<StudyPlanProjection>(initialStudyQuery().queryKey);
  const data = state?.data;
  if (
    !account ||
    !data ||
    state?.isInvalidated ||
    data.localProjection ||
    data.reviewProjection ||
    data.planningContext?.accountId !== account.id ||
    data.planningContext.revision !== account.revision ||
    data.targetLanguage !== language ||
    Date.now() - state.dataUpdatedAt >= 15_000 ||
    (data.nextDue && Date.parse(data.nextDue) <= Date.now())
  )
    return undefined;
  const boundary = { timezone: account.timezone, dayCutoffHour: account.dayCutoffHour };
  if (dayIndexOf(new Date(state.dataUpdatedAt), boundary) !== dayIndexOf(new Date(), boundary))
    return undefined;
  return { data, updatedAt: state.dataUpdatedAt };
}

export async function awaitInitialPlan(
  client: QueryClient,
  account: Me | undefined,
  language: LanguageCode | null,
) {
  const query = client
    .getQueryCache()
    .find({ queryKey: initialStudyQuery().queryKey, exact: true });
  if (query?.state.fetchStatus === 'fetching') {
    try {
      await query.promise;
    } catch {
      /* The ordinary request remains the fallback. */
    }
  }
  return confirmedInitialPlan(client, account, language);
}

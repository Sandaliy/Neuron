import { useSyncExternalStore } from 'react';

import type { DailyStudySession } from '@neuron/shared';

import type { QueryClient } from '@tanstack/react-query';

/**
 * The waves of the last Daily Study plan this visit made.
 *
 * Today plans, online with the server and offline on the device; every plan
 * carries its Decks' waves. The Deck screen shows them from here and never
 * plans by itself: a plan is the most expensive read in the app, and a card
 * that waited for one would arrive late and push the Notes down. Kept in
 * memory per account, so it outlives the plan queries' garbage collection.
 */

type Plan = Pick<DailyStudySession, 'waves' | 'newCards' | 'planningContext'>;

let latest: { accountId: string; plan: Plan } | undefined;
const listeners = new Set<() => void>();

function remember(data: unknown) {
  const plan = data as Partial<Plan> | undefined;
  const accountId = plan?.planningContext?.accountId;
  if (!accountId || !plan?.waves || !plan.newCards) return;
  latest = { accountId, plan: plan as Plan };
  for (const listener of listeners) listener();
}

/** Wired once at startup: every successful plan, whoever asked for it, updates the waves. */
export function watchWavePlans(client: QueryClient) {
  for (const [, data] of client.getQueriesData({ queryKey: ['study-plan'] })) remember(data);
  return client.getQueryCache().subscribe((event) => {
    if (
      event.type === 'updated' &&
      event.action.type === 'success' &&
      event.query.queryKey[0] === 'study-plan'
    )
      remember(event.query.state.data);
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The last plan's waves for this account, or undefined before Today has planned. */
export function useLastWavePlan(accountId: string | undefined): Plan | undefined {
  const value = useSyncExternalStore(subscribe, () => latest);
  return value && value.accountId === accountId ? value.plan : undefined;
}

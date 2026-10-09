import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { DailyStudySession, Me } from '@neuron/shared';

import { request } from './api';
import { awaitInitialPlan, confirmedInitialPlan, initialStudyQuery } from './study-plan';

vi.mock('./api', () => ({ request: vi.fn() }));
const account: Me = {
  id: 'owner',
  name: 'Owner',
  email: 'owner@example.test',
  image: null,
  locale: 'en',
  theme: 'dark',
  timezone: 'UTC',
  dayCutoffHour: 4,
  plan: 'free',
  settings: {},
  twoFactorEnabled: false,
  revision: 42,
};
const plan: DailyStudySession = {
  planningContext: { accountId: account.id, revision: account.revision },
  targetLanguage: 'de',
  languages: ['de'],
  aggregateReady: 0,
  cards: [],
  notes: [],
  scopeDeckIds: [],
  deckSummaries: [],
  nextDue: null,
  availableCount: 0,
  estimatedMinutes: 0,
  budgetMinutes: 20,
  reviewCount: 0,
  newCount: 0,
  backlog: { active: false, overdueCount: 0, overdueMinutes: 0, budgetMinutes: 20 },
  newCards: {
    mode: 'automatic',
    admitted: 0,
    allowed: 0,
    headroomMinutes: 20,
    marginalCost: 1,
    reason: 'withinBudget',
    overrideAvailable: false,
    limitedBy: null,
  },
};
let client: QueryClient;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-09T12:00:00Z'));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(request).mockReset();
});
afterEach(() => {
  client.clear();
  vi.useRealTimers();
});
function seed(value = plan) {
  client.setQueryData(initialStudyQuery().queryKey, value);
}

it('reuses only a confirmed plan for the current owner, revision and language', () => {
  seed();
  expect(confirmedInitialPlan(client, account, 'de')?.data).toEqual(plan);
  expect(confirmedInitialPlan(client, undefined, 'de')).toBeUndefined();
  expect(confirmedInitialPlan(client, { ...account, id: 'other' }, 'de')).toBeUndefined();
  expect(confirmedInitialPlan(client, { ...account, revision: 43 }, 'de')).toBeUndefined();
  expect(confirmedInitialPlan(client, account, 'en')).toBeUndefined();
  seed({ ...plan, planningContext: undefined });
  expect(confirmedInitialPlan(client, account, 'de')).toBeUndefined();
});

it('rejects invalidated and locally projected readiness', async () => {
  seed();
  await client.invalidateQueries({ queryKey: ['study-plan'], refetchType: 'none' });
  expect(confirmedInitialPlan(client, account, 'de')).toBeUndefined();
  for (const projection of [{ localProjection: true }, { reviewProjection: true }]) {
    client.setQueryData(initialStudyQuery().queryKey, { ...plan, ...projection });
    expect(confirmedInitialPlan(client, account, 'de')).toBeUndefined();
  }
});

it('bounds reuse by freshness, the next due Card and the local study-day boundary', () => {
  seed();
  vi.setSystemTime(new Date('2026-10-09T12:00:15Z'));
  expect(confirmedInitialPlan(client, account, 'de')).toBeUndefined();
  seed({ ...plan, nextDue: '2026-10-09T12:00:16Z' });
  vi.setSystemTime(new Date('2026-10-09T12:00:16Z'));
  expect(confirmedInitialPlan(client, account, 'de')).toBeUndefined();
  vi.setSystemTime(new Date('2026-10-10T03:59:59Z'));
  seed();
  vi.setSystemTime(new Date('2026-10-10T04:00:00Z'));
  expect(confirmedInitialPlan(client, account, 'de')).toBeUndefined();
});

it('shares an in-flight default request instead of planning twice', async () => {
  let release!: (value: DailyStudySession) => void;
  vi.mocked(request).mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const fetching = client.fetchQuery(initialStudyQuery());
  const waiting = awaitInitialPlan(client, account, 'de');
  release(plan);
  await fetching;
  expect((await waiting)?.data).toEqual(plan);
  expect(request).toHaveBeenCalledTimes(1);
});

it('does not let a late default response erase an overlapping write invalidation', async () => {
  let release!: (value: DailyStudySession) => void;
  vi.mocked(request).mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const fetching = client.fetchQuery(initialStudyQuery());
  const waiting = awaitInitialPlan(client, account, 'de');
  await client.invalidateQueries({ queryKey: ['study-plan'], refetchType: 'none' });
  release(plan);
  await fetching;
  expect(await waiting).toBeUndefined();
  expect(confirmedInitialPlan(client, account, 'de')).toBeUndefined();
});

it('leaves an unsuccessful bootstrap request to the ordinary authenticated fallback', async () => {
  vi.mocked(request).mockRejectedValue(new Error('Unsuccessful request'));
  const fetching = client.fetchQuery(initialStudyQuery());
  const waiting = awaitInitialPlan(client, account, 'de');
  await expect(fetching).rejects.toThrow('Unsuccessful request');
  expect(await waiting).toBeUndefined();
});

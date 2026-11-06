import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { useNoteBrowse } from './note-browse';

import type { ReactNode } from 'react';

const account = vi.hoisted(() => ({ id: 'first', visit: 1 }));
vi.mock('../../lib/offline', () => ({
  accountEpoch: () => account.visit,
  useOffline: () => ({ accountId: account.id }),
}));
afterEach(() => Object.assign(account, { id: 'first', visit: 1 }));

function browseHarness() {
  const client = new QueryClient();
  const root = createRootRoute();
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/notes' }),
      createRoute({ getParentRoute: () => root, path: '/notes/$noteId' }),
      createRoute({ getParentRoute: () => root, path: '/library/categories' }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/notes'] }),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <RouterContextProvider router={router}>{children}</RouterContextProvider>
    </QueryClientProvider>
  );
  return { client, router, wrapper };
}

it('retains filters on return and reconnect, separates Deck browsing and revokes state across account visits', async () => {
  const { client, wrapper } = browseHarness();
  const first = renderHook(() => useNoteBrowse(undefined), { wrapper });
  act(() =>
    first.result.current.update({
      typed: 'meaning',
      search: 'meaning',
      status: 'known',
      sort: 'alpha',
      tag: 'lesson',
      tagFilter: 'lesson',
      filtersOpen: true,
    }),
  );
  await waitFor(() => expect(first.result.current.state.search).toBe('meaning'));
  await act(async () => {
    await client.invalidateQueries();
  });
  first.unmount();
  const returned = renderHook(() => useNoteBrowse(undefined), { wrapper });
  expect(returned.result.current.state).toMatchObject({
    typed: 'meaning',
    search: 'meaning',
    status: 'known',
    sort: 'alpha',
    tagFilter: 'lesson',
    filtersOpen: true,
  });
  const deck = renderHook(() => useNoteBrowse('one-deck'), { wrapper });
  expect(deck.result.current.state.search).toBe('');
  returned.unmount();
  deck.unmount();
  account.id = 'second';
  account.visit++;
  const switched = renderHook(() => useNoteBrowse(undefined), { wrapper });
  expect(switched.result.current.state.search).toBe('');
  switched.unmount();
  account.id = 'first';
  account.visit++;
  const newVisit = renderHook(() => useNoteBrowse(undefined), { wrapper });
  expect(newVisit.result.current.state.search).toBe('');
  newVisit.unmount();
  client.clear();
});

it('separates recent entries, retains their compatible filters on return and clears a new account visit', async () => {
  const { client, wrapper } = browseHarness();
  const first = renderHook(() => useNoteBrowse(undefined, undefined, 'changed'), { wrapper });
  expect(first.result.current.state.sort).toBe('updated-desc');
  act(() =>
    first.result.current.update({
      search: 'meaning',
      typed: 'meaning',
      tag: 'topic',
      tagFilter: 'topic',
      status: 'known',
    }),
  );
  await waitFor(() => expect(first.result.current.state.search).toBe('meaning'));
  first.unmount();
  const returned = renderHook(() => useNoteBrowse(undefined, undefined, 'changed'), { wrapper });
  expect(returned.result.current.state).toMatchObject({
    sort: 'updated-desc',
    search: 'meaning',
    tagFilter: 'topic',
    status: 'known',
  });
  const added = renderHook(() => useNoteBrowse(undefined, undefined, 'added'), { wrapper });
  expect(added.result.current.state).toMatchObject({ sort: 'created-desc', search: '' });
  returned.unmount();
  added.unmount();
  account.id = 'other';
  account.visit++;
  const other = renderHook(() => useNoteBrowse(undefined, undefined, 'changed'), { wrapper });
  expect(other.result.current.state).toMatchObject({
    sort: 'updated-desc',
    search: '',
    status: '',
  });
  other.unmount();
  client.clear();
});

it.each(['tag', 'source'] as const)(
  'preserves an exact %s entry on editor Back and starts fresh when the category is selected again',
  async (kind) => {
    const { client, router, wrapper } = browseHarness();
    const category = { kind, value: ` saved ${kind} ` };
    const first = renderHook(() => useNoteBrowse(undefined, category), { wrapper });
    expect(first.result.current.state).toMatchObject({
      [kind]: category.value,
      [`${kind}Filter`]: category.value,
      filtersOpen: true,
    });
    act(() => first.result.current.update({ typed: 'meaning', search: 'meaning', sort: 'alpha' }));
    await waitFor(() => expect(first.result.current.state.search).toBe('meaning'));
    await act(async () => {
      await client.invalidateQueries();
    });
    first.unmount();
    await act(async () => {
      router.history.push('/notes/one-note');
      await router.load();
      router.history.back();
      await router.load();
    });
    const returned = renderHook(() => useNoteBrowse(undefined, category), { wrapper });
    expect(returned.result.current.state).toMatchObject({
      [kind]: category.value,
      [`${kind}Filter`]: category.value,
      typed: 'meaning',
      search: 'meaning',
      sort: 'alpha',
    });
    returned.unmount();
    await act(async () => {
      router.history.push('/library/categories');
      await router.load();
      router.history.push('/notes');
      await router.load();
    });
    const selectedAgain = renderHook(() => useNoteBrowse(undefined, category), { wrapper });
    expect(selectedAgain.result.current.state).toMatchObject({
      [kind]: category.value,
      [`${kind}Filter`]: category.value,
      typed: '',
      search: '',
      sort: 'created',
    });
    selectedAgain.unmount();
    client.clear();
  },
);

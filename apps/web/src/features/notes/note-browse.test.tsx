import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

it('retains filters on return and reconnect, separates Deck browsing and revokes state across account visits', async () => {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
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

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { render } from '@testing-library/react';

import type { Locale } from '@neuron/shared';

import { setLocale } from '../i18n/locale';
import { ToastProvider } from '../ui/toast';

import type { ReactElement, ReactNode } from 'react';

/**
 * A component under the providers it expects.
 *
 * The locale is pinned rather than read from the browser, so a test asserting
 * on a sentence asserts on the same sentence wherever it runs.
 */
export function renderWithProviders(ui: ReactElement, { locale = 'en' as Locale } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  // The language is a device preference rather than a provider, so it is
  // pinned by setting it, the same way the application does.
  setLocale(locale);

  function Providers({ children }: { readonly children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    );
  }

  return render(ui, { wrapper: Providers });
}

/**
 * A whole screen, which usually means one that links somewhere.
 *
 * `Link` reads the router out of context and throws without one, so a screen
 * cannot be rendered by the helper above. This puts it on its own route in a
 * router with no history, which is enough for every link on it to resolve.
 */
export function renderScreen(ui: ReactElement, { locale = 'en' as Locale } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  setLocale(locale);

  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => ui,
  });

  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router as never} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

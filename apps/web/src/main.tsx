import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { LocaleProvider } from './i18n/provider';
import { ApiFailure } from './lib/api';
import { router } from './router';
import { ThemeProvider } from './theme/provider';
import { ToastProvider } from './ui/toast';

import './styles/global.css';

/**
 * Retrying, and when not to.
 *
 * A refusal is an answer: a 401 does not become a 200 by asking again, and
 * retrying a 429 is how a rate limit turns into a longer rate limit. Only the
 * cases where the request never really happened are worth a second try.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (attempt, error) =>
        attempt < 2 && error instanceof ApiFailure && error.code === 'service_unavailable',
      // The tab coming back into focus is a good moment to find out that the
      // counts moved, and a bad moment to refetch everything on a phone.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
    mutations: { retry: false },
  },
});

const container = document.getElementById('root');

if (!container) {
  throw new Error('index.html has no #root');
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
        <ThemeProvider>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </ThemeProvider>
      </LocaleProvider>
    </QueryClientProvider>
  </StrictMode>,
);

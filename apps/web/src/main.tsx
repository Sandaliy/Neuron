import { QueryClient, QueryClientProvider, keepPreviousData } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { ApiFailure } from './lib/api';
import { trackViewport } from './lib/viewport';
import { watchFrameRate } from './preferences/frame-rate';
import { router } from './router';
import { ToastProvider } from './ui/toast';

/*
 * Imported for the side effect: each module reads its value out of local
 * storage and puts it on the document while it is evaluated, before React
 * renders anything. The script in index.html has already done the same thing
 * earlier still, so these are the second of two agreeing answers.
 */
import './preferences/glass';
import './preferences/motion';

import './styles/global.css';

/**
 * How the client behaves when it is not being asked for something new.
 *
 * The rule everything here serves: once something has been drawn, a later
 * request may replace it with newer content or leave it alone, and may never
 * replace it with a spinner.
 *
 * Retrying, and when not to. A refusal is an answer: a 401 does not become a
 * 200 by asking again, and retrying a 429 is how a rate limit turns into a
 * longer rate limit. Only the cases where the request never really happened are
 * worth a second try.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (attempt, error) =>
        attempt < 2 &&
        error instanceof ApiFailure &&
        (error.code === 'service_unavailable' || error.code === 'network_unreachable'),

      /*
       * Not on focus. Every alt-tab back to the app would otherwise spend a
       * request per query, and on a phone that is every time the screen wakes.
       * Nothing in this app changes without this person doing it, so the tab
       * regaining focus is not news. Reconnecting still refetches, which is the
       * case where something really might have moved.
       */
      refetchOnWindowFocus: false,

      /*
       * Five minutes. The collection only changes when the person changes it,
       * and the screens that read it are three taps apart, so the default of
       * zero meant a request for every navigation between them and a visible
       * refetch each time.
       */
      staleTime: 5 * 60_000,

      /*
       * A query whose key moves keeps showing the previous key's answer until
       * the new one arrives. Nothing has more than one key today; this is what
       * stops the first filtered list in phase 6 from blanking the screen.
       */
      placeholderData: keepPreviousData,
    },
    mutations: { retry: false },
  },
});

// Started before the first render, so a dialog opened straight away already
// knows where the keyboard is.
void trackViewport();

/*
 * Watching the frames during a scroll, so a phone that cannot afford the glass
 * says so by stuttering once rather than for the life of the install.
 */
watchFrameRate();

const container = document.getElementById('root');

if (!container) {
  throw new Error('index.html has no #root');
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);

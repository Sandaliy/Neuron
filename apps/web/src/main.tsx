import { QueryClient, QueryClientProvider, keepPreviousData } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { accountQuery } from './lib/account';
import { ApiFailure } from './lib/api';
import { deckTreeQuery } from './lib/decks';
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

/**
 * The two questions the first screen needs, asked at once.
 *
 * The session gate does not render the screens until it knows who is signed in,
 * so the deck tree used to be requested only after the account had answered:
 * two round trips end to end for the first thing anybody looks at. On a warm
 * function that is about seven hundred milliseconds instead of three hundred
 * and fifty, and on a cold one it is two cold starts in a row.
 *
 * Started here, before React exists, so both are already in flight while the
 * bundle is still being evaluated. Nothing waits on the result: whichever
 * screen wants it reads the same cache a moment later.
 *
 * The tree is only worth asking for on a screen that shows it. On the signed
 * out half there is no session to ask with, and the answer would be a refusal.
 */
function warmUp(): void {
  void queryClient.prefetchQuery(accountQuery());

  const path = window.location.pathname;

  if (path === '/' || path.startsWith('/library')) {
    void queryClient.prefetchQuery(deckTreeQuery());
  }
}

warmUp();

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

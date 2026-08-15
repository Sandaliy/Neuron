import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  useSearch,
} from '@tanstack/react-router';

import { Failure, NotFound } from './app/failure';
import { PreferencesSync } from './app/preferences-sync';
import { SessionGate } from './app/session-gate';
import { Shell } from './app/shell';
import { NewPasswordScreen, RecoveryScreen } from './features/auth/recovery';
import { SignInScreen } from './features/auth/sign-in';
import { SignUpScreen } from './features/auth/sign-up';
import { TwoFactorScreen } from './features/auth/two-factor';
import { GalleryScreen } from './features/dev/gallery';
import { LibraryScreen } from './features/library/library';
import { SettingsScreen } from './features/settings/settings';
import { TodayScreen } from './features/today/today';

/**
 * The routes, written out rather than generated from the file tree.
 *
 * File based routing would mean a generated route tree checked into the
 * repository and a plugin that rewrites it, and there are eight screens. This
 * fits on one page and can be read top to bottom.
 */
const rootRoute = createRootRoute({ component: Outlet });

/** The signed out half. No session, no shell, no navigation bar. */
const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sign-in',
  component: SignInScreen,
});

const signUpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sign-up',
  component: SignUpScreen,
});

const recoveryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/recovery',
  component: RecoveryScreen,
});

const newPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/recovery/password',
  validateSearch: (search: Record<string, unknown>): { remaining?: number } => {
    const remaining = Number(search['remaining']);

    // Only a count worth showing. Anything else is dropped rather than
    // rendered as "Recovery codes left: NaN".
    return Number.isInteger(remaining) && remaining >= 0 ? { remaining } : {};
  },
  component: NewPasswordRoute,
});

function NewPasswordRoute() {
  const { remaining } = useSearch({ from: newPasswordRoute.id });

  return <NewPasswordScreen {...(remaining === undefined ? {} : { remaining })} />;
}

const twoFactorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/two-factor',
  component: TwoFactorScreen,
});

/**
 * The signed in half.
 *
 * A pathless layout route, so the gate and the navigation bar are written once
 * and a screen cannot be added underneath them without them.
 */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  component: () => (
    <SessionGate>
      <PreferencesSync />
      <Shell />
    </SessionGate>
  ),
});

const todayRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: TodayScreen,
});

const libraryRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/library',
  component: LibraryScreen,
});

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  component: SettingsScreen,
});

/**
 * The component gallery, and only outside production.
 *
 * `__DEV_ROUTES__` is set by `vite.config.ts` from the deployment environment:
 * on while developing and on a branch preview, off on the production build. The
 * gallery is where a new screen is composed from and where a regression shows
 * up in one place, and neither of those is a reason to put it in front of
 * somebody using the app.
 */
const devRoutes = __DEV_ROUTES__
  ? [
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/dev/components',
        component: GalleryScreen,
      }),
    ]
  : [];

const routeTree = rootRoute.addChildren([
  signInRoute,
  signUpRoute,
  recoveryRoute,
  newPasswordRoute,
  twoFactorRoute,
  appRoute.addChildren([todayRoute, libraryRoute, settingsRoute]),
  ...devRoutes,
]);

export const router = createRouter({
  routeTree,
  /*
   * A thrown component and an address that is not a screen both have to arrive
   * as a sentence in the language on screen. The router's own versions are an
   * English string over a stack trace.
   */
  defaultErrorComponent: ({ error, reset }) => <Failure error={error} reset={reset} />,
  defaultNotFoundComponent: NotFound,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

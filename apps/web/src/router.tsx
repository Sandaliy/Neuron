import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  useSearch,
} from '@tanstack/react-router';
import { lazy } from 'react';

import { Failure, NotFound } from './app/failure';
import { PreferencesSync } from './app/preferences-sync';
import { SessionGate } from './app/session-gate';
import { Shell } from './app/shell';
import { StudyDraftProvider } from './features/today/study-draft';
import { resetInteractions } from './lib/interactions';

/*
 * Keep screen modules behind their route boundary. Frequent signed-in routes
 * expose their preload function to the router so code and data can arrive
 * together before committing a new screen, avoiding nested suspension.
 */
const NewPasswordScreen = lazy(async () => {
  const screen = await import('./features/auth/recovery');

  return { default: screen.NewPasswordScreen };
});
const RecoveryScreen = lazy(async () => {
  const screen = await import('./features/auth/recovery');

  return { default: screen.RecoveryScreen };
});
const SignInScreen = lazy(async () => {
  const screen = await import('./features/auth/sign-in');

  return { default: screen.SignInScreen };
});
const SignUpScreen = lazy(async () => {
  const screen = await import('./features/auth/sign-up');

  return { default: screen.SignUpScreen };
});
const TwoFactorScreen = lazy(async () => {
  const screen = await import('./features/auth/two-factor');

  return { default: screen.TwoFactorScreen };
});
const GalleryScreen = lazy(async () => {
  const screen = await import('./features/dev/gallery');

  return { default: screen.GalleryScreen };
});
const ImportScreen = lazyRouteComponent(
  () => import('./features/import/import-screen'),
  'ImportScreen',
);
const DeletedScreen = lazy(async () => {
  const screen = await import('./features/library/deleted');

  return { default: screen.DeletedScreen };
});
const LibraryScreen = lazyRouteComponent(
  () => import('./features/library/library'),
  'LibraryScreen',
);
const NoteEditorScreen = lazyRouteComponent(
  () => import('./features/notes/note-editor'),
  'NoteEditorScreen',
);
const NoteListScreen = lazyRouteComponent(
  () => import('./features/notes/note-list'),
  'NoteListScreen',
);
const SettingsScreen = lazyRouteComponent(
  () => import('./features/settings/settings'),
  'SettingsScreen',
);
const TodayScreen = lazyRouteComponent(() => import('./features/today/today'), 'TodayScreen');

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
      <StudyDraftProvider>
        <PreferencesSync />
        <Shell />
      </StudyDraftProvider>
    </SessionGate>
  ),
});

const todayRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  staticData: { navTab: '/' },
  validateSearch: (
    search: Record<string, unknown>,
  ): { learning?: 'study'; followup?: 'practice'; practiceDeck?: string } =>
    search['learning'] === 'study'
      ? {
          learning: 'study',
          ...(search['followup'] === 'practice'
            ? {
                followup: 'practice' as const,
                ...(typeof search['practiceDeck'] === 'string'
                  ? { practiceDeck: search['practiceDeck'] }
                  : {}),
              }
            : {}),
        }
      : {},
  component: TodayScreen,
});

const libraryRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/library',
  staticData: { navTab: '/library' },
  validateSearch: (search: Record<string, unknown>): { folderId?: string } =>
    typeof search['folderId'] === 'string' ? { folderId: search['folderId'] } : {},
  component: LibraryScreen,
});

const deletedRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/library/deleted',
  staticData: { navTab: '/library' },
  component: DeletedScreen,
});

/**
 * The notes: a list, one being written, and one being edited.
 *
 * Which deck the list is showing, and which deck a new note lands in, are both
 * in the address, so a screen can be bookmarked and going back from a note
 * returns to the same deck.
 */
const noteListRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/notes',
  staticData: { navTab: '/library' },
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    deckId?: string;
    learning?: 'practice';
    entry?: 'resume' | 'setup';
  } => ({
    ...(typeof search['deckId'] === 'string' ? { deckId: search['deckId'] } : {}),
    ...(search['learning'] === 'practice' ? { learning: 'practice' as const } : {}),
    ...(search['entry'] === 'setup' || search['entry'] === 'resume'
      ? { entry: search['entry'] }
      : {}),
  }),
  component: NoteListRoute,
});

function NoteListRoute() {
  const { deckId } = useSearch({ from: noteListRoute.id });

  return <NoteListScreen key={deckId ?? 'all'} {...(deckId === undefined ? {} : { deckId })} />;
}
// Expose the lazy screen's preload through its search-parameter wrapper so
// the module is ready before the route commits, avoiding a nested suspension.
NoteListRoute.preload = async () => {
  await NoteListScreen.preload?.();
};

const newNoteRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/notes/new',
  staticData: { navTab: '/library' },
  validateSearch: (search: Record<string, unknown>): { deckId?: string } =>
    typeof search['deckId'] === 'string' ? { deckId: search['deckId'] } : {},
  component: NewNoteRoute,
});

function NewNoteRoute() {
  const { deckId } = useSearch({ from: newNoteRoute.id });

  return <NoteEditorScreen {...(deckId === undefined ? {} : { deckId })} />;
}
NewNoteRoute.preload = async () => {
  await NoteEditorScreen.preload?.();
};

const noteRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/notes/$noteId',
  staticData: { navTab: '/library' },
  component: NoteRoute,
});

function NoteRoute() {
  const { noteId } = noteRoute.useParams();

  return <NoteEditorScreen key={noteId} noteId={noteId} />;
}
NoteRoute.preload = async () => {
  await NoteEditorScreen.preload?.();
};

/** Bringing a word list in. Which deck it lands in is in the address. */
const importRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/import',
  staticData: { navTab: '/library' },
  validateSearch: (search: Record<string, unknown>): { deckId?: string } =>
    typeof search['deckId'] === 'string' ? { deckId: search['deckId'] } : {},
  component: ImportRoute,
});

function ImportRoute() {
  const { deckId } = useSearch({ from: importRoute.id });

  return <ImportScreen {...(deckId === undefined ? {} : { deckId })} />;
}
ImportRoute.preload = async () => {
  await ImportScreen.preload?.();
};

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  staticData: { navTab: '/settings' },
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
  appRoute.addChildren([
    todayRoute,
    libraryRoute,
    deletedRoute,
    noteListRoute,
    // Before the parameter route, or a new note is read as a note whose id is
    // the word new.
    newNoteRoute,
    noteRoute,
    importRoute,
    settingsRoute,
  ]),
  ...devRoutes,
]);

export const router = createRouter({
  routeTree,
  // Restore by history entry after the route commit. Native automatic restore
  // can run before an async module finishes, then be overwritten by route reset.
  scrollRestoration: true,
  /*
   * A thrown component and an address that is not a screen both have to arrive
   * as a sentence in the language on screen. The router's own versions are an
   * English string over a stack trace.
   */
  defaultErrorComponent: ({ error, reset }) => <Failure error={error} reset={reset} />,
  defaultNotFoundComponent: NotFound,
});

router.subscribe('onBeforeNavigate', resetInteractions);

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    navTab?: '/' | '/library' | '/settings';
  }

  interface Register {
    router: typeof router;
  }
}

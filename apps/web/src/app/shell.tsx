import { Outlet, useLinkProps, useRouter, useRouterState } from '@tanstack/react-router';
import { Suspense, useEffect, useState } from 'react';

import type { MessageKey } from '@neuron/shared';

import { useTranslate } from '../i18n/locale';
import { Sheen } from '../ui/sheen';
import { SkeletonRows } from '../ui/states';

import { OfflineStatus } from './offline-status';

import type { CSSProperties } from 'react';

/** Native fixed positioning follows Safari's toolbar. Viewport measurements
 * are reserved for keyboard-aware dialogs and feedback. */
const TABS: readonly { to: '/' | '/library' | '/settings'; label: MessageKey }[] = [
  { to: '/', label: 'nav.today' },
  { to: '/library', label: 'nav.library' },
  { to: '/settings', label: 'nav.settings' },
];

/** The tab an address belongs to, read from the address alone. */
function tabOf(pathname: string): number {
  if (pathname === '/') return 0;
  if (pathname === '/settings') return 2;
  return /^\/(library|notes|import)(\/|$)/.test(pathname) ? 1 : -1;
}

/*
 * Whether the person just asked to move, by a press or a key inside the app.
 *
 * A Back arrival animates only then. When the browser goes back by itself, an
 * edge swipe on an iPhone above all, Safari has already slid the previous page
 * in; the app animating it again from the left drew a second, late slide with
 * a strip of bare canvas along the edge. A click rather than a pointerdown,
 * because a swipe that the system takes over starts with a pointerdown too.
 */
let lastIntent = Number.NEGATIVE_INFINITY;
if (typeof window !== 'undefined') {
  const mark = () => {
    lastIntent = performance.now();
  };
  window.addEventListener('click', mark, { capture: true, passive: true });
  window.addEventListener('keydown', mark, { capture: true, passive: true });
}
const askedJustNow = () => performance.now() - lastIntent < 1000;

export function Shell() {
  const t = useTranslate();
  const router = useRouter();
  /*
   * The three tab screens are loaded once the first screen is up and the
   * browser is idle. Switching tabs then waits for nothing but a render; it
   * used to wait for the next screen's module on its first visit.
   */
  useEffect(() => {
    const preload = () => {
      for (const tab of TABS) void router.preloadRoute({ to: tab.to }).catch(() => undefined);
    };
    if ('requestIdleCallback' in window) {
      const handle = window.requestIdleCallback(preload, { timeout: 3000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = setTimeout(preload, 1500);
    return () => clearTimeout(timer);
  }, [router]);
  // The committed match owns both the screen and its tab, including collection
  // screens outside /library. A pending address must not remount the old screen.
  const match = useRouterState({ select: (state) => state.matches.at(-1) });
  const current = TABS.findIndex((tab) => tab.to === match?.staticData.navTab);
  /*
   * Where the pill sits: the tab of the address being opened, from the moment
   * it is pressed. The committed screen still owns aria-current. The pill used
   * to wait for the next screen to load and render, so after the press
   * feedback faded on the new tab it sat on the old one for a beat, which read
   * as the bar snapping back.
   */
  const destination = useRouterState({ select: (state) => tabOf(state.location.pathname) });
  const pill = destination >= 0 ? destination : current;
  const index = useRouterState({
    select: (state) => (state.location.state as { __TSR_index?: number }).__TSR_index ?? 0,
  });
  /*
   * Which way the person moved, decided once per screen. A tab change is a
   * step between siblings; within a tab, a lower history index is Back. The
   * value is held for the life of the mounted screen, because the router state
   * changes under it and an attribute that changed mid-arrival would cancel it.
   * The index is read only when the screen changes: the router updates the
   * location a render before the matched screen, so tracking it in between
   * recorded the destination as the origin and made Back look like forward.
   */
  const [arrival, setArrival] = useState({
    path: match?.pathname,
    kind: undefined as 'tab' | 'back' | 'forward' | undefined,
    index,
    tab: current,
  });
  if (arrival.path !== match?.pathname)
    setArrival({
      path: match?.pathname,
      kind:
        current !== arrival.tab
          ? 'tab'
          : index < arrival.index
            ? askedJustNow()
              ? 'back'
              : undefined
            : 'forward',
      index,
      tab: current,
    });

  return (
    <div className="flex min-h-dvh flex-col">
      <div aria-hidden="true" data-collection-backdrop="" />
      <div aria-hidden="true" data-safe-area-cover="" />
      {/*
        Routes mount their own screen, keyed by path, so this layout stays put
        and each screen arrives once. The data-arrival attribute says from
        where; the stylesheet moves the screen and nothing inside it. Entrance only: a
        cached screen is readable at once instead of waiting for the old one.
      */}
      <main
        key={match?.pathname}
        data-shell-content=""
        data-arrival={arrival.kind}
        className="relative z-10 mx-auto w-full max-w-[720px] grow px-20 pt-[calc(var(--safe-top)+12px)] pb-[calc(var(--safe-bottom)+var(--bar-height)+40px+var(--keyboard-inset))] sm:pt-[calc(var(--safe-top)+24px)]"
      >
        <Suspense
          fallback={
            <section data-screen="" className="flex flex-col gap-20">
              <SkeletonRows rows={5} />
            </section>
          }
        >
          <Outlet />
        </Suspense>
      </main>

      <nav
        data-g="tabbar"
        aria-label={t('app.name')}
        className={[
          'fixed inset-x-16 z-30 flex gap-4 rounded-24 p-8',
          'bottom-[var(--bar-inset)]',
          'sm:mx-auto sm:w-full sm:max-w-[420px]',
        ].join(' ')}
        style={
          {
            '--seg-count': TABS.length,
            '--seg-index': pill < 0 ? 0 : pill,
          } as CSSProperties
        }
      >
        <span
          data-slot="tab-pill"
          aria-hidden="true"
          className={pill < 0 ? 'opacity-0' : undefined}
        />
        <OfflineStatus />

        {TABS.map((tab, index) => (
          <TabLink key={tab.to} to={tab.to} active={index === current} label={t(tab.label)} />
        ))}

        <Sheen />
      </nav>
    </div>
  );
}

function TabLink({
  to,
  active,
  label,
}: {
  readonly to: '/' | '/library' | '/settings';
  readonly active: boolean;
  readonly label: string;
}) {
  const props = useLinkProps({ to });
  return (
    <a
      {...props}
      data-tab=""
      // Link behavior stays native; selection belongs to the committed screen,
      // rather than the link's independent pathname/search matching rules.
      aria-current={active ? 'page' : undefined}
      data-status={active ? 'active' : undefined}
      className={[
        'relative z-10 flex min-h-44 flex-1 items-center justify-center rounded-12 px-8',
        'text-13 text-primary',
        active ? 'font-semibold' : 'font-normal',
      ].join(' ')}
    >
      {label}
    </a>
  );
}

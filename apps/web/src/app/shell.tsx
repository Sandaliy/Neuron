import { Link, Outlet, useRouterState } from '@tanstack/react-router';

import type { MessageKey } from '@neuron/shared';

import { useTranslate } from '../i18n/locale';
import { Sheen } from '../ui/sheen';

import type { CSSProperties } from 'react';

/**
 * The frame every signed in screen sits in.
 *
 * Navigation is a bar floating over the content near the bottom edge, on every
 * size. The phone is the primary target and the bottom third of a phone is the
 * part a thumb reaches without the hand moving; on a wide screen the same bar
 * stays where the eye has learned to find it rather than moving to the top and
 * making the two look like two different applications.
 *
 * Where the bottom is takes measuring. A `position: fixed` element is placed
 * against the layout viewport, and on iOS that viewport runs on underneath
 * Safari's toolbar, so a bar at `bottom: 0` hides behind the toolbar while the
 * toolbar is out and sits far too high once it retracts. `--chrome-inset` is
 * how much of it the browser's own furniture is covering, measured by
 * `src/lib/viewport.ts`, and lifting the bar by that puts it just above
 * whatever the browser is showing, in every state of it.
 *
 * That lift is a `translate` in the stylesheet, not part of this offset. The
 * toolbar slides in and out on every change of scroll direction, iOS reports
 * the move in two or three coarse steps, and following them in `bottom` meant a
 * layout pass per step and a bar that jumped. On the compositor, with the
 * screen duration under it, the same three steps read as one glide.
 *
 * While the keyboard is up the bar goes away. It belongs to the bottom of the
 * screen, the keyboard has taken that, and a bar riding on top of the keys is
 * what a web page does rather than what an app does.
 *
 * The current tab is a filled slab that travels, not a colour. The tabs are
 * equal width, so where the slab belongs is the index of the current tab and
 * nothing has to be measured: it is in the right place on the first frame, and
 * it moves by `transform` alone.
 */
const TABS: readonly { to: string; label: MessageKey }[] = [
  { to: '/', label: 'nav.today' },
  { to: '/library', label: 'nav.library' },
  { to: '/settings', label: 'nav.settings' },
];

export function Shell() {
  const t = useTranslate();
  const path = useRouterState({ select: (state) => state.location.pathname });

  const current = TABS.findIndex((tab) =>
    tab.to === '/' ? path === '/' : path.startsWith(tab.to),
  );

  return (
    <div className="flex min-h-dvh flex-col">
      {/*
        Keyed on the path, so a tab change replays the arrival rather than
        swapping the content in place. The tabs are siblings, nothing travels
        sideways, and what says a screen changed is that it arrives.

        The arrival is the blocks inside rising, and nothing on this element.
        Fading the whole screen in as well meant every block fading twice over,
        one fade multiplied by the other, so the content was still half
        transparent a third of a second after the tap. A tab change that is
        already cached should read as instant, and it did not.
      */}
      <main
        key={path}
        className="mx-auto w-full max-w-[720px] grow px-20 pt-[calc(var(--safe-top)+12px)] pb-[calc(var(--safe-bottom)+var(--bar-height)+40px+var(--keyboard-inset))] sm:pt-24"
      >
        <Outlet />
      </main>

      <nav
        data-g="tabbar"
        aria-label={t('app.name')}
        className={[
          'fixed inset-x-16 z-30 flex gap-4 rounded-24 p-8',
          /*
           * Against the bottom of the page. How far the browser's own furniture
           * is covering is a `translate` in the stylesheet rather than part of
           * this offset: it changes on every scroll that moves Safari's toolbar,
           * and moving `bottom` per step laid the page out again each time and
           * arrived in visible jumps.
           */
          'bottom-[var(--bar-inset)]',
          'sm:mx-auto sm:w-full sm:max-w-[420px]',
        ].join(' ')}
        style={
          {
            '--seg-count': TABS.length,
            '--seg-index': current < 0 ? 0 : current,
          } as CSSProperties
        }
      >
        <span
          data-slot="tab-pill"
          aria-hidden="true"
          className={current < 0 ? 'opacity-0' : undefined}
        />

        {TABS.map((tab, index) => {
          const active = index === current;

          return (
            <Link
              key={tab.to}
              to={tab.to}
              data-tab=""
              aria-current={active ? 'page' : undefined}
              className={[
                'relative z-10 flex min-h-44 flex-1 items-center justify-center rounded-12 px-8',
                'text-13',
                active ? 'font-semibold text-primary' : 'text-secondary hover:text-primary',
              ].join(' ')}
            >
              {t(tab.label)}
            </Link>
          );
        })}

        <Sheen />
      </nav>
    </div>
  );
}

import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { Suspense } from 'react';

import type { MessageKey } from '@neuron/shared';

import { useTranslate } from '../i18n/locale';
import { Sheen } from '../ui/sheen';
import { SkeletonRows } from '../ui/states';

import type { CSSProperties } from 'react';

/** Native fixed positioning follows Safari's toolbar. Viewport measurements
 * are reserved for keyboard-aware dialogs and feedback. */
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
        Routes mount their own screen, so a tab change replays the arrival
        without remounting this layout. The tabs are siblings, nothing travels
        sideways, and what says a screen changed is that it arrives.

        The arrival is the blocks inside rising, and nothing on this element.
        Fading the whole screen in as well meant every block fading twice over,
        one fade multiplied by the other, so the content was still half
        transparent a third of a second after the tap. A tab change that is
        already cached should read as instant, and it did not.
      */}
      <main
        key={path}
        data-shell-content=""
        className="mx-auto w-full max-w-[720px] grow px-20 pt-[calc(var(--safe-top)+12px)] pb-[calc(var(--safe-bottom)+var(--bar-height)+40px+var(--keyboard-inset))] sm:pt-24"
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
                'text-13 text-primary',
                /*
                 * Every label is primary, active or not. What marks the current
                 * tab is the pill travelling under it and the weight of the
                 * word, not a quieter tone, and that is what lets the bar be
                 * nearly twice as transparent: the contrast floor on a glass
                 * layer is set by the quietest text on it, and there is none.
                 */
                active ? 'font-semibold' : 'font-normal',
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

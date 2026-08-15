import { Link, Outlet, useRouterState } from '@tanstack/react-router';

import type { MessageKey } from '@neuron/shared';

import { useTranslate } from '../i18n/locale';
import { Sheen } from '../ui/sheen';

import type { CSSProperties } from 'react';

/**
 * The frame every signed in screen sits in.
 *
 * Navigation is a bar floating over the content near the bottom edge, not a
 * menu at the top, because the phone is the primary target and the bottom third
 * of a phone is the part a thumb reaches without the hand moving. It is a
 * floating layer, so it is glass, and content passes underneath it.
 *
 * The current tab is a filled slab that travels, not a colour. The tabs are
 * equal width, so where the slab belongs is the index of the current tab and
 * nothing has to be measured: it is in the right place on the first frame, and
 * it moves by `transform` alone.
 *
 * Above the phone breakpoint the same bar sits at the top of the column, where
 * a bar belongs on a screen nobody holds.
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
      <main className="mx-auto w-full max-w-[720px] grow px-20 pt-[calc(var(--safe-top)+12px)] pb-[calc(var(--safe-bottom)+var(--bar-height)+var(--bar-gap)+24px)] sm:pt-24 sm:pb-32">
        <Outlet />
      </main>

      <nav
        data-g="tabbar"
        aria-label={t('app.name')}
        className={[
          'fixed inset-x-16 bottom-[calc(var(--safe-bottom)+var(--bar-gap))] z-30',
          'flex gap-4 rounded-24 p-8',
          'sm:top-24 sm:bottom-auto sm:mx-auto sm:w-full sm:max-w-[420px]',
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
                'text-13 transition-colors',
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

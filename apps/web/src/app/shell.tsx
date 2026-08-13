import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { CalendarCheck, Library, Settings } from 'lucide-react';

import type { MessageKey } from '@neuron/shared';

import { useTranslate } from '../i18n/provider';

import type { LucideIcon } from 'lucide-react';

/**
 * The frame every signed in screen sits in.
 *
 * Navigation is a bar along the bottom, not a menu at the top, because the
 * phone is the primary target and the bottom third of a phone is the part a
 * thumb reaches without the hand moving. The same bar on a wide screen would
 * be strange, so above the phone breakpoint it moves to the top.
 */
const TABS: readonly { to: string; icon: LucideIcon; label: MessageKey }[] = [
  { to: '/', icon: CalendarCheck, label: 'nav.today' },
  { to: '/library', icon: Library, label: 'nav.library' },
  { to: '/settings', icon: Settings, label: 'nav.settings' },
];

export function Shell() {
  const t = useTranslate();
  const path = useRouterState({ select: (state) => state.location.pathname });

  return (
    <div className="flex min-h-dvh flex-col sm:flex-col-reverse sm:justify-end">
      <main className="mx-auto w-full max-w-[720px] grow px-16 pt-[calc(var(--safe-top)+16px)] pb-[calc(var(--safe-bottom)+var(--bar-height)+24px)] sm:pb-32">
        <Outlet />
      </main>

      <nav
        aria-label={t('app.name')}
        className={[
          'fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface',
          'pb-[var(--safe-bottom)]',
          'sm:static sm:border-t-0 sm:border-b sm:pb-0',
        ].join(' ')}
      >
        <ul className="mx-auto flex w-full max-w-[720px]">
          {TABS.map((tab) => {
            const active = tab.to === '/' ? path === '/' : path.startsWith(tab.to);
            const Icon = tab.icon;

            return (
              <li key={tab.to} className="flex-1">
                <Link
                  to={tab.to}
                  aria-current={active ? 'page' : undefined}
                  className={[
                    'flex min-h-44 flex-col items-center justify-center gap-4 px-8 py-8',
                    'text-12 transition-colors sm:flex-row sm:gap-8 sm:text-14',
                    active ? 'text-accent' : 'text-text-dim hover:text-text',
                  ].join(' ')}
                >
                  <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
                  {t(tab.label)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

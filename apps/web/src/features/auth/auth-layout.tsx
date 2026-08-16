import type { ReactNode } from 'react';

/**
 * The frame the signed out screens sit in.
 *
 * The heading is at the top and the form is at the bottom, with the space
 * between them growing rather than the form floating in the middle. On a phone
 * that puts the fields and the button where the thumb already is; on a desktop
 * the column is capped and centred and it reads as an ordinary form.
 *
 * The space between them is the part that gives way to the keyboard. The page
 * is as tall as the screen, so with the keys out there was nowhere to scroll to
 * and the button sat behind them: pressing it meant dismissing the keyboard
 * first, which is the sort of thing that makes a form feel broken. Three things
 * fix it. The gap collapses when the keyboard is up, which lifts the whole form
 * without moving the page; the padding underneath grows by the height of the
 * keyboard, so anything still below the fold can be scrolled to; and the room
 * above the heading and between the blocks contracts, which is `data-form` in
 * the stylesheet.
 *
 * The third one is what makes the button visible rather than merely reachable.
 * A 375 by 812 screen with a keyboard out leaves 476 pixels, and sign up wanted
 * about 514 of them, so the action was thirty eight pixels under the keys and
 * the only way to see it was to scroll a form that looked like it had nowhere
 * to go.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  readonly title: string;
  readonly subtitle?: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}) {
  return (
    <div
      data-form=""
      className={[
        'mx-auto flex min-h-dvh w-full max-w-[420px] flex-col px-20',
        'gap-24 pt-[calc(var(--safe-top)+56px)]',
        'pb-[calc(var(--safe-bottom)+24px+var(--keyboard-inset))]',
        /*
         * The head room and the gaps contract while the keyboard is up. Written
         * as a variant rather than a rule in the stylesheet because a utility
         * beats the components layer, so the padding here would have won and
         * nothing would have moved.
         */
        '[[data-keyboard=open]_&]:gap-12 [[data-keyboard=open]_&]:pt-12',
      ].join(' ')}
    >
      <header className="neu-screen-in flex flex-col gap-12">
        <h1 className="font-display text-32 tracking-tight text-primary">{title}</h1>
        {subtitle ? (
          <p className="max-w-[34ch] text-14 leading-body text-secondary">{subtitle}</p>
        ) : undefined}
      </header>

      {/*
        The one flexible thing on the screen, and the first thing to give way.
        It collapses rather than animating: growing is a layout property, and
        the keyboard is already animating over the top of it.
      */}
      <div data-gap="" className="grow" />

      <div className="flex flex-col gap-20">{children}</div>

      {footer ? <div className="flex flex-col gap-12 text-13">{footer}</div> : undefined}
    </div>
  );
}

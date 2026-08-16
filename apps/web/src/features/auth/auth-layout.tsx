import type { ReactNode } from 'react';

/**
 * The frame the signed out screens sit in.
 *
 * A card in the middle of the screen, at every width. It used to be a heading
 * pinned to the top and a form pushed against the bottom edge, with the space
 * between them growing, on the theory that a phone's thumb lives at the foot of
 * the screen. What that produced was "Sign in" at the very top of an empty
 * screen and the fields 500 pixels below it, which reads as two unrelated
 * things rather than as one form, and every other application a person has
 * signed into puts the whole thing in the middle.
 *
 * `m-auto` and not `justify-center`. Centring by flex alignment clips the top
 * of anything taller than the screen, and there is no scrolling back to it: sign
 * up with an error under both fields and a keyboard up is exactly that case.
 * An automatic margin centres what fits and leaves what does not alone.
 *
 * The keyboard is handled by the padding underneath. The page reserves the
 * keyboard's height, so the foot of the form can be scrolled to, and `data-form`
 * is what `src/lib/viewport.ts` looks for when it brings the focused field back
 * onto the screen.
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
      className={[
        'flex min-h-dvh w-full flex-col px-16',
        'pt-[calc(var(--safe-top)+16px)]',
        'pb-[calc(var(--safe-bottom)+16px+var(--keyboard-inset))]',
      ].join(' ')}
    >
      <div
        data-form=""
        data-g="card"
        className={[
          'neu-screen-in m-auto flex w-full max-w-[420px] flex-col gap-24',
          'rounded-24 border p-20 sm:p-24',
          // The room inside contracts while the keyboard is up, which is what
          // keeps the button visible rather than merely reachable. Written as a
          // variant rather than a rule in the stylesheet because a utility beats
          // the components layer and the padding here would have won.
          '[[data-keyboard=open]_&]:gap-16',
        ].join(' ')}
      >
        <header className="flex flex-col gap-8">
          <h1 className="font-display text-24 tracking-tight text-primary">{title}</h1>
          {subtitle ? (
            <p className="text-14 leading-body text-secondary">{subtitle}</p>
          ) : undefined}
        </header>

        <div className="flex flex-col gap-20">{children}</div>

        {footer ? <div className="flex flex-col gap-12 text-13">{footer}</div> : undefined}
      </div>
    </div>
  );
}

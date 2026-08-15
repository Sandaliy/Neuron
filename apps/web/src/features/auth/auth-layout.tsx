import type { ReactNode } from 'react';

/**
 * The frame the signed out screens sit in.
 *
 * The heading is at the top and the form is at the bottom, with the space
 * between them growing rather than the form floating in the middle. On a phone
 * that puts the fields and the button where the thumb already is; on a desktop
 * the column is capped and centred and it reads as an ordinary form.
 *
 * The title is set in the reading face. It is the one piece of chrome that is,
 * because it is the first thing on the screen and the only word on its line.
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
    <div className="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col gap-24 px-20 pt-[calc(var(--safe-top)+56px)] pb-[calc(var(--safe-bottom)+24px)]">
      <header className="flex flex-col gap-12">
        <h1 className="font-display text-32 tracking-tight text-primary">{title}</h1>
        {subtitle ? (
          <p className="max-w-[34ch] text-14 leading-body text-secondary">{subtitle}</p>
        ) : undefined}
      </header>

      <div className="grow" />

      <div className="flex flex-col gap-20">{children}</div>

      {footer ? <div className="flex flex-col gap-12 text-13">{footer}</div> : undefined}
    </div>
  );
}

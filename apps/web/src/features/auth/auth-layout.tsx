import type { ReactNode } from 'react';

/**
 * The frame the signed out screens sit in.
 *
 * The heading is at the top and the form is at the bottom, with the space
 * between them growing rather than the form floating in the middle. On a phone
 * that puts the fields and the button where the thumb already is; on a desktop
 * the column is capped and centred and it reads as an ordinary form.
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
    <div className="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col px-16 pt-[calc(var(--safe-top)+32px)] pb-[calc(var(--safe-bottom)+24px)]">
      <header className="flex flex-col gap-8">
        <h1 className="text-24 font-semibold text-text">{title}</h1>
        {subtitle ? <p className="text-16 text-text-dim">{subtitle}</p> : undefined}
      </header>

      <div className="grow" />

      <div className="flex flex-col gap-16">{children}</div>

      {footer ? <div className="mt-24 flex flex-col gap-12 text-14">{footer}</div> : undefined}
    </div>
  );
}

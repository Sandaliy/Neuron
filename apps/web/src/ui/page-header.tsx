import { ChevronLeft } from 'lucide-react';

import type { ReactNode } from 'react';

/**
 * The way back, always in the same place and always the same shape: a chevron
 * and the name of where it goes. It names a place, never just "Back", so the
 * person knows where they will land before pressing it.
 */
export function BackLink({
  label,
  onClick,
}: {
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-back=""
      onClick={onClick}
      className="-ml-12 flex min-h-44 min-w-0 max-w-full items-center gap-4 rounded-12 pr-8 pl-8 text-15 text-accent hover:bg-fill-neutral"
    >
      <ChevronLeft size={20} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

/**
 * Every screen's head, in one order.
 *
 *   Back to the previous place, with the screen's actions on the same row
 *   The title, the full width
 *   Where the thing sits, only when Back does not already say it
 *   One line of description, only when the title cannot carry it
 *
 * Screens used to build this themselves, so a Back control sat above, beside or
 * below a breadcrumb depending on who wrote the screen, and some screens showed
 * the same place twice. A screen at the top of a tab has no Back: its title
 * shares the row with its actions instead.
 */
export function PageHeader({
  title,
  back,
  actions,
  location,
  description,
  children,
}: {
  readonly title: ReactNode;
  readonly back?: ReactNode;
  readonly actions?: ReactNode;
  readonly location?: ReactNode;
  readonly description?: ReactNode;
  readonly children?: ReactNode;
}) {
  const group = actions ? (
    <div className="ml-auto flex shrink-0 items-center gap-4 [&>button]:px-8 [&>button]:py-8 [&>fieldset>button]:px-8 [&>fieldset>button]:py-8">
      {actions}
    </div>
  ) : undefined;
  const heading = (
    <h1 className="min-w-0 break-words font-display text-24 tracking-tight text-primary">
      {title}
    </h1>
  );
  return (
    <header data-page-header="" className="flex min-w-0 flex-col gap-4">
      {back ? (
        <>
          <div className="flex min-h-44 min-w-0 items-center gap-8">
            <div className="flex min-w-0 flex-1">{back}</div>
            {group}
          </div>
          {heading}
        </>
      ) : (
        <div className="flex min-h-44 min-w-0 items-center gap-8">
          <div className="min-w-0 flex-1">{heading}</div>
          {group}
        </div>
      )}
      {location}
      {description ? <p className="text-14 leading-body text-secondary">{description}</p> : null}
      {children}
    </header>
  );
}

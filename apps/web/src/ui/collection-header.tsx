import type { ReactNode } from 'react';

/**
 * A collection screen's head: where it sits, then one title and one compact
 * action group, then anything that qualifies the title.
 *
 * The path goes above the title, the way a phone's own navigation puts the
 * way back above the large title, so the Back control and the ancestors are in
 * the same place on every nested screen.
 */
export function CollectionHeader({
  title,
  actions,
  path,
  children,
}: {
  readonly title: ReactNode;
  readonly actions: ReactNode;
  readonly path?: ReactNode;
  readonly children?: ReactNode;
  readonly readOnly?: boolean;
}) {
  const group = (
    <div className="ml-auto flex shrink-0 items-center gap-4 [&>button]:px-8 [&>button]:py-8 [&>fieldset>button]:px-8 [&>fieldset>button]:py-8">
      {actions}
    </div>
  );
  const heading = (
    <h1 className="min-w-0 flex-1 basis-[160px] break-words font-display text-24 tracking-tight text-primary">
      {title}
    </h1>
  );
  /*
   * With a path, the actions share its row, as a phone's navigation bar puts
   * its buttons beside the way back, and the title has the full width below.
   * Sharing the title's row instead wrapped the actions onto a line of their
   * own on a phone, between the title and everything it names.
   */
  return (
    <header className="flex min-w-0 flex-col gap-4">
      {path ? (
        <>
          <div className="flex min-h-44 min-w-0 items-center justify-between gap-8">
            <div className="min-w-0 flex-1">{path}</div>
            {group}
          </div>
          <div className="flex min-w-0">{heading}</div>
        </>
      ) : (
        <div className="flex min-h-44 min-w-0 flex-wrap items-center justify-between gap-8">
          {heading}
          {group}
        </div>
      )}
      {children}
    </header>
  );
}

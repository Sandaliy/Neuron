import type { ReactNode } from 'react';

/** One title and one compact action group, with a path immediately below. */
export function CollectionHeader({
  title,
  actions,
  children,
}: {
  readonly title: ReactNode;
  readonly actions: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <header className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 items-center justify-between gap-8">
        <h1 className="min-w-0 truncate font-display text-24 tracking-tight text-primary">
          {title}
        </h1>
        <div className="flex shrink-0 items-center gap-4 [&>button]:px-8 [&>button]:py-8">
          {actions}
        </div>
      </div>
      {children}
    </header>
  );
}

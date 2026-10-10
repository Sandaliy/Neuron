import { ReadOnlySlot } from './read-only-slot';

import type { ReactNode } from 'react';

/** One title and one compact action group, with a path immediately below. */
export function CollectionHeader({
  title,
  actions,
  children,
  readOnly = false,
}: {
  readonly title: ReactNode;
  readonly actions: ReactNode;
  readonly children?: ReactNode;
  readonly readOnly?: boolean;
}) {
  return (
    <header className="flex min-w-0 flex-col gap-4">
      <div className="flex min-h-44 min-w-0 flex-wrap items-center justify-between gap-8">
        <h1 className="min-w-0 flex-1 basis-[160px] break-words font-display text-24 tracking-tight text-primary">
          {title}
        </h1>
        <ReadOnlySlot
          readOnly={readOnly}
          inline
          fallback={actions}
          className="ml-auto flex shrink-0 items-center gap-4 [&>button]:px-8 [&>button]:py-8"
        >
          {actions}
        </ReadOnlySlot>
      </div>
      {children}
    </header>
  );
}

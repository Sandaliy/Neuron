import type { ReactNode } from 'react';

/** Preserve recognizable disabled controls instead of measured empty regions. */
export function ReadOnlySlot({
  readOnly,
  children,
  fallback,
  className,
}: {
  readonly readOnly: boolean;
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
  readonly inline?: boolean;
  readonly className?: string;
}) {
  return (
    <div className={className}>
      {fallback ? (
        readOnly ? (
          fallback
        ) : (
          children
        )
      ) : (
        <fieldset disabled={readOnly} className="contents">
          {children}
        </fieldset>
      )}
    </div>
  );
}

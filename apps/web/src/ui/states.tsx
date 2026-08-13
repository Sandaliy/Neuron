import { Button } from './button';

import type { ReactNode } from 'react';

/**
 * The three things a screen can be showing instead of its content.
 *
 * They live together because they are the same decision made three ways, and
 * because CLAUDE.md treats a list that renders as a blank area as a defect. A
 * screen that reads from the api has to answer all three cases, and having them
 * in one file makes it obvious when one is missing.
 */

/**
 * A block the shape of the content that is coming.
 *
 * A skeleton rather than a centred spinner: it holds the layout still, so the
 * page does not jump when the answer arrives, and it says what kind of thing is
 * about to appear.
 */
export function Skeleton({ className = '' }: { readonly className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-6 bg-surface-2 ${className}`.trimEnd()}
    />
  );
}

/** Several skeleton rows, for a list. */
export function SkeletonRows({ rows = 3 }: { readonly rows?: number }) {
  return (
    <div className="flex flex-col gap-8" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-44 w-full" />
      ))}
    </div>
  );
}

/** Nothing here yet, and what to do about it. */
export function EmptyState({
  title,
  description,
  action,
}: {
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-12 rounded-14 border border-border bg-surface px-16 py-32 text-center">
      <p className="text-16 font-semibold text-text">{title}</p>
      <p className="max-w-[36ch] text-16 text-text-dim">{description}</p>
      {action}
    </div>
  );
}

/**
 * Something went wrong, said in words, with a way forward.
 *
 * Never a status code on its own and never a stack trace. The person reading
 * this is not a developer, and "503" tells them nothing they can act on.
 */
export function ErrorState({
  message,
  retryLabel,
  onRetry,
}: {
  readonly message: string;
  readonly retryLabel: string;
  readonly onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-16 rounded-14 border border-border bg-surface px-16 py-32 text-center"
    >
      <p className="max-w-[40ch] text-16 text-text">{message}</p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : undefined}
    </div>
  );
}

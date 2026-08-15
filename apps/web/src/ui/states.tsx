import { useTranslate } from '../i18n/locale';

import { Button } from './button';

import type { ReactNode } from 'react';

/**
 * The three things a screen can be showing instead of its content.
 *
 * They live together because they are the same decision made three ways, and
 * because a list that renders as a blank area is a defect. A screen that reads
 * from the api has to answer all three cases, and having them in one file makes
 * it obvious when one is missing.
 *
 * None of them is a centred icon in a void. If content is thin, the screen
 * carries the next action and the reason for it.
 */

/**
 * A block the shape of the content that is coming.
 *
 * A skeleton rather than a centred spinner: it holds the layout still, so the
 * page does not jump when the answer arrives, and it says what kind of thing is
 * about to appear. The sheen travels on `transform` and stops when the content
 * lands.
 */
export function Skeleton({ className = '' }: { readonly className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`neu-sheen relative overflow-hidden rounded-8 bg-skeleton ${className}`.trimEnd()}
    />
  );
}

/** Several skeleton rows, for a list. */
export function SkeletonRows({ rows = 3 }: { readonly rows?: number }) {
  const t = useTranslate();

  return (
    <div className="flex flex-col gap-8" role="status" aria-label={t('common.loading')}>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-52 w-full" />
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
    <div className="flex flex-col items-start gap-12 rounded-24 border border-subtle bg-card p-20 shadow-1">
      <p className="text-17 text-primary">{title}</p>
      <p className="max-w-[38ch] text-14 leading-body text-secondary">{description}</p>
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
      className="flex flex-col items-start gap-16 rounded-24 border border-subtle bg-card p-20 shadow-1"
    >
      <p className="max-w-[40ch] text-14 leading-body text-primary">{message}</p>
      {onRetry ? (
        <Button variant="quiet" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : undefined}
    </div>
  );
}

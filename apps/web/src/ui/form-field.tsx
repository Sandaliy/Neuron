import * as Label from '@radix-ui/react-label';
import { useId } from 'react';

import type { ReactElement, ReactNode } from 'react';

/**
 * A label, a control, and the two things that can be said about it.
 *
 * The error is wired with `aria-describedby` and announced politely, so
 * somebody using a screen reader hears what is wrong with the field they are
 * standing in rather than discovering it when the form refuses to submit.
 *
 * `children` is a render function because the ids have to reach the control,
 * and passing an element and cloning it hides that wiring from the reader.
 */
export function FormField({
  label,
  hint,
  error,
  children,
  after,
}: {
  readonly label: string;
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
  readonly children: (props: {
    id: string;
    'aria-describedby': string | undefined;
    'aria-invalid': true | undefined;
  }) => ReactElement;
  /** Anything that belongs between the control and its message, like a strength bar. */
  readonly after?: ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : undefined, error ? errorId : undefined]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="flex flex-col gap-8">
      <Label.Root htmlFor={id} className="text-13 font-semibold text-secondary">
        {label}
      </Label.Root>

      {children({
        id,
        'aria-describedby': describedBy.length > 0 ? describedBy : undefined,
        'aria-invalid': error ? true : undefined,
      })}

      {after}

      {hint && !error ? (
        <p id={hintId} className="text-13 leading-snug text-tertiary">
          {hint}
        </p>
      ) : undefined}

      {error ? (
        <p id={errorId} role="alert" className="text-13 leading-snug text-error">
          {error}
        </p>
      ) : undefined}
    </div>
  );
}

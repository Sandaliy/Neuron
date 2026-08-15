import type { InputHTMLAttributes } from 'react';

/**
 * A text field.
 *
 * Sixteen pixels of text at the smallest, or iOS Safari zooms the page the
 * moment it is focused and leaves the person scrolled sideways inside a form
 * they were halfway through. The base stylesheet enforces that floor.
 *
 * `busy` is a field that is checking something. The spinner sits inside the
 * field, so the field never changes size while it waits.
 */
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly invalid?: boolean;
  readonly busy?: boolean;
}

export function Input({ invalid = false, busy = false, className = '', ...rest }: InputProps) {
  const field = (
    <input
      aria-invalid={invalid || undefined}
      aria-busy={busy || undefined}
      className={[
        'min-h-44 w-full rounded-12 border bg-input px-16 py-12 text-16 text-primary',
        'transition-[border-color,background-color] placeholder:text-tertiary',
        'disabled:cursor-not-allowed disabled:border-subtle disabled:bg-sunken disabled:text-disabled',
        invalid ? 'border-error' : 'border-default hover:border-strong',
        busy ? 'pr-40' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    />
  );

  if (!busy) {
    return field;
  }

  return (
    <span className="relative block">
      {field}
      <span
        aria-hidden="true"
        className="neu-spin absolute top-1/2 right-16 block size-16 -translate-y-1/2 rounded-full border-2 border-subtle border-t-accent"
      />
    </span>
  );
}

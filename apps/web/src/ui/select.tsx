import { ChevronDown } from 'lucide-react';

import type { SelectHTMLAttributes } from 'react';

/**
 * A native select.
 *
 * Native on purpose: on a phone the platform picker is a wheel the person
 * already knows, and it does not cover the field being chosen. The chevron is
 * ours, because the browser draws its own in the wrong place and the wrong
 * colour.
 *
 * Two or three options are a segmented group instead. This is for lists longer
 * than that, like a time zone.
 */
export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  readonly invalid?: boolean;
}

export function Select({ invalid = false, className = '', children, ...rest }: SelectProps) {
  return (
    <span className="relative block">
      <select
        aria-invalid={invalid || undefined}
        className={[
          'min-h-44 w-full appearance-none rounded-12 border bg-input py-12 pr-40 pl-16',
          'text-16 text-primary transition-[border-color]',
          'disabled:cursor-not-allowed disabled:border-subtle disabled:bg-sunken disabled:text-disabled',
          invalid ? 'border-error' : 'border-default hover:border-strong',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        {...rest}
      >
        {children}
      </select>

      <ChevronDown
        size={16}
        strokeWidth={1.5}
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-16 -translate-y-1/2 text-tertiary"
      />
    </span>
  );
}

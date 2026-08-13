import type { InputHTMLAttributes } from 'react';

/**
 * A text field.
 *
 * Sixteen pixels, never smaller, or iOS Safari zooms the page the moment it is
 * focused and leaves the person scrolled sideways inside a form they were
 * halfway through.
 */
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly invalid?: boolean;
}

export function Input({ invalid = false, className = '', ...rest }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={[
        'min-h-44 w-full rounded-10 border bg-surface px-12 py-12 text-16 text-text',
        'placeholder:text-text-dim transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        invalid ? 'border-danger' : 'border-border hover:border-text-dim',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    />
  );
}

import { Spinner } from './spinner';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * The one button.
 *
 * Three variants and nothing else. `primary` is the single action a screen
 * wants; there is never more than one on a screen. `secondary` is everything
 * that is a real choice but not the point. `danger` is for the two things that
 * cannot be undone: leaving, and turning off the second factor.
 *
 * Forty four pixels tall at the smallest, because it has to be hittable with a
 * thumb on a phone held one handed.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'danger';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-text hover:opacity-90 disabled:hover:opacity-100',
  secondary: 'bg-surface-2 text-text border border-border hover:border-text-dim',
  danger: 'bg-transparent text-danger border border-danger hover:bg-danger/10',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  /** Fills the width of its container. The default on a phone form. */
  readonly full?: boolean;
  /** Shows a spinner and refuses further presses. */
  readonly busy?: boolean;
  readonly children: ReactNode;
}

export function Button({
  variant = 'secondary',
  full = false,
  busy = false,
  disabled,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled === true || busy}
      // `aria-busy` rather than only a spinner, so a screen reader hears that
      // the press was taken and something is happening.
      aria-busy={busy}
      className={[
        'inline-flex min-h-44 items-center justify-center gap-8 rounded-10 px-16 py-12',
        'text-16 font-semibold transition-[opacity,border-color,background-color]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        full ? 'w-full' : '',
        VARIANTS[variant],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {busy ? <Spinner /> : undefined}
      {children}
    </button>
  );
}

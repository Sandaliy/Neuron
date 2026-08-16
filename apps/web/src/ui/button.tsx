import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * The one action.
 *
 * Four variants, and the rule that goes with them: one primary action per
 * screen. Two accent fills on one screen is a bug, so everything that is a real
 * choice but not the point is `quiet`, and everything smaller than that is
 * `text`. `destructive` is text as well, never a red slab: a filled red button
 * is a large area of the signal hue, and the signal hue exists for error text.
 *
 * Forty four pixels tall at the smallest, forty eight when it fills the width
 * of a phone form, because it has to be hittable with a thumb one handed.
 *
 * Seven states, all of them drawn: default, hover, active, focus, disabled,
 * loading, and the destructive tone. The gallery at /dev/components renders
 * every one of them side by side.
 */
export type ButtonVariant = 'primary' | 'quiet' | 'text' | 'destructive';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: [
    'bg-fill-accent text-on-accent shadow-1',
    'hover:not-disabled:bg-fill-accent-hover hover:not-disabled:shadow-2',
    'active:not-disabled:shadow-none',
    // Never the accent when it cannot be pressed. A dimmed accent still reads
    // as the thing to press.
    'disabled:bg-fill-neutral disabled:text-disabled disabled:shadow-none',
  ].join(' '),
  quiet: [
    'border border-default bg-fill-neutral text-secondary',
    'hover:not-disabled:border-strong hover:not-disabled:bg-fill-neutral-hover',
    'hover:not-disabled:text-primary',
    'disabled:bg-transparent disabled:text-disabled',
  ].join(' '),
  text: [
    'text-accent',
    'hover:not-disabled:text-primary hover:not-disabled:underline hover:not-disabled:underline-offset-4',
    'disabled:text-disabled',
  ].join(' '),
  destructive: [
    'text-error',
    'hover:not-disabled:underline hover:not-disabled:underline-offset-4',
    'disabled:text-disabled',
  ].join(' '),
};

/** `text` and `destructive` are words in a sentence, not slabs. */
const PADDED: Record<ButtonVariant, boolean> = {
  primary: true,
  quiet: true,
  text: false,
  destructive: false,
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  /** Fills the width of its container. The default on a phone form. */
  readonly full?: boolean;
  /** Shows a spinner and refuses further presses. */
  readonly busy?: boolean;
  readonly children: ReactNode;
}

function shape(variant: ButtonVariant, full: boolean): string {
  if (!PADDED[variant]) {
    // Still forty eight tall and the width of the form when it is a screen's
    // own action. A text action is not a slab, but it is still a target.
    return full ? 'min-h-48 w-full text-15' : 'min-h-44 text-14';
  }

  return full
    ? 'min-h-48 w-full rounded-12 p-16 text-15'
    : 'min-h-44 rounded-12 px-16 py-12 text-14';
}

export function Button({
  variant = 'quiet',
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
      /*
       * A word in a sentence dims when it is pressed; a slab shrinks. The
       * stylesheet needs to tell the two apart, and the variant is the only
       * thing that knows.
       */
      data-tone={PADDED[variant] ? 'slab' : 'text'}
      disabled={disabled === true || busy}
      // `aria-busy` rather than only a spinner, so a screen reader hears that
      // the press was taken and something is happening.
      aria-busy={busy}
      className={[
        'relative inline-flex items-center justify-center gap-8 font-semibold',
        // How a press is answered lives in the stylesheet, for every control at
        // once. A transition utility written here would win over it and this
        // button would answer differently from the rest of the interface.
        'disabled:cursor-not-allowed',
        shape(variant, full),
        VARIANTS[variant],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {/*
        The label stays where it is and turns transparent, so a button that
        starts waiting does not change width and move everything under it.
      */}
      <span className={busy ? 'invisible' : undefined}>{children}</span>

      {busy ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="neu-spin block size-16 rounded-full border-2 border-current border-t-transparent opacity-60" />
        </span>
      ) : undefined}
    </button>
  );
}

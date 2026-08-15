import type { CSSProperties } from 'react';

/**
 * A line that fills.
 *
 * Used for how much of today's minutes are spent, and for how far through a
 * session somebody is. It scales on `transform` rather than animating a width,
 * so a progress bar that moves every few seconds costs no layout.
 *
 * `tone` exists because the same shape is the password strength bar, which is
 * the one place a filled line is allowed to turn to the signal hue.
 */
export type ProgressTone = 'accent' | 'error';

export function Progress({
  value,
  max = 1,
  label,
  tone = 'accent',
}: {
  readonly value: number;
  readonly max?: number;
  /** What the line is measuring, for anyone who cannot see it. */
  readonly label: string;
  readonly tone?: ProgressTone;
}) {
  const share = max <= 0 ? 0 : Math.min(1, Math.max(0, value / max));

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(share * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-4 w-full overflow-hidden rounded-full bg-subtle"
    >
      <div
        className={[
          'h-full origin-left transition-transform',
          'dur-reveal',
          tone === 'error' ? 'bg-error' : 'bg-fill-accent',
        ].join(' ')}
        style={{ transform: `scaleX(${share})` } as CSSProperties}
      />
    </div>
  );
}

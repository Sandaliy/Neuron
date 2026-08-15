import type { CSSProperties, InputHTMLAttributes } from 'react';

/**
 * A number chosen by dragging.
 *
 * A rail, the filled portion, and one white disc. The filled portion is a
 * gradient handed to the stylesheet as `--track`, because the track is a native
 * pseudo element and cannot be given a child.
 *
 * The value is rendered next to the label by whoever uses this, in the mono
 * face, so a number changing from 9 to 10 does not move the row it sits in.
 */
export interface RangeProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'min' | 'max' | 'step'
> {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly onValueChange: (value: number) => void;
}

export function Range({
  value,
  min,
  max,
  step = 1,
  onValueChange,
  className = '',
  ...rest
}: RangeProps) {
  const filled = max === min ? 0 : ((value - min) / (max - min)) * 100;

  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onValueChange(Number(event.target.value))}
      className={className}
      style={
        {
          '--track': `linear-gradient(90deg, var(--fill-accent) 0 ${filled}%, var(--track-rail) ${filled}% 100%)`,
        } as CSSProperties
      }
      {...rest}
    />
  );
}

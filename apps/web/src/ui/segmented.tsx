import { useId } from 'react';

/**
 * A row of options, all of them visible.
 *
 * Used for the theme and the language, which have three answers and two. A
 * dropdown for those costs two taps and covers a third of a phone screen with
 * a popover to show what would have fitted on one line.
 *
 * Native radio inputs rather than a Radix primitive: a radio group is exactly
 * what this is, and the browser already gives it arrow key navigation, a group
 * label, and the right thing said by a screen reader. The inputs are hidden
 * from sight but not from the accessibility tree, so the keyboard behaviour is
 * the browser's own rather than an imitation of it.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly label: string;
}) {
  const name = useId();

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex gap-4 rounded-10 border border-border bg-surface-2 p-4"
    >
      {options.map((option) => {
        const id = `${name}-${option.value}`;
        const selected = option.value === value;

        return (
          <div key={option.value} className="flex-1">
            <input
              type="radio"
              id={id}
              name={name}
              value={option.value}
              checked={selected}
              onChange={() => onChange(option.value)}
              className="peer sr-only"
            />
            <label
              htmlFor={id}
              className={[
                'flex min-h-44 cursor-pointer items-center justify-center rounded-6 px-8',
                'text-center text-14 transition-colors',
                // The focus ring hangs off the label, because the input it
                // belongs to is the thing that is not on screen.
                'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2',
                'peer-focus-visible:outline-accent',
                selected ? 'bg-accent font-semibold text-accent-text' : 'text-text-dim',
              ].join(' ')}
            >
              {option.label}
            </label>
          </div>
        );
      })}
    </div>
  );
}

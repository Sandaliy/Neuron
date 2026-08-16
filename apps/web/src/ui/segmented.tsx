import { useId } from 'react';

import type { CSSProperties } from 'react';

/**
 * A row of options, all of them visible, with a thumb that slides to the one
 * that is chosen.
 *
 * Segmented replaces radios everywhere, and it is for two or three options. A
 * dropdown for those costs two taps and covers a third of a phone screen with a
 * popover to show what fitted on one line.
 *
 * Native radio inputs rather than a Radix primitive: a radio group is exactly
 * what this is, and the browser already gives it arrow key navigation, a group
 * label, and the right thing said by a screen reader. The inputs are hidden
 * from sight but not from the accessibility tree, so the keyboard behaviour is
 * the browser's own rather than an imitation of it.
 *
 * The thumb travels on `transform` alone. The cells are equal width, so its
 * position is the index of the chosen cell and nothing has to be measured,
 * which also means it is in the right place on the first frame.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  disabled = false,
}: {
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly label: string;
  readonly disabled?: boolean;
}) {
  const name = useId();
  const index = options.findIndex((option) => option.value === value);

  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-slot="segmented"
      className={[
        'flex rounded-12 border border-subtle bg-sunken p-4',
        disabled ? 'opacity-40' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={
        {
          '--seg-count': options.length,
          '--seg-index': index < 0 ? 0 : index,
        } as CSSProperties
      }
    >
      {/*
        Hidden while nothing is chosen rather than parked on the first cell,
        which would say the first option is selected when it is not.
      */}
      <span
        data-slot="segmented-thumb"
        aria-hidden="true"
        className={index < 0 ? 'opacity-0' : undefined}
      />

      {options.map((option) => {
        const id = `${name}-${option.value}`;
        const selected = option.value === value;

        return (
          <div key={option.value} className="relative z-10 flex-1">
            <input
              type="radio"
              id={id}
              name={name}
              value={option.value}
              checked={selected}
              disabled={disabled}
              onChange={() => onChange(option.value)}
              className="peer sr-only"
            />
            <label
              htmlFor={id}
              data-cell=""
              className={[
                'flex min-h-44 cursor-pointer items-center justify-center rounded-8 px-8',
                'text-center text-13',
                // The focus ring hangs off the label, because the input it
                // belongs to is the thing that is not on screen.
                'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2',
                'peer-focus-visible:outline-[var(--focus-ring)]',
                'peer-disabled:cursor-not-allowed',
                selected ? 'font-semibold text-primary' : 'text-secondary hover:text-primary',
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

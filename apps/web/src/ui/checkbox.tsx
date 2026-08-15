import * as RadixCheckbox from '@radix-ui/react-checkbox';
import { useId } from 'react';

import type { ReactNode } from 'react';

/**
 * A checkbox with its label.
 *
 * The whole row is the target, not the twenty pixel square, because the one
 * checkbox that matters in this app is the one confirming the recovery codes
 * have been saved, and it is pressed on a phone.
 *
 * The checked mark is the fill itself, framed by an inset ring rather than a
 * tick glyph. That is the same decision as the rest of the system: state is
 * carried by the surface, not by an icon added on top of it. The ring is drawn
 * in the stylesheet, next to the other control craft.
 */
export function Checkbox({
  checked,
  onChange,
  children,
  disabled = false,
}: {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly children: ReactNode;
  readonly disabled?: boolean;
}) {
  const id = useId();

  return (
    <div className="flex min-h-44 items-start gap-12 rounded-12 p-12 transition-colors hover:bg-fill-neutral">
      <RadixCheckbox.Root
        id={id}
        data-slot="checkbox"
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onChange(next === true)}
        className={[
          'mt-4 flex size-20 shrink-0 items-center justify-center rounded-8 border',
          'border-strong bg-input transition-[background-color,border-color]',
          'data-[state=checked]:border-transparent data-[state=checked]:bg-fill-accent',
          'disabled:cursor-not-allowed disabled:border-subtle disabled:bg-sunken',
        ].join(' ')}
      />

      <label htmlFor={id} className="cursor-pointer text-14 leading-body text-secondary">
        {children}
      </label>
    </div>
  );
}

import * as RadixCheckbox from '@radix-ui/react-checkbox';
import { useId } from 'react';

import type { ReactNode } from 'react';

/**
 * A choice that can be on or off among others: a row with a switch at its end.
 *
 * Semantically still a checkbox, with the partial state a Folder needs when
 * only some of its Decks are chosen. It is drawn with the app's switch, the
 * control Settings already uses for yes and no, because both earlier marks
 * read badly at twenty pixels: a fill framed by a white ring looked like a
 * radio bullet, and a tick looked like a form. Partial puts the knob half way.
 *
 * The whole row is the target and the label is the control's own name, so a
 * press anywhere on it toggles, which matters on a phone.
 */
export function Checkbox({
  checked,
  onChange,
  children,
  disabled = false,
  labelClassName = '',
}: {
  readonly checked: boolean | 'indeterminate';
  readonly onChange: (checked: boolean) => void;
  readonly children: ReactNode;
  readonly disabled?: boolean;
  readonly labelClassName?: string;
}) {
  const id = useId();

  return (
    <RadixCheckbox.Root
      id={id}
      data-slot="checkbox"
      aria-labelledby={`${id}-label`}
      checked={checked}
      disabled={disabled}
      onCheckedChange={(next) => onChange(next === true)}
      className={[
        'group flex min-h-44 w-full items-center gap-12 rounded-12 px-12 py-8 text-left',
        'hover:bg-fill-neutral disabled:cursor-not-allowed disabled:opacity-50',
      ].join(' ')}
    >
      <span
        id={`${id}-label`}
        className={[
          'min-w-0 flex-1 text-14 leading-body text-secondary',
          'group-data-[state=checked]:text-primary group-data-[state=indeterminate]:text-primary',
          labelClassName,
        ].join(' ')}
      >
        {children}
      </span>
      <span
        aria-hidden="true"
        data-slot="switch-track"
        className="relative h-32 w-56 shrink-0 rounded-full bg-switch-off group-data-[state=checked]:bg-fill-accent group-data-[state=indeterminate]:bg-fill-accent"
      >
        <span
          data-slot="switch-knob"
          className="absolute top-4 left-4 block size-24 rounded-full bg-white"
        />
      </span>
    </RadixCheckbox.Root>
  );
}

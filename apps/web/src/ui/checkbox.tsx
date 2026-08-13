import * as RadixCheckbox from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import { useId } from 'react';

import type { ReactNode } from 'react';

/**
 * A checkbox with its label.
 *
 * The whole row is the target, not the sixteen pixel square, because the one
 * checkbox that matters in this app is the one confirming the recovery codes
 * have been saved, and it is pressed on a phone.
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
    <div className="flex min-h-44 items-start gap-12">
      <RadixCheckbox.Root
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onChange(next === true)}
        className={[
          'mt-4 flex size-24 shrink-0 items-center justify-center rounded-6 border transition-colors',
          'data-[state=checked]:border-accent data-[state=checked]:bg-accent',
          'border-border hover:border-text-dim disabled:opacity-50',
        ].join(' ')}
      >
        <RadixCheckbox.Indicator className="text-accent-text">
          <Check size={16} strokeWidth={1.5} aria-hidden="true" />
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>

      <label htmlFor={id} className="cursor-pointer py-4 text-16 text-text">
        {children}
      </label>
    </div>
  );
}

import * as RadixSelect from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';

/**
 * A select.
 *
 * Radix rather than a native `<select>`, because the native control cannot be
 * styled on iOS and would arrive in the middle of a dark screen wearing the
 * system's own light colours.
 */
export function Select<T extends string>({
  value,
  onChange,
  options,
  label,
  id,
}: {
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly label: string;
  readonly id?: string;
}) {
  return (
    <RadixSelect.Root value={value} onValueChange={(next) => onChange(next as T)}>
      <RadixSelect.Trigger
        id={id}
        aria-label={label}
        className={[
          'inline-flex min-h-44 w-full items-center justify-between gap-8 rounded-10',
          'border border-border bg-surface px-12 py-12 text-16 text-text',
          'transition-colors hover:border-text-dim',
        ].join(' ')}
      >
        <RadixSelect.Value />
        <RadixSelect.Icon>
          <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>

      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          className={[
            'z-50 min-w-(--radix-select-trigger-width) overflow-hidden rounded-10',
            'border border-border bg-surface',
          ].join(' ')}
        >
          <RadixSelect.Viewport className="p-4">
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={option.value}
                className={[
                  'flex min-h-44 cursor-pointer items-center justify-between gap-12 rounded-6',
                  'px-12 py-8 text-16 text-text outline-none',
                  'data-[highlighted]:bg-surface-2',
                ].join(' ')}
              >
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                <RadixSelect.ItemIndicator>
                  <Check size={16} strokeWidth={1.5} aria-hidden="true" />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

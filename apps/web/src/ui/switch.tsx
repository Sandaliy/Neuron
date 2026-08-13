import * as RadixSwitch from '@radix-ui/react-switch';

/** A switch that reports its own state to assistive software through Radix. */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly label: string;
  readonly disabled?: boolean;
}) {
  return (
    <RadixSwitch.Root
      checked={checked}
      disabled={disabled}
      onCheckedChange={onChange}
      aria-label={label}
      className={[
        'relative h-24 w-44 shrink-0 rounded-full border transition-colors',
        'data-[state=checked]:border-accent data-[state=checked]:bg-accent',
        'data-[state=unchecked]:border-border data-[state=unchecked]:bg-surface-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
      ].join(' ')}
    >
      <RadixSwitch.Thumb
        className={[
          'block size-16 rounded-full bg-text transition-transform',
          'translate-x-4 data-[state=checked]:translate-x-24 data-[state=checked]:bg-accent-text',
        ].join(' ')}
      />
    </RadixSwitch.Root>
  );
}

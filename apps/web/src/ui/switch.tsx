import * as RadixSwitch from '@radix-ui/react-switch';

/**
 * A switch: a capsule and a white disc with a real shadow.
 *
 * No inner shading and no gradient. The disc is white in both themes because
 * that is what a switch knob is on every platform, and the only thing that
 * changes is the track behind it.
 *
 * The knob travels on `transform`, so the movement costs no layout. The spring
 * curve is the one place in the system it is used, and it is applied in the
 * stylesheet next to the disc's shadow.
 */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  id,
}: {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly label: string;
  readonly disabled?: boolean;
  readonly id?: string;
}) {
  return (
    <RadixSwitch.Root
      {...(id === undefined ? {} : { id })}
      checked={checked}
      disabled={disabled}
      onCheckedChange={onChange}
      aria-label={label}
      className={[
        'relative h-32 w-56 shrink-0 rounded-full transition-colors',
        'data-[state=checked]:bg-fill-accent data-[state=unchecked]:bg-switch-off',
        'disabled:cursor-not-allowed disabled:opacity-50',
      ].join(' ')}
    >
      <RadixSwitch.Thumb
        data-slot="switch-knob"
        className="absolute top-4 left-4 block size-24 rounded-full bg-white data-[state=checked]:translate-x-24"
      />
    </RadixSwitch.Root>
  );
}

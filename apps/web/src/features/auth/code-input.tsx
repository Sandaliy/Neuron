import { useEffect, useRef } from 'react';

import { Input } from '../../ui/input';

/**
 * The six digit field.
 *
 * One field rather than six boxes. Six boxes look neat and then fight the
 * phone: the software keyboard hides most of them, pasting the whole code puts
 * six characters in the first box, and a password manager cannot fill any of
 * them. One field takes a paste, takes an autofill from the one time code
 * hint, and submits itself the moment it is full.
 *
 * `onComplete` is optional, because submitting on the sixth digit is right only
 * where the code is the whole answer. Where it sits next to a password, or
 * where the action behind it deletes an account, the sixth digit is not consent
 * and the button is.
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  label,
  invalid = false,
  autoFocus = false,
  id,
  describedBy,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onComplete?: ((value: string) => void) | undefined;
  readonly label: string;
  readonly invalid?: boolean;
  readonly autoFocus?: boolean;
  readonly id?: string;
  readonly describedBy?: string | undefined;
}) {
  const completed = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (value.length === 6 && completed.current !== value) {
      completed.current = value;
      onComplete?.(value);
    }

    if (value.length < 6) {
      // Cleared, so the same code may be submitted again after a correction.
      completed.current = undefined;
    }
  }, [value, onComplete]);

  return (
    <Input
      id={id}
      aria-label={label}
      aria-describedby={describedBy}
      value={value}
      invalid={invalid}
      autoFocus={autoFocus}
      // `numeric` rather than `tel`: it puts a digit keypad in front of the
      // person without the phone offering to dial anything.
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="one-time-code"
      maxLength={6}
      // Anything that is not a digit is dropped rather than refused, so a code
      // pasted as "123 456" works instead of quietly failing.
      onChange={(event) => onChange(event.target.value.replaceAll(/\D/g, '').slice(0, 6))}
      className="text-center text-24 tracking-[0.4em] tabular-nums"
    />
  );
}

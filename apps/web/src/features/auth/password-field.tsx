import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';

import { MINIMUM_PASSWORD_LENGTH, passwordProblem } from '@neuron/shared';
import type { MessageKey } from '@neuron/shared';

import { useTranslate } from '../../i18n/provider';
import { FormField } from '../../ui/form-field';
import { Input } from '../../ui/input';

/**
 * A password field that says what is wrong before the server does.
 *
 * The rule comes from `packages/shared`, the same module the api enforces, so
 * the client cannot drift into promising something the server will refuse.
 *
 * It is deliberately quiet while somebody is still typing: a field that turns
 * red on the first character is a field that is wrong for as long as it takes
 * to type a good password. The judgement arrives when they leave the field, or
 * once the password is long enough to be judged fairly.
 */
const PROBLEM_KEYS: Record<string, MessageKey> = {
  too_short: 'auth.password.tooShort',
  too_long: 'auth.password.tooLong',
  too_common: 'auth.password.tooCommon',
};

export function PasswordField({
  value,
  onChange,
  label,
  autoComplete,
  checkStrength = false,
  error,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly label: string;
  readonly autoComplete: 'current-password' | 'new-password';
  /** Judge it as it is typed. On for a password being chosen, off for one being given. */
  readonly checkStrength?: boolean;
  readonly error?: string | undefined;
}) {
  const t = useTranslate();
  const [visible, setVisible] = useState(false);
  const [touched, setTouched] = useState(false);

  const problem = checkStrength && value.length > 0 ? passwordProblem(value) : undefined;
  const judged = touched || value.length >= MINIMUM_PASSWORD_LENGTH;
  const problemKey = problem && judged ? PROBLEM_KEYS[problem] : undefined;
  const shown = error ?? (problemKey ? t(problemKey) : undefined);

  return (
    <FormField
      label={label}
      hint={checkStrength ? t('auth.password.hint') : undefined}
      error={shown}
    >
      {(props) => (
        <div className="relative">
          <Input
            {...props}
            type={visible ? 'text' : 'password'}
            value={value}
            autoComplete={autoComplete}
            onChange={(event) => onChange(event.target.value)}
            onBlur={() => setTouched(true)}
            invalid={shown !== undefined}
            className="pr-48"
          />

          <button
            type="button"
            onClick={() => setVisible((current) => !current)}
            // The label is the action, not the state, so a screen reader hears
            // what pressing it will do.
            aria-label={visible ? t('auth.password.hide') : t('auth.password.show')}
            className="absolute inset-y-0 right-0 flex w-44 items-center justify-center text-text-dim hover:text-text"
          >
            {visible ? (
              <EyeOff size={20} strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <Eye size={20} strokeWidth={1.5} aria-hidden="true" />
            )}
          </button>
        </div>
      )}
    </FormField>
  );
}

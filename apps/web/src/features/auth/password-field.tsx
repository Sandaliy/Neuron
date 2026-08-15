import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';

import { MINIMUM_PASSWORD_LENGTH, passwordProblem, passwordStrength } from '@neuron/shared';
import type { MessageKey } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { FormField } from '../../ui/form-field';
import { Input } from '../../ui/input';
import { Progress } from '../../ui/progress';

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
 *
 * Once it is acceptable, the note underneath stops being a rule and becomes
 * advice: what the next improvement would be, named as one thing to do. It
 * never asks for a capital letter or a symbol, because that is the demand that
 * produces `Password1!` on a sticky note.
 */
const PROBLEM_KEYS: Record<string, MessageKey> = {
  too_short: 'auth.password.tooShort',
  too_long: 'auth.password.tooLong',
  too_common: 'auth.password.tooCommon',
};

const STRENGTH_KEYS: Record<string, MessageKey> = {
  fair: 'auth.password.strength.fair',
  good: 'auth.password.strength.good',
  strong: 'auth.password.strength.strong',
};

/*
 * How full the bar is at each verdict. Four steps rather than a continuous
 * measure of entropy, because the advice underneath has four things to say and
 * a bar that disagrees with the sentence next to it is worse than no bar.
 */
const STRENGTH_FILL: Record<string, number> = { short: 0.25, fair: 0.5, good: 0.75, strong: 1 };

export function PasswordField({
  value,
  onChange,
  label,
  autoComplete,
  checkStrength = false,
  error,
  note,
  hint,
  autoFocus,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly label: string;
  readonly autoComplete: 'current-password' | 'new-password';
  /** Judge it as it is typed. On for a password being chosen, off for one being given. */
  readonly checkStrength?: boolean;
  readonly error?: string | undefined;
  /** Something to say under the field that is not a fault. Used for the match. */
  readonly note?: string | undefined;
  /** Replaces the default hint. */
  readonly hint?: string | undefined;
  readonly autoFocus?: boolean;
}) {
  const t = useTranslate();
  const [visible, setVisible] = useState(false);
  const [touched, setTouched] = useState(false);

  const problem = checkStrength && value.length > 0 ? passwordProblem(value) : undefined;
  const judged = touched || value.length >= MINIMUM_PASSWORD_LENGTH;
  const problemKey = problem && judged ? PROBLEM_KEYS[problem] : undefined;
  const shown = error ?? (problemKey ? t(problemKey) : undefined);

  // Advice only once there is nothing wrong. While it is too short, the thing
  // to say is that it is too short.
  const advice =
    checkStrength && !shown && value.length > 0
      ? STRENGTH_KEYS[passwordStrength(value)]
      : undefined;

  const underneath =
    note ?? (advice ? t(advice) : (hint ?? (checkStrength ? t('auth.password.hint') : undefined)));

  const strength = checkStrength && value.length > 0 ? passwordStrength(value) : undefined;

  return (
    <FormField
      label={label}
      hint={underneath}
      error={shown}
      after={
        strength ? (
          <Progress
            label={label}
            value={STRENGTH_FILL[strength] ?? 0}
            tone={strength === 'short' ? 'error' : 'accent'}
          />
        ) : undefined
      }
    >
      {(props) => (
        <div className="relative">
          <Input
            {...props}
            type={visible ? 'text' : 'password'}
            value={value}
            autoComplete={autoComplete}
            autoFocus={autoFocus}
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
            className="absolute inset-y-0 right-0 flex w-44 items-center justify-center text-tertiary hover:text-primary"
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

import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { isAcceptablePassword } from '@neuron/shared';
import type { MessageKey } from '@neuron/shared';

import { useTranslate } from '../../i18n/provider';
import { describeAuthError, signUp } from '../../lib/auth-client';
import { Button } from '../../ui/button';
import { FormField } from '../../ui/form-field';
import { Input } from '../../ui/input';

import { AuthLayout } from './auth-layout';
import { PasswordField } from './password-field';
import { RecoveryCodes, heldCodes, holdCodes, releaseCodes } from './recovery-codes';

/**
 * Creating an account, and the screen that follows it.
 *
 * Registration answers with the ten recovery codes exactly once, so this
 * component does not navigate away when it succeeds. It swaps itself for the
 * codes and stays there until somebody says they have written them down.
 */
export function SignUpScreen() {
  const t = useTranslate();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{
    key: MessageKey;
    values: Record<string, string | number>;
  }>();
  // Restored on mount, so a reload in the middle of the codes screen comes
  // back to the codes rather than to an account nobody can recover.
  const [codes, setCodes] = useState<readonly string[] | undefined>(() => heldCodes());

  if (codes) {
    return (
      <div className="mx-auto w-full max-w-[520px] px-16 pt-[calc(var(--safe-top)+32px)] pb-[calc(var(--safe-bottom)+24px)]">
        <RecoveryCodes
          codes={codes}
          title={t('auth.recoveryCodes.title')}
          warningKey="auth.recoveryCodes.warning"
          onConfirmed={() => {
            setCodes(undefined);
            void navigate({ to: '/' });
          }}
        />
      </div>
    );
  }

  const submit = async () => {
    setError(undefined);
    setBusy(true);

    const answer = await signUp.email({
      email,
      password,
      // The api has no use for a display name and does not ask for one on this
      // screen. Better Auth requires the field, so it gets the address.
      name: email,
    });

    setBusy(false);

    if (answer.error) {
      setError(describeAuthError(answer.error));

      return;
    }

    const issued = readCodes(answer.data);

    if (issued) {
      holdCodes(issued);
      setCodes(issued);

      return;
    }

    /*
     * Registered, but the codes did not come back.
     *
     * Never silently continue: the account now exists with no recovery path
     * that anybody has seen. Settings can issue a fresh set, so that is where
     * this goes, rather than into the app as though nothing happened.
     */
    releaseCodes();
    void navigate({ to: '/settings' });
  };

  return (
    <AuthLayout
      title={t('auth.register.title')}
      subtitle={t('app.tagline')}
      footer={
        <Link to="/sign-in" className="text-accent underline underline-offset-4">
          {t('auth.register.haveAccount')}
        </Link>
      }
    >
      <form
        className="flex flex-col gap-16"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <FormField label={t('auth.email.label')}>
          {(props) => (
            <Input
              {...props}
              type="email"
              value={email}
              autoComplete="email"
              required
              onChange={(event) => setEmail(event.target.value)}
            />
          )}
        </FormField>

        <PasswordField
          label={t('auth.password.label')}
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          checkStrength
        />

        {error ? (
          <p role="alert" className="text-14 text-danger">
            {t(error.key, error.values)}
          </p>
        ) : undefined}

        <Button
          type="submit"
          variant="primary"
          full
          busy={busy}
          disabled={email.length === 0 || !isAcceptablePassword(password)}
        >
          {t('auth.register.submit')}
        </Button>
      </form>
    </AuthLayout>
  );
}

/**
 * Digs the recovery codes out of whatever registration answered with.
 *
 * Written defensively rather than typed, because the codes are added by
 * Neuron's own Better Auth plugin and do not appear in the client's inferred
 * response type. Losing them to a type mismatch would mean an account with no
 * way back into it.
 *
 * @param data the body registration answered with
 * @returns the codes, if they are in there
 */
function readCodes(data: unknown): readonly string[] | undefined {
  if (typeof data !== 'object' || data === null) {
    return undefined;
  }

  const value = (data as { recoveryCodes?: unknown }).recoveryCodes;

  return Array.isArray(value) && value.length > 0 && value.every((code) => typeof code === 'string')
    ? (value as string[])
    : undefined;
}

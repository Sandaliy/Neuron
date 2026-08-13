import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import type { MessageKey } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { describeAuthError, signIn } from '../../lib/auth-client';
import { Button } from '../../ui/button';
import { FormField } from '../../ui/form-field';
import { Input } from '../../ui/input';

import { AuthLayout } from './auth-layout';
import { PasswordField } from './password-field';

export function SignInScreen() {
  const t = useTranslate();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{
    key: MessageKey;
    values: Record<string, string | number>;
  }>();

  const submit = async () => {
    setError(undefined);
    setBusy(true);

    const answer = await signIn.email({ email, password });

    setBusy(false);

    if (answer.error) {
      setError(describeAuthError(answer.error));

      return;
    }

    /*
     * Two step sign in is on for this account.
     *
     * Better Auth has taken the password and is holding a half finished sign
     * in behind a cookie of its own. Nothing is signed in yet, so the account
     * query must not be asked, or it would answer 401 and bounce the person
     * back to this screen mid flow.
     */
    if ((answer.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
      void navigate({ to: '/two-factor' });

      return;
    }

    // The session changed, so everything read under the old one is stale.
    await queryClient.invalidateQueries();
    void navigate({ to: '/' });
  };

  return (
    <AuthLayout
      title={t('auth.signIn.title')}
      footer={
        <>
          <Link to="/recovery" className="text-accent underline underline-offset-4">
            {t('auth.signIn.forgot')}
          </Link>
          <Link to="/sign-up" className="text-text-dim underline underline-offset-4">
            {t('auth.signIn.noAccount')}
          </Link>
        </>
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
          autoComplete="current-password"
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
          disabled={email.length === 0 || password.length === 0}
        >
          {t('auth.signIn.submit')}
        </Button>
      </form>
    </AuthLayout>
  );
}

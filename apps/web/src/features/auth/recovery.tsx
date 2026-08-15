import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import {
  RECOVERY_CODE_LOW_WATERMARK,
  looksLikeRecoveryCode,
  normaliseRecoveryCode,
} from '@neuron/shared';
import type { MessageKey } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { authClient, describeAuthError } from '../../lib/auth-client';
import { Button } from '../../ui/button';
import { FormField } from '../../ui/form-field';
import { Input } from '../../ui/input';

import { AuthLayout } from './auth-layout';
import { PasswordField } from './password-field';

/**
 * Getting back in with one of the ten codes.
 *
 * The code is the whole credential, so spending one opens a session that may
 * do exactly one thing: choose a new password. That is why this screen has two
 * steps rather than sending anybody into the app after step one.
 */
export function RecoveryScreen() {
  const t = useTranslate();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{
    key: MessageKey;
    values: Record<string, string | number>;
  }>();

  const submit = async () => {
    setError(undefined);
    setBusy(true);

    const answer = await authClient.$fetch<{ remaining?: number }>('/recovery/sign-in', {
      method: 'POST',
      // Normalised here as well as on the server, so what is sent is what was
      // meant: the hyphens a person typed, or did not, decide nothing.
      body: { email, code: normaliseRecoveryCode(code) },
    });

    setBusy(false);

    if (answer.error) {
      setError(describeAuthError(answer.error));

      return;
    }

    const remaining = answer.data?.remaining;

    void navigate({
      to: '/recovery/password',
      search: remaining === undefined ? {} : { remaining },
    });
  };

  return (
    <AuthLayout
      title={t('auth.recovery.title')}
      subtitle={t('auth.recovery.hint')}
      footer={
        <Link to="/sign-in" className="text-tertiary underline underline-offset-4">
          {t('auth.signIn.title')}
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

        <FormField label={t('auth.recovery.title')}>
          {(props) => (
            <Input
              {...props}
              value={code}
              // The alphabet has no lookalikes in it, so anything typed can be
              // upper cased and stripped of its separators without ambiguity.
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              className="font-mono tracking-wide"
              placeholder="XXXXX-XXXXX-XXXXX"
            />
          )}
        </FormField>

        {error ? (
          <p role="alert" className="text-14 text-error">
            {t(error.key, error.values)}
          </p>
        ) : undefined}

        <Button
          type="submit"
          variant="primary"
          full
          busy={busy}
          disabled={email.length === 0 || !looksLikeRecoveryCode(normaliseRecoveryCode(code))}
        >
          {t('common.continue')}
        </Button>
      </form>
    </AuthLayout>
  );
}

/**
 * The second half: the new password the recovery session owes.
 *
 * Also the screen anybody holding a recovery session lands on if they try to
 * go anywhere else, because the api refuses everything else with
 * `password_change_required` until this is done.
 */
export function NewPasswordScreen({ remaining }: { readonly remaining?: number }) {
  const t = useTranslate();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{
    key: MessageKey;
    values: Record<string, string | number>;
  }>();

  const submit = async () => {
    setError(undefined);
    setBusy(true);

    const answer = await authClient.$fetch('/recovery/complete', {
      method: 'POST',
      body: { password },
    });

    setBusy(false);

    if (answer.error) {
      setError(describeAuthError(answer.error));

      return;
    }

    await queryClient.invalidateQueries();
    void navigate({ to: '/' });
  };

  const low = remaining !== undefined && remaining <= RECOVERY_CODE_LOW_WATERMARK;

  return (
    <AuthLayout
      title={t('auth.recovery.setPassword')}
      subtitle={t('auth.recovery.setPasswordHint')}
    >
      {remaining !== undefined ? (
        <p className={low ? 'text-14 text-warn' : 'text-14 text-tertiary'}>
          {low
            ? t('auth.recoveryCodes.low', { count: remaining })
            : t('auth.recoveryCodes.remaining', { count: remaining })}
        </p>
      ) : undefined}

      <form
        className="flex flex-col gap-16"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <PasswordField
          label={t('settings.newPassword')}
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          checkStrength
        />

        {error ? (
          <p role="alert" className="text-14 text-error">
            {t(error.key, error.values)}
          </p>
        ) : undefined}

        <Button type="submit" variant="primary" full busy={busy} disabled={password.length === 0}>
          {t('common.save')}
        </Button>
      </form>

      <p className="text-14 text-tertiary">{t('auth.recovery.signedOutElsewhere')}</p>
    </AuthLayout>
  );
}

import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useCallback, useState } from 'react';

import { looksLikeRecoveryCode, normaliseRecoveryCode } from '@neuron/shared';
import type { MessageKey } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { describeAuthError, twoFactor } from '../../lib/auth-client';
import { Button } from '../../ui/button';
import { FormField } from '../../ui/form-field';
import { Input } from '../../ui/input';

import { AuthLayout } from './auth-layout';
import { CodeInput } from './code-input';

/**
 * The second step of signing in.
 *
 * Reached only when Better Auth answered the password with `twoFactorRedirect`.
 * The password is already accepted and is being held behind a cookie of its
 * own, so nothing here asks for it again.
 *
 * The way out, for somebody standing in front of a phone they no longer have,
 * is one of the ten codes issued when they turned this on. It is on the same
 * screen rather than behind a link, because a person who has lost their phone
 * is not in the mood to go looking.
 */
export function TwoFactorScreen() {
  const t = useTranslate();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [backup, setBackup] = useState('');
  const [usingBackup, setUsingBackup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{
    key: MessageKey;
    values: Record<string, string | number>;
  }>();

  const finish = useCallback(async () => {
    await queryClient.invalidateQueries();
    void navigate({ to: '/' });
  }, [queryClient, navigate]);

  const submitCode = useCallback(
    async (value: string) => {
      setError(undefined);
      setBusy(true);

      const answer = await twoFactor.verifyTotp({ code: value });

      setBusy(false);

      if (answer.error) {
        setError(describeAuthError(answer.error));
        // Cleared so the next attempt is a fresh code rather than a correction
        // of the one the server has already refused.
        setCode('');

        return;
      }

      await finish();
    },
    [finish],
  );

  const submitBackup = async () => {
    setError(undefined);
    setBusy(true);

    const answer = await twoFactor.verifyBackupCode({ code: normaliseRecoveryCode(backup) });

    setBusy(false);

    if (answer.error) {
      setError(describeAuthError(answer.error));

      return;
    }

    await finish();
  };

  return (
    <AuthLayout
      title={t('auth.twoFactor.title')}
      subtitle={usingBackup ? t('auth.twoFactor.recoveryCodes.title') : t('auth.twoFactor.scan')}
      footer={
        <Link to="/sign-in" className="text-tertiary underline underline-offset-4">
          {t('auth.signIn.title')}
        </Link>
      }
    >
      {usingBackup ? (
        <form
          className="flex flex-col gap-16"
          onSubmit={(event) => {
            event.preventDefault();
            void submitBackup();
          }}
        >
          <FormField label={t('auth.twoFactor.recoveryCodes.title')}>
            {(props) => (
              <Input
                {...props}
                value={backup}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                className="font-mono tracking-wide"
                placeholder="XXXXX-XXXXX-XXXXX"
                onChange={(event) => setBackup(event.target.value.toUpperCase())}
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
            disabled={!looksLikeRecoveryCode(normaliseRecoveryCode(backup))}
          >
            {t('common.continue')}
          </Button>
        </form>
      ) : (
        <div className="flex flex-col gap-16">
          <CodeInput
            label={t('auth.twoFactor.codeLabel')}
            value={code}
            onChange={setCode}
            onComplete={(value) => void submitCode(value)}
            invalid={error !== undefined}
            autoFocus
          />

          {error ? (
            <p role="alert" className="text-14 text-error">
              {t(error.key, error.values)}
            </p>
          ) : undefined}

          <Button
            variant="primary"
            full
            busy={busy}
            disabled={code.length !== 6}
            onClick={() => void submitCode(code)}
          >
            {t('common.continue')}
          </Button>
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          setError(undefined);
          setUsingBackup((current) => !current);
        }}
        className="min-h-44 text-14 text-accent underline underline-offset-4"
      >
        {usingBackup ? t('auth.twoFactor.codeLabel') : t('auth.twoFactor.recoveryCodes.title')}
      </button>
    </AuthLayout>
  );
}

import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';

import type { MessageKey } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { describeAuthError, twoFactor } from '../../lib/auth-client';
import { Button } from '../../ui/button';
import { useToast } from '../../ui/toast';
import { CodeInput } from '../auth/code-input';
import { PasswordField } from '../auth/password-field';
import { RecoveryCodes, heldCodes, holdCodes } from '../auth/recovery-codes';

/**
 * Turning the second factor on, in three steps that cannot be skipped.
 *
 *   1. the password, because this issues a new set of codes
 *   2. the QR, and a code typed back from the app, which is what actually
 *      turns it on. A misread QR therefore locks nobody out: until the code
 *      comes back, the account is exactly as it was
 *   3. the ten codes for a lost phone, on the same undismissable screen the
 *      account codes use
 *
 * Step three is the one that matters. Without it, changing a phone is the same
 * as losing the account.
 */
type Step = 'password' | 'confirm' | 'codes';

export function TotpEnrollment({
  onDone,
  onCancel,
}: {
  readonly onDone: () => void;
  readonly onCancel: () => void;
}) {
  const t = useTranslate();
  const toast = useToast();
  const [step, setStep] = useState<Step>(() => (heldCodes() ? 'codes' : 'password'));
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [uri, setUri] = useState('');
  const [codes, setCodes] = useState<readonly string[]>(() => heldCodes() ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{
    key: MessageKey;
    values: Record<string, string | number>;
  }>();

  const start = async () => {
    setError(undefined);
    setBusy(true);

    const answer = await twoFactor.enable({ password });

    setBusy(false);

    if (answer.error) {
      setError(describeAuthError(answer.error));

      return;
    }

    setUri(answer.data.totpURI);
    // Held now rather than when they are shown, so a reload between the QR and
    // the confirmation does not take the lost phone codes with it.
    holdCodes(answer.data.backupCodes);
    setCodes(answer.data.backupCodes);
    setStep('confirm');
  };

  const confirm = async (value: string) => {
    setError(undefined);
    setBusy(true);

    const answer = await twoFactor.verifyTotp({ code: value });

    setBusy(false);

    if (answer.error) {
      setError(describeAuthError(answer.error));
      setCode('');

      return;
    }

    toast.show(t('auth.twoFactor.enabled'));
    setStep('codes');
  };

  if (step === 'codes') {
    return (
      <RecoveryCodes
        codes={codes}
        title={t('auth.twoFactor.recoveryCodes.title')}
        warningKey="auth.twoFactor.recoveryCodes.warning"
        onConfirmed={onDone}
      />
    );
  }

  if (step === 'confirm') {
    return (
      <div className="flex flex-col gap-16">
        <p className="text-16 text-text-dim">{t('auth.twoFactor.scan')}</p>

        {/*
          Drawn from the otpauth uri the server issued. White behind it always,
          in both themes: a camera reading a dark on dark code is a camera that
          reads nothing.
        */}
        <div className="mx-auto rounded-10 bg-white p-16">
          <QRCodeSVG value={uri} size={180} level="M" />
        </div>

        <details className="text-14 text-text-dim">
          <summary className="min-h-44 cursor-pointer py-12">
            {t('auth.twoFactor.secretLabel')}
          </summary>
          <code className="mt-8 block break-all rounded-6 bg-surface-2 p-12 font-mono text-14 text-text">
            {new URL(uri).searchParams.get('secret')}
          </code>
        </details>

        <p className="text-14 text-text-dim">{t('auth.twoFactor.confirmHint')}</p>

        <CodeInput
          label={t('auth.twoFactor.codeLabel')}
          value={code}
          onChange={setCode}
          onComplete={(value) => void confirm(value)}
          invalid={error !== undefined}
          autoFocus
        />

        {error ? (
          <p role="alert" className="text-14 text-danger">
            {t(error.key, error.values)}
          </p>
        ) : undefined}

        <Button
          variant="primary"
          full
          busy={busy}
          disabled={code.length !== 6}
          onClick={() => void confirm(code)}
        >
          {t('auth.twoFactor.enable')}
        </Button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-16"
      onSubmit={(event) => {
        event.preventDefault();
        void start();
      }}
    >
      <p className="text-16 text-text-dim">{t('auth.twoFactor.subtitle')}</p>

      <PasswordField
        label={t('auth.twoFactor.password')}
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
      />

      <p className="text-14 text-text-dim">{t('auth.twoFactor.passwordHint')}</p>

      {error ? (
        <p role="alert" className="text-14 text-danger">
          {t(error.key, error.values)}
        </p>
      ) : undefined}

      <div className="flex flex-col gap-12 sm:flex-row">
        <Button full onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant="primary" full busy={busy} disabled={password.length === 0}>
          {t('common.continue')}
        </Button>
      </div>
    </form>
  );
}

/** Turning it off, which costs the current password. */
export function TotpRemoval({ onDone }: { readonly onDone: () => void }) {
  const t = useTranslate();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{
    key: MessageKey;
    values: Record<string, string | number>;
  }>();

  const submit = async () => {
    setError(undefined);
    setBusy(true);

    const answer = await twoFactor.disable({ password });

    setBusy(false);

    if (answer.error) {
      setError(describeAuthError(answer.error));

      return;
    }

    toast.show(t('auth.twoFactor.disabled'));
    onDone();
  };

  return (
    <form
      className="flex flex-col gap-16"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <PasswordField
        label={t('auth.twoFactor.password')}
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
      />

      {error ? (
        <p role="alert" className="text-14 text-danger">
          {t(error.key, error.values)}
        </p>
      ) : undefined}

      <Button type="submit" variant="danger" full busy={busy} disabled={password.length === 0}>
        {t('auth.twoFactor.disable')}
      </Button>
    </form>
  );
}

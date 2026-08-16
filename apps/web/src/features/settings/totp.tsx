import { ChevronDown, ChevronUp } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useId, useState } from 'react';

import type { MessageKey } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { authClient, describeAuthError, twoFactor } from '../../lib/auth-client';
import { Button } from '../../ui/button';
import { DIALOG_FORM, DialogBody, DialogFooter } from '../../ui/dialog';
import { useToast } from '../../ui/toast';
import { CodeInput } from '../auth/code-input';
import { PasswordField } from '../auth/password-field';
import { RecoveryCodes, holdCodes, releaseCodes } from '../auth/recovery-codes';

/**
 * Turning the second factor on, in four steps that cannot be skipped.
 *
 *   1. the password, because this issues a new set of codes
 *   2. the QR, and the setup key for a camera that will not read it
 *   3. a code typed back from the app, which is what actually turns it on. A
 *      misread QR therefore locks nobody out: until the code comes back, the
 *      account is exactly as it was
 *   4. the ten codes for a lost phone, on the same undismissable screen the
 *      account codes use
 *
 * Two and three used to be one step, and that step did not fit on a phone. The
 * QR is 212 pixels with its quiet zone, the setup key is a row under it, and
 * the field for the code needs the keyboard, which takes another 336: the
 * button was below the fold, and every tap that opened or closed the keyboard
 * resized the box the whole thing was scrolling in and threw the scroll back to
 * the top. Split, each step is measured against the middle of the screen and
 * both fit whole, keyboard and all.
 *
 * Nothing is lost by splitting them. The QR has already been read by the time
 * the code is typed, and Back is there for the case where it has not.
 *
 * Step four is the one that matters. Without it, changing a phone is the same
 * as losing the account.
 */
type Step = 'password' | 'scan' | 'confirm' | 'codes';

export function TotpEnrollment({
  onDone,
  onCancel,
}: {
  readonly onDone: () => void;
  readonly onCancel: () => void;
}) {
  const t = useTranslate();
  const toast = useToast();
  const [step, setStep] = useState<Step>('password');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [uri, setUri] = useState('');
  const [codes, setCodes] = useState<readonly string[]>([]);
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
    /*
     * Kept in state and not put aside yet.
     *
     * They used to be held the moment the server issued them, so a reload could
     * come back to them. What that actually did was strand anybody who closed
     * the dialog at the QR: the codes were held, the next open resumed at the
     * screen that shows them, and that screen cannot be dismissed. The second
     * factor was not even on. Nothing is held until the code from the app has
     * come back and the second factor is really enabled.
     */
    setCodes(answer.data.backupCodes);
    setStep('scan');
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

    // On now, so the codes matter and a reload must come back to them.
    holdCodes(codes, 'two-factor');
    toast.show(t('auth.twoFactor.enabled'));
    setStep('codes');
  };

  if (step === 'codes') {
    return (
      <RecoveryCodes
        codes={codes}
        title={t('auth.twoFactor.recoveryCodes.title')}
        scope="two-factor"
        warningKey="auth.twoFactor.recoveryCodes.warning"
        onConfirmed={onDone}
      />
    );
  }

  if (step === 'scan') {
    return (
      <div className={DIALOG_FORM}>
        <DialogBody>
          <p className="text-14 leading-body text-secondary">{t('auth.twoFactor.scan')}</p>

          {/*
            Drawn from the otpauth uri the server issued. White behind it always,
            in both themes: a camera reading a dark on dark code is a camera that
            reads nothing.
          */}
          <div className="mx-auto rounded-12 bg-white p-16">
            <QRCodeSVG value={uri} size={168} level="M" />
          </div>

          <ManualKey uri={uri} />
        </DialogBody>

        <DialogFooter>
          <Button variant="primary" full onClick={() => setStep('confirm')}>
            {t('auth.twoFactor.scanDone')}
          </Button>
          <Button variant="text" full onClick={() => setStep('password')}>
            {t('common.back')}
          </Button>
        </DialogFooter>
      </div>
    );
  }

  if (step === 'confirm') {
    return (
      <div className={DIALOG_FORM}>
        <DialogBody>
          <p className="text-14 leading-body text-secondary">{t('auth.twoFactor.confirmHint')}</p>

          <CodeInput
            label={t('auth.twoFactor.codeLabel')}
            value={code}
            onChange={setCode}
            onComplete={(value) => void confirm(value)}
            invalid={error !== undefined}
          />

          {error ? (
            <p role="alert" className="text-14 text-error">
              {t(error.key, error.values)}
            </p>
          ) : undefined}
        </DialogBody>

        <DialogFooter>
          <Button
            variant="primary"
            full
            busy={busy}
            disabled={code.length !== 6}
            onClick={() => void confirm(code)}
          >
            {t('auth.twoFactor.enable')}
          </Button>
          <Button variant="text" full onClick={() => setStep('scan')}>
            {t('common.back')}
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <form
      className={DIALOG_FORM}
      onSubmit={(event) => {
        event.preventDefault();
        void start();
      }}
    >
      <DialogBody>
        <p className="text-14 leading-body text-secondary">{t('auth.twoFactor.subtitle')}</p>

        <PasswordField
          label={t('auth.twoFactor.password')}
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />

        {error ? (
          <p role="alert" className="text-14 text-error">
            {t(error.key, error.values)}
          </p>
        ) : undefined}
      </DialogBody>

      <DialogFooter>
        <Button type="submit" variant="primary" full busy={busy} disabled={password.length === 0}>
          {t('common.continue')}
        </Button>
        <Button
          variant="text"
          full
          onClick={() => {
            releaseCodes('two-factor');
            onCancel();
          }}
        >
          {t('common.cancel')}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * The setup key, for a camera that will not read the code.
 *
 * A `details` element with the default triangle was the whole disclosure
 * before, and a triangle next to a sentence does not read as something to
 * press. This is a button that says whether it is open, and what is inside it
 * says where the key goes rather than leaving somebody to guess which field of
 * their authenticator app it belongs in.
 */
function ManualKey({ uri }: { readonly uri: string }) {
  const t = useTranslate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const secret = new URL(uri).searchParams.get('secret') ?? '';

  return (
    <div className="flex flex-col gap-8">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-44 items-center justify-between gap-8 rounded-12 border border-subtle px-12 text-left text-14 text-primary"
      >
        {t('auth.twoFactor.manualTitle')}
        {open ? (
          <ChevronUp size={20} strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <ChevronDown size={20} strokeWidth={1.5} aria-hidden="true" />
        )}
      </button>

      {open ? (
        <div id={panelId} className="flex flex-col gap-12">
          <p className="text-14 text-tertiary">{t('auth.twoFactor.manualHint')}</p>

          {/*
            Read only rather than plain text: it can be selected, dragged and
            long pressed on a phone, which is how somebody without a working
            clipboard button gets it out.
          */}
          <input
            readOnly
            value={secret}
            aria-label={t('auth.twoFactor.manualTitle')}
            onFocus={(event) => event.target.select()}
            className="min-h-44 w-full rounded-12 border border-subtle bg-raised px-12 font-mono text-15 tracking-wide text-primary"
          />

          <Button
            full
            onClick={() => {
              void navigator.clipboard
                .writeText(secret)
                .then(() => toast.show(t('auth.twoFactor.secretCopied')));
            }}
          >
            {t('auth.twoFactor.secretCopy')}
          </Button>
        </div>
      ) : undefined}
    </div>
  );
}

/**
 * Turning it off, which costs the current password and a code from the app.
 *
 * The password alone was the wrong price. What is being removed is the
 * protection against somebody who already has the password, so a password is
 * exactly the credential that must not be enough on its own here. Whoever is
 * entitled to turn it off is holding the phone, and proving that is one glance
 * at the app.
 *
 * Both are sent together, to `/two-factor/disable`, where the guard in
 * `apps/api/src/auth/plugin.ts` checks the code and spends it before Better
 * Auth disables anything.
 */
export function TotpRemoval({ onDone }: { readonly onDone: () => void }) {
  const t = useTranslate();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{
    key: MessageKey;
    values: Record<string, string | number>;
  }>();

  const submit = async () => {
    setError(undefined);
    setBusy(true);

    const answer = await authClient.$fetch<{ status: boolean }>('/two-factor/disable', {
      method: 'POST',
      body: { password, code },
    });

    setBusy(false);

    if (answer.error) {
      setError(describeAuthError(answer.error));
      setCode('');

      return;
    }

    toast.show(t('auth.twoFactor.disabled'));
    onDone();
  };

  return (
    <form
      className={DIALOG_FORM}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <DialogBody>
        <PasswordField
          label={t('auth.twoFactor.password')}
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />

        <CodeInput
          label={t('auth.twoFactor.codeLabel')}
          value={code}
          onChange={setCode}
          invalid={error !== undefined}
        />

        <p className="text-13 leading-snug text-tertiary">{t('auth.twoFactor.disableHint')}</p>

        {error ? (
          <p role="alert" className="text-14 text-error">
            {t(error.key, error.values)}
          </p>
        ) : undefined}
      </DialogBody>

      <DialogFooter>
        <Button
          type="submit"
          variant="destructive"
          full
          busy={busy}
          disabled={password.length === 0 || code.length !== 6}
        >
          {t('auth.twoFactor.disable')}
        </Button>
      </DialogFooter>
    </form>
  );
}

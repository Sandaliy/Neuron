import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { LOCALES, THEMES, isAcceptablePassword } from '@neuron/shared';
import type { Locale, MessageKey, Theme } from '@neuron/shared';

import { useLocale, useTranslate } from '../../i18n/locale';
import { useAccount } from '../../lib/account';
import { describe, request } from '../../lib/api';
import { authClient, changePassword, describeAuthError, signOut } from '../../lib/auth-client';
import { useTheme } from '../../theme/use-theme';
import { Button } from '../../ui/button';
import { Dialog } from '../../ui/dialog';
import { FormField } from '../../ui/form-field';
import { Input } from '../../ui/input';
import { Segmented } from '../../ui/segmented';
import { SkeletonRows } from '../../ui/states';
import { useToast } from '../../ui/toast';
import { PasswordField } from '../auth/password-field';
import { RecoveryCodes } from '../auth/recovery-codes';

import { TotpEnrollment, TotpRemoval } from './totp';

import type { ReactNode } from 'react';

/**
 * Everything a person can change about their account.
 *
 * Grouped by what it costs to get wrong: how it looks, then how it is
 * protected, then leaving. The dangerous parts are last and behind a dialog,
 * because a phone screen is a small place to put an irreversible button.
 */
export function SettingsScreen() {
  const t = useTranslate();
  const account = useAccount();

  return (
    <section className="flex flex-col gap-32 py-16">
      <h1 className="text-24 font-semibold text-text">{t('settings.title')}</h1>

      {account.isPending ? <SkeletonRows rows={6} /> : undefined}

      {account.data ? (
        <>
          <Appearance />
          <Security />
          <Account email={account.data.email} />
        </>
      ) : undefined}
    </section>
  );
}

function Group({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-16">
      <h2 className="text-14 font-semibold tracking-wide text-text-dim uppercase">{title}</h2>
      <div className="flex flex-col gap-16 rounded-14 border border-border bg-surface p-16">
        {children}
      </div>
    </div>
  );
}

/**
 * Theme and language.
 *
 * Both belong to the device. The switch writes local storage and the document
 * synchronously, then tells the account row in the background without anything
 * on screen waiting for the answer. Switching the theme with the network off
 * works exactly as it does with the network on.
 */
function Appearance() {
  const t = useTranslate();
  const { theme, setTheme } = useTheme();
  const { locale, setLocale } = useLocale();

  const themeLabels: Record<Theme, string> = {
    system: t('settings.theme.system'),
    light: t('settings.theme.light'),
    dark: t('settings.theme.dark'),
  };

  // The name of a language is written in that language. A Russian speaker
  // hunting for their language should not have to read the word "Russian".
  const localeLabels: Record<Locale, string> = { en: 'English', ru: 'Русский' };

  return (
    <Group title={t('settings.appearance')}>
      <div className="flex flex-col gap-8">
        <p className="text-14 text-text-dim">{t('settings.theme')}</p>
        <Segmented
          label={t('settings.theme')}
          value={theme}
          onChange={setTheme}
          options={THEMES.map((value) => ({ value, label: themeLabels[value] }))}
        />
      </div>

      <div className="flex flex-col gap-8">
        <p className="text-14 text-text-dim">{t('settings.language')}</p>
        <Segmented
          label={t('settings.language')}
          value={locale}
          onChange={setLocale}
          options={LOCALES.map((value) => ({ value, label: localeLabels[value] }))}
        />
      </div>
    </Group>
  );
}

function Security() {
  const t = useTranslate();
  const toast = useToast();
  const [panel, setPanel] = useState<'password' | 'codes' | 'totp-on' | 'totp-off' | undefined>();
  const [issued, setIssued] = useState<readonly string[]>();

  return (
    <Group title={t('settings.security')}>
      <Button full onClick={() => setPanel('password')}>
        {t('settings.changePassword')}
      </Button>

      <Button full onClick={() => setPanel('codes')}>
        {t('auth.recoveryCodes.regenerate')}
      </Button>

      <Button full onClick={() => setPanel('totp-on')}>
        {t('auth.twoFactor.title')}
      </Button>

      <Button variant="danger" full onClick={() => setPanel('totp-off')}>
        {t('auth.twoFactor.disable')}
      </Button>

      <Dialog
        open={panel === 'password'}
        onOpenChange={(open) => !open && setPanel(undefined)}
        title={t('settings.changePassword')}
      >
        <ChangePassword
          onDone={() => {
            toast.show(t('settings.passwordChanged'));
            setPanel(undefined);
          }}
        />
      </Dialog>

      <Dialog
        open={panel === 'codes'}
        // Once the codes are on screen this dialog stops being dismissable, for
        // the same reason the registration screen is not: they are shown once.
        onOpenChange={(open) => !open && setPanel(undefined)}
        dismissable={issued === undefined}
        title={t('auth.recoveryCodes.title')}
        description={issued ? undefined : t('auth.recoveryCodes.regenerateWarning')}
      >
        {issued ? (
          <RecoveryCodes
            codes={issued}
            title={t('auth.recoveryCodes.title')}
            warningKey="auth.recoveryCodes.warning"
            onConfirmed={() => {
              setIssued(undefined);
              setPanel(undefined);
            }}
          />
        ) : (
          <RegenerateCodes onIssued={setIssued} />
        )}
      </Dialog>

      <Dialog
        open={panel === 'totp-on'}
        onOpenChange={(open) => !open && setPanel(undefined)}
        title={t('auth.twoFactor.title')}
      >
        <TotpEnrollment onDone={() => setPanel(undefined)} onCancel={() => setPanel(undefined)} />
      </Dialog>

      <Dialog
        open={panel === 'totp-off'}
        onOpenChange={(open) => !open && setPanel(undefined)}
        title={t('auth.twoFactor.disable')}
      >
        <TotpRemoval onDone={() => setPanel(undefined)} />
      </Dialog>
    </Group>
  );
}

function ChangePassword({ onDone }: { readonly onDone: () => void }) {
  const t = useTranslate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{
    key: MessageKey;
    values: Record<string, string | number>;
  }>();

  const submit = async () => {
    setError(undefined);
    setBusy(true);

    const answer = await changePassword({
      currentPassword: current,
      newPassword: next,
      // Every other session goes. A password is usually changed because
      // somebody suspects one of those sessions is not theirs.
      revokeOtherSessions: true,
    });

    setBusy(false);

    if (answer.error) {
      setError(describeAuthError(answer.error));

      return;
    }

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
        label={t('settings.currentPassword')}
        value={current}
        onChange={setCurrent}
        autoComplete="current-password"
      />

      <PasswordField
        label={t('settings.newPassword')}
        value={next}
        onChange={setNext}
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
        disabled={current.length === 0 || !isAcceptablePassword(next)}
      >
        {t('common.save')}
      </Button>
    </form>
  );
}

function RegenerateCodes({ onIssued }: { readonly onIssued: (codes: readonly string[]) => void }) {
  const t = useTranslate();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{
    key: MessageKey;
    values: Record<string, string | number>;
  }>();

  const submit = async () => {
    setError(undefined);
    setBusy(true);

    const answer = await authClient.$fetch<{ recoveryCodes: string[] }>('/recovery/regenerate', {
      method: 'POST',
      body: { password },
    });

    setBusy(false);

    if (answer.error) {
      setError(describeAuthError(answer.error));

      return;
    }

    if (answer.data?.recoveryCodes) {
      onIssued(answer.data.recoveryCodes);
    }
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

      <Button type="submit" variant="primary" full busy={busy} disabled={password.length === 0}>
        {t('auth.recoveryCodes.regenerate')}
      </Button>
    </form>
  );
}

function Account({ email }: { readonly email: string }) {
  const t = useTranslate();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [leaving, setLeaving] = useState(false);

  return (
    <Group title={t('settings.account')}>
      <p className="text-16 text-text-dim break-all">{email}</p>

      <Button
        full
        onClick={() => {
          void signOut().then(async () => {
            // Cleared rather than invalidated: nothing read under that session
            // may be shown to whoever signs in next on this device.
            queryClient.clear();
            await navigate({ to: '/sign-in' });
          });
        }}
      >
        {t('common.signOut')}
      </Button>

      <Button variant="danger" full onClick={() => setLeaving(true)}>
        {t('settings.deleteAccount')}
      </Button>

      <Dialog
        open={leaving}
        onOpenChange={setLeaving}
        title={t('settings.deleteAccount')}
        description={t('settings.deleteAccountWarning')}
      >
        <DeleteAccount />
      </Dialog>
    </Group>
  );
}

/**
 * Leaving, behind a phrase that has to be typed.
 *
 * The phrase is the literal string the api demands, in English in both
 * languages, because it is a value on the wire and not a sentence. It is shown
 * on screen to be copied rather than remembered.
 */
function DeleteAccount() {
  const t = useTranslate();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const phrase = t('settings.deleteAccountPhrase');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{
    key: MessageKey;
    values: Record<string, string | number>;
  }>();

  const submit = async () => {
    setError(undefined);
    setBusy(true);

    try {
      await request('/account', { method: 'DELETE', body: { confirm: phrase } });

      queryClient.clear();
      toast.show(t('settings.deleted'));
      await navigate({ to: '/sign-in' });
    } catch (failure) {
      setError(describe(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-16"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <FormField label={t('settings.deleteAccountConfirm')} hint={phrase}>
        {(props) => (
          <Input
            {...props}
            value={typed}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(event) => setTyped(event.target.value)}
          />
        )}
      </FormField>

      {error ? (
        <p role="alert" className="text-14 text-danger">
          {t(error.key, error.values)}
        </p>
      ) : undefined}

      <Button type="submit" variant="danger" full busy={busy} disabled={typed !== phrase}>
        {t('settings.deleteAccount')}
      </Button>
    </form>
  );
}

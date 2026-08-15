import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { LOCALES, THEMES, isAcceptablePassword } from '@neuron/shared';
import type { Locale, MessageKey, Theme } from '@neuron/shared';

import { useLocale, useTranslate } from '../../i18n/locale';
import { useAccount } from '../../lib/account';
import { describe, request } from '../../lib/api';
import { authClient, changePassword, describeAuthError, signOut } from '../../lib/auth-client';
import { GLASS_LEVELS, useGlass } from '../../preferences/glass';
import { useMotion } from '../../preferences/motion';
import { useTheme } from '../../theme/use-theme';
import { Button } from '../../ui/button';
import { Card, GroupLabel, RowGroup } from '../../ui/card';
import { Dialog } from '../../ui/dialog';
import { FormField } from '../../ui/form-field';
import { Input } from '../../ui/input';
import { Row, RowChevron } from '../../ui/row';
import { Segmented } from '../../ui/segmented';
import { SkeletonRows } from '../../ui/states';
import { Switch } from '../../ui/switch';
import { useToast } from '../../ui/toast';
import { PasswordField } from '../auth/password-field';
import { RecoveryCodes } from '../auth/recovery-codes';

import { TotpEnrollment, TotpRemoval } from './totp';

import type { GlassLevel } from '../../preferences/glass';
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
    <section className="flex flex-col gap-32">
      <h1 className="font-display text-24 tracking-tight text-primary">{t('settings.title')}</h1>

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
    <div className="flex flex-col gap-12">
      <GroupLabel>{title}</GroupLabel>
      {children}
    </div>
  );
}

/** A label over a control, with the sentence that explains it underneath. */
function Setting({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-8">
      <span className="text-13 font-semibold text-secondary">{label}</span>
      {children}
      {hint ? <span className="text-13 leading-snug text-tertiary">{hint}</span> : undefined}
    </div>
  );
}

/**
 * The theme, the glass, the movement and the language.
 *
 * All four belong to the device. The control writes local storage and the
 * document synchronously, then tells the account row in the background without
 * anything on screen waiting for the answer. Switching the theme with the
 * network off works exactly as it does with the network on.
 *
 * The glass and the movement never reach the account at all. A phone and a
 * laptop have different reasons for their answer, and the whole point of the
 * glass control is a phone that cannot keep up with the laptop's choice.
 */
function Appearance() {
  const t = useTranslate();
  const { theme, setTheme } = useTheme();
  const { locale, setLocale } = useLocale();
  const { glass, capReason, setGlass } = useGlass();
  const { motion, setMotion } = useMotion();

  const themeLabels: Record<Theme, string> = {
    system: t('settings.theme.system'),
    light: t('settings.theme.light'),
    dark: t('settings.theme.dark'),
  };

  const glassLabels: Record<GlassLevel, string> = {
    off: t('settings.glass.off'),
    subtle: t('settings.glass.subtle'),
    full: t('settings.glass.full'),
  };

  // The name of a language is written in that language. A Russian speaker
  // hunting for their language should not have to read the word "Russian".
  const localeLabels: Record<Locale, string> = { en: 'English', ru: 'Русский' };

  return (
    <Group title={t('settings.appearance')}>
      <Card className="flex flex-col gap-20">
        <Setting label={t('settings.theme')}>
          <Segmented
            label={t('settings.theme')}
            value={theme}
            onChange={setTheme}
            options={THEMES.map((value) => ({ value, label: themeLabels[value] }))}
          />
        </Setting>

        {/*
          The setting ships to the person, not only to us. A phone that stutters
          is not a phone anybody can detect, so whoever feels it gets the
          switch. When the device has already lowered it on its own, the panel
          says so in plain words rather than quietly disagreeing with the
          control.
        */}
        <Setting
          label={t('settings.glass')}
          hint={capReason ? t(`settings.glassCapped.${capReason}`) : t('settings.glassHint')}
        >
          <Segmented
            label={t('settings.glass')}
            value={glass}
            onChange={setGlass}
            options={GLASS_LEVELS.map((value) => ({ value, label: glassLabels[value] }))}
          />
        </Setting>

        <div className="flex items-center justify-between gap-16">
          <div className="flex flex-col gap-4">
            <span className="text-13 font-semibold text-secondary">{t('settings.motion')}</span>
            <span className="text-13 leading-snug text-tertiary">{t('settings.motionHint')}</span>
          </div>

          <Switch
            label={t('settings.motion')}
            checked={motion === 'reduce'}
            onChange={(on) => setMotion(on ? 'reduce' : 'system')}
          />
        </div>
      </Card>

      <Card>
        <Setting label={t('settings.language')}>
          <Segmented
            label={t('settings.language')}
            value={locale}
            onChange={setLocale}
            options={LOCALES.map((value) => ({ value, label: localeLabels[value] }))}
          />
        </Setting>
      </Card>
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
      {/*
        Each label names the thing it changes, not just the verb. "Turn off" on
        its own was in a list of four security controls and said nothing about
        which of them it turned off.
      */}
      <RowGroup>
        <Row
          standalone={false}
          title={t('settings.changePasswordAction')}
          trailing={<RowChevron />}
          onClick={() => setPanel('password')}
        />
        <Row
          standalone={false}
          title={t('settings.regenerateAction')}
          trailing={<RowChevron />}
          onClick={() => setPanel('codes')}
        />
        <Row
          standalone={false}
          title={t('auth.twoFactor.setUp')}
          trailing={<RowChevron />}
          onClick={() => setPanel('totp-on')}
        />
        <Row
          standalone={false}
          title={<span className="text-error">{t('auth.twoFactor.disable')}</span>}
          trailing={<RowChevron />}
          onClick={() => setPanel('totp-off')}
        />
      </RowGroup>

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
        <p role="alert" className="text-13 text-error">
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
        <p role="alert" className="text-13 text-error">
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
      <RowGroup>
        <Row
          standalone={false}
          title={t('auth.email.label')}
          trailing={<span className="max-w-[55%] truncate text-13 text-tertiary">{email}</span>}
        />

        <Row
          standalone={false}
          title={t('common.signOut')}
          trailing={<RowChevron />}
          onClick={() => {
            void signOut().then(async () => {
              // Cleared rather than invalidated: nothing read under that
              // session may be shown to whoever signs in next on this device.
              queryClient.clear();
              await navigate({ to: '/sign-in' });
            });
          }}
        />

        <Row
          standalone={false}
          title={<span className="text-error">{t('settings.deleteAccountAction')}</span>}
          trailing={<RowChevron />}
          onClick={() => setLeaving(true)}
        />
      </RowGroup>

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
        <p role="alert" className="text-13 text-error">
          {t(error.key, error.values)}
        </p>
      ) : undefined}

      <Button type="submit" variant="destructive" full busy={busy} disabled={typed !== phrase}>
        {t('settings.deleteAccount')}
      </Button>
    </form>
  );
}

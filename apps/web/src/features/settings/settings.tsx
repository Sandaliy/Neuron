import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { LOCALES, THEMES, isAcceptablePassword } from '@neuron/shared';
import type { Locale, MessageKey, Theme } from '@neuron/shared';

import { useLocale, useTranslate } from '../../i18n/locale';
import { ACCOUNT_KEY, useAccount } from '../../lib/account';
import { describe, request } from '../../lib/api';
import { authClient, changePassword, describeAuthError, signOut } from '../../lib/auth-client';
import { GLASS_LEVELS, GLASS_SCOPES, useGlass } from '../../preferences/glass';
import { useMotion } from '../../preferences/motion';
import { useTheme } from '../../theme/use-theme';
import { Button } from '../../ui/button';
import { Card, GroupLabel, RowGroup } from '../../ui/card';
import { DIALOG_FORM, Dialog, DialogBody, DialogFooter } from '../../ui/dialog';
import { Row, RowChevron } from '../../ui/row';
import { Segmented } from '../../ui/segmented';
import { SkeletonRows } from '../../ui/states';
import { Switch } from '../../ui/switch';
import { useToast } from '../../ui/toast';
import { CodeInput } from '../auth/code-input';
import { PasswordField } from '../auth/password-field';
import { RecoveryCodes, heldCodes, releaseCodes } from '../auth/recovery-codes';

import { TotpEnrollment, TotpRemoval } from './totp';

import type { GlassLevel, GlassScope } from '../../preferences/glass';
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
    <section data-screen="" className="flex flex-col gap-32">
      <h1 className="font-display text-24 tracking-tight text-primary">{t('settings.title')}</h1>

      {account.isPending ? <SkeletonRows rows={6} /> : undefined}

      {account.data ? (
        <>
          <Appearance />
          <Security />
          <Account
            email={account.data.email}
            twoFactorOn={account.data.twoFactorEnabled === true}
          />
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
  const { glass, effective, capReason, scope, setGlass, setGlassScope } = useGlass();
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

  const scopeLabels: Record<GlassScope, string> = {
    floating: t('settings.glassScope.floating'),
    all: t('settings.glassScope.all'),
  };

  // With the effect off the scope choice has nothing to act on. The group says
  // so and dims rather than disappearing: a control that vanishes teaches
  // nobody why it went.
  const scopeIdle = effective === 'off';

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
          {...(capReason ? { hint: t(`settings.glassCapped.${capReason}`) } : {})}
        >
          <Segmented
            label={t('settings.glass')}
            value={glass}
            onChange={setGlass}
            options={GLASS_LEVELS.map((value) => ({ value, label: glassLabels[value] }))}
          />
        </Setting>

        <Setting
          label={t('settings.glassScope')}
          {...(scopeIdle ? { hint: t('settings.glassScopeOff') } : {})}
        >
          <Segmented
            label={t('settings.glassScope')}
            value={scope}
            onChange={setGlassScope}
            disabled={scopeIdle}
            options={GLASS_SCOPES.map((value) => ({ value, label: scopeLabels[value] }))}
          />
        </Setting>

        {/*
          Named for what it turns on, not for what it takes away, so the switch
          reads the way every other switch in the interface does: on is the
          thing happening. It was "Less movement", where on meant off.
        */}
        <div className="flex items-center justify-between gap-16">
          <span className="text-13 font-semibold text-secondary">{t('settings.motion')}</span>

          <Switch
            label={t('settings.motion')}
            checked={motion !== 'reduce'}
            onChange={(on) => setMotion(on ? 'system' : 'reduce')}
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
  const queries = useQueryClient();
  const account = useAccount();
  const [panel, setPanel] = useState<'password' | 'codes' | 'totp-on' | 'totp-off' | undefined>();
  const [issued, setIssued] = useState<readonly string[]>();
  /*
   * The lost phone codes a previous page load was showing.
   *
   * Read once, on mount. They are only ever put aside after the second factor
   * is really on, so if the account says it is off they belong to an enrollment
   * that was abandoned and they are thrown away. Without that, closing the
   * dialog at the QR left a set of codes that reopened an undismissable screen
   * on every load, for a second factor that had never been turned on.
   */
  const [pendingCodes] = useState<readonly string[] | undefined>(() => heldCodes('two-factor'));
  const [pendingSeen, setPendingSeen] = useState(false);

  /*
   * Which of the two second factor controls is offered.
   *
   * Exactly one of them, ever. Both were drawn whatever the state of the
   * account, so somebody who had never set up a second factor was offered a row
   * for turning it off, which is a question with no answer. The account says
   * which one applies, and it is refetched after either one runs so the list
   * changes in front of the person who changed it.
   */
  const twoFactorOn = account.data?.twoFactorEnabled === true;

  // Thrown away rather than shown. The dialog below never opens for them, since
  // it asks for the second factor to be on, so this only tidies the storage.
  useEffect(() => {
    if (pendingCodes && account.data && !twoFactorOn) {
      releaseCodes('two-factor');
    }
  }, [pendingCodes, account.data, twoFactorOn]);

  const forgetAccount = () => {
    void queries.invalidateQueries({ queryKey: ACCOUNT_KEY });
  };

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
        {/*
          One row, named for the thing and not for the verb, with the state
          underneath. It was two rows, "Set up two-factor authentication" and a
          red "Turn off 2FA", which made a setting read as an action and put the
          answer to "is it on?" in the label rather than in the state.
        */}
        <Row
          standalone={false}
          title={t('auth.twoFactor.title')}
          subtitle={twoFactorOn ? t('auth.twoFactor.on') : t('auth.twoFactor.off')}
          trailing={<RowChevron />}
          onClick={() => setPanel(twoFactorOn ? 'totp-off' : 'totp-on')}
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
            scope="account"
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
        <TotpEnrollment
          onDone={() => {
            forgetAccount();
            setPanel(undefined);
          }}
          onCancel={() => setPanel(undefined)}
        />
      </Dialog>

      {/*
        The codes an enrollment showed before the page was reloaded. Shown again
        rather than lost: they are the only way back in from a lost phone, and
        they cannot be reissued without turning the second factor off first.
      */}
      <Dialog
        open={pendingCodes !== undefined && twoFactorOn && !pendingSeen}
        dismissable={false}
        title={t('auth.twoFactor.recoveryCodes.title')}
      >
        {pendingCodes ? (
          <RecoveryCodes
            codes={pendingCodes}
            scope="two-factor"
            warningKey="auth.twoFactor.recoveryCodes.warning"
            onConfirmed={() => setPendingSeen(true)}
          />
        ) : undefined}
      </Dialog>

      <Dialog
        open={panel === 'totp-off'}
        onOpenChange={(open) => !open && setPanel(undefined)}
        title={t('auth.twoFactor.disable')}
      >
        <TotpRemoval
          onDone={() => {
            forgetAccount();
            setPanel(undefined);
          }}
        />
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

    /*
     * No `revokeOtherSessions`. The server closes every other session on this
     * path anyway, from a hook, so it does not depend on a client remembering
     * to ask. Sending the flag as well meant Better Auth deleted every session
     * including this one and minted a replacement, and then the hook deleted
     * the replacement too: the person who had just chosen a password was signed
     * out on the device they chose it on.
     */
    const answer = await changePassword({ currentPassword: current, newPassword: next });

    setBusy(false);

    if (answer.error) {
      setError(describeAuthError(answer.error));

      return;
    }

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
      </DialogBody>

      <DialogFooter>
        <Button
          type="submit"
          variant="primary"
          full
          busy={busy}
          disabled={current.length === 0 || !isAcceptablePassword(next)}
        >
          {t('common.save')}
        </Button>
      </DialogFooter>
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

        {error ? (
          <p role="alert" className="text-13 text-error">
            {t(error.key, error.values)}
          </p>
        ) : undefined}
      </DialogBody>

      <DialogFooter>
        <Button type="submit" variant="primary" full busy={busy} disabled={password.length === 0}>
          {t('auth.recoveryCodes.regenerate')}
        </Button>
      </DialogFooter>
    </form>
  );
}

function Account({
  email,
  twoFactorOn,
}: {
  readonly email: string;
  readonly twoFactorOn: boolean;
}) {
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
        <DeleteAccount twoFactorOn={twoFactorOn} />
      </Dialog>
    </Group>
  );
}

/**
 * Leaving, behind the two things that prove the account is this person's.
 *
 * The password, and a code from the authenticator app when there is one. It was
 * a phrase typed into a box, which proves only that somebody can read and copy,
 * and this is the one action in the app that cannot be undone from inside it.
 * A borrowed laptop left open is exactly the case the phrase did nothing about.
 */
function DeleteAccount({ twoFactorOn }: { readonly twoFactorOn: boolean }) {
  const t = useTranslate();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{
    key: MessageKey;
    values: Record<string, string | number>;
  }>();

  const ready = password.length > 0 && (!twoFactorOn || code.length === 6);

  const submit = async () => {
    setError(undefined);
    setBusy(true);

    try {
      await request('/account', {
        method: 'DELETE',
        body: { password, ...(twoFactorOn ? { code } : {}) },
      });

      queryClient.clear();
      toast.show(t('settings.deleted'));
      await navigate({ to: '/sign-in' });
    } catch (failure) {
      setError(describe(failure));
      setCode('');
    } finally {
      setBusy(false);
    }
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
          label={t('auth.password.label')}
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />

        {twoFactorOn ? (
          <>
            <CodeInput
              label={t('auth.twoFactor.codeLabel')}
              value={code}
              onChange={setCode}
              invalid={error !== undefined}
            />
            <p className="text-13 leading-snug text-tertiary">
              {t('settings.deleteAccountCodeHint')}
            </p>
          </>
        ) : undefined}

        {error ? (
          <p role="alert" className="text-13 text-error">
            {t(error.key, error.values)}
          </p>
        ) : undefined}
      </DialogBody>

      <DialogFooter>
        <Button type="submit" variant="destructive" full busy={busy} disabled={!ready}>
          {t('settings.deleteAccount')}
        </Button>
      </DialogFooter>
    </form>
  );
}

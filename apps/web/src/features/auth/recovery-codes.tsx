import { useEffect, useState } from 'react';

import { formatRecoveryCode } from '@neuron/shared';
import type { MessageKey } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { Button } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
import { useToast } from '../../ui/toast';

/**
 * The ten codes, and the one screen nobody may walk past.
 *
 * These are shown exactly once. They are not a step towards getting back into
 * the account, they are the way back in, and there is no mail sender to send a
 * second copy. So this screen has no close button, ignores a press of escape
 * and a tap on the backdrop, and will not continue until the box is ticked.
 *
 * A reload is the one exit a browser always keeps, so the codes are held in
 * `sessionStorage` until the box is ticked and put straight back on screen if
 * the page comes back. That does mean the codes sit in the tab's storage for a
 * few minutes, which is a smaller risk than somebody's only credential being
 * destroyed by a stray pull to refresh.
 */
const HELD = 'neuron.recovery-codes.pending';

/** Puts codes aside so a reload cannot lose them. */
export function holdCodes(codes: readonly string[]): void {
  try {
    sessionStorage.setItem(HELD, JSON.stringify(codes));
  } catch {
    // Storage refused. The codes are still on screen, which is the copy that
    // matters; only surviving a reload is lost.
  }
}

/** The codes a previous page load was showing, if it was interrupted. */
export function heldCodes(): readonly string[] | undefined {
  try {
    const raw = sessionStorage.getItem(HELD);

    if (!raw) {
      return undefined;
    }

    const parsed: unknown = JSON.parse(raw);

    return Array.isArray(parsed) && parsed.every((code) => typeof code === 'string')
      ? (parsed as string[])
      : undefined;
  } catch {
    return undefined;
  }
}

/** Forgets them, once somebody has said they have them. */
export function releaseCodes(): void {
  try {
    sessionStorage.removeItem(HELD);
  } catch {
    // Nothing to do about it, and nothing worth saying.
  }
}

export function RecoveryCodes({
  codes,
  title,
  warningKey,
  onConfirmed,
}: {
  readonly codes: readonly string[];
  readonly title: string;
  readonly warningKey: MessageKey;
  readonly onConfirmed: () => void;
}) {
  const t = useTranslate();
  const toast = useToast();
  const [saved, setSaved] = useState(false);

  /*
   * The browser's own "leave this page?" prompt, while the codes are unsaved.
   *
   * It is the last thing standing between a closed tab and an account that can
   * never be recovered. Browsers only show it after some interaction with the
   * page, which is why it is a second line rather than the first.
   */
  useEffect(() => {
    if (saved) {
      return;
    }

    const warn = (event: BeforeUnloadEvent) => event.preventDefault();

    window.addEventListener('beforeunload', warn);

    return () => window.removeEventListener('beforeunload', warn);
  }, [saved]);

  const text = codes.map(formatRecoveryCode).join('\n');

  return (
    <div className="flex flex-col gap-24">
      <div>
        <h2 className="text-20 font-semibold text-text">{title}</h2>
        <p className="mt-8 text-16 text-text-dim">{t('auth.recoveryCodes.subtitle')}</p>
      </div>

      {/*
        The warning, in the loudest place on the screen rather than under the
        codes where a phone would cut it off.
      */}
      <p className="rounded-10 border border-warn bg-warn/10 px-16 py-12 text-16 text-text">
        {t(warningKey)}
      </p>

      <ul className="grid grid-cols-2 gap-8 rounded-10 border border-border bg-surface-2 p-16">
        {codes.map((code) => (
          <li key={code} className="font-mono text-16 tracking-wide text-text tabular-nums">
            {formatRecoveryCode(code)}
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-12 sm:flex-row">
        <Button
          full
          onClick={() => {
            void navigator.clipboard
              .writeText(text)
              .then(() => toast.show(t('auth.recoveryCodes.copied')));
          }}
        >
          {t('auth.recoveryCodes.copy')}
        </Button>

        <Button
          full
          onClick={() => {
            const blob = new Blob([`${text}\n`], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');

            link.href = url;
            link.download = t('auth.recoveryCodes.fileName');
            link.click();

            URL.revokeObjectURL(url);
          }}
        >
          {t('auth.recoveryCodes.download')}
        </Button>
      </div>

      <Checkbox checked={saved} onChange={setSaved}>
        {t('auth.recoveryCodes.confirm')}
      </Checkbox>

      <Button
        variant="primary"
        full
        disabled={!saved}
        onClick={() => {
          releaseCodes();
          onConfirmed();
        }}
      >
        {t('common.continue')}
      </Button>
    </div>
  );
}

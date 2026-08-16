import { useEffect, useState } from 'react';

import { formatRecoveryCode } from '@neuron/shared';
import type { MessageKey } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { Button } from '../../ui/button';
import { Panel } from '../../ui/card';
import { Checkbox } from '../../ui/checkbox';
import { DIALOG_FORM, DialogBody, DialogFooter } from '../../ui/dialog';
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
  /**
   * The heading, for the screens that need one of their own.
   *
   * Left out inside a dialog whose own title already says this, which is the
   * regenerate flow in Settings: it said "Your recovery codes" twice, one
   * under the other, and the hundred pixels that cost were the difference
   * between the codes fitting on a phone and having to be scrolled to.
   */
  readonly title?: string | undefined;
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
    <div className={DIALOG_FORM}>
      {/*
        Tighter than the default sixteen. Ten codes, a warning that cannot be
        shortened and two actions is the most this app ever puts in one dialog,
        and four pixels a gap is what makes it fit a 375 pixel phone whole.
      */}
      <DialogBody className="gap-12">
        <div>
          {title ? (
            <h2 className="mb-8 font-display text-20 tracking-snug text-primary">{title}</h2>
          ) : undefined}
          <p className="text-14 leading-body text-secondary">{t('auth.recoveryCodes.subtitle')}</p>
        </div>

        {/*
          The warning, in the loudest place on the screen rather than under the
          codes where a phone would cut it off. A well rather than a coloured
          panel: the signal hue is for error text and never for an area this
          size, and a block of its own is loud enough.
        */}
        <Panel className="p-12 sm:p-16">
          <p className="text-14 leading-body text-primary">{t(warningKey)}</p>
        </Panel>

        {/*
          Two columns that do not wrap, which is what decides the height of this
          screen. A code is seventeen characters with its hyphens, and at fifteen
          pixels that is wider than half a phone: every one of the ten wrapped
          onto a second line, the block was 274 pixels instead of 130, and the
          button underneath fell off the bottom of the dialog. Thirteen pixels
          and a tighter well fit the whole code on one line.
        */}
        <Panel className="p-8 sm:p-16">
          <ul className="grid grid-cols-2 gap-x-8 gap-y-4">
            {codes.map((code) => (
              <li
                key={code}
                className="font-mono text-13 tracking-wide text-primary tabular-nums sm:text-15"
              >
                {formatRecoveryCode(code)}
              </li>
            ))}
          </ul>
        </Panel>

        {/*
          Side by side at every width. Stacked, the two of them were 108 pixels
          of a screen that has ten codes and a warning to fit as well, and
          neither label is long enough to need a row of its own.
        */}
        <div className="flex flex-row gap-12">
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

      </DialogBody>

      {/*
        The box travels with the button it unlocks, in the part that does not
        scroll. It is the last thing between somebody and an account nobody can
        recover, and it was at the foot of the scrolling column: on a phone that
        put the tick below the fold and the button that needs it above, which
        reads as a button that is broken.
      */}
      <DialogFooter>
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
      </DialogFooter>
    </div>
  );
}

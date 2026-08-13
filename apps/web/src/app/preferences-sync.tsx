import { useEffect } from 'react';

import { adoptLocale, localeChosen } from '../i18n/locale';
import { useAccount } from '../lib/account';
import { adoptTheme, themeChosen } from '../theme/use-theme';

/**
 * The one moment the account's preferences are allowed onto this device.
 *
 * Theme and language belong to the device. They are read from local storage
 * before the first paint and changed without a request in the path, so the
 * account row is a copy, not the source.
 *
 * A device that has never chosen is the exception, and only that. Signing in on
 * a new phone should arrive in the right language rather than in whatever the
 * browser guessed, and there is no local choice to lose. Once this device has
 * chosen, the account never overrides it again: that override is what used to
 * flip the theme back roughly a second after every load, and what let a stale
 * response undo a switch the person had just made.
 */
export function PreferencesSync() {
  const fromAccount = useAccount().data;

  useEffect(() => {
    if (!fromAccount) {
      return;
    }

    if (!themeChosen()) {
      adoptTheme(fromAccount.theme);
    }

    if (!localeChosen()) {
      adoptLocale(fromAccount.locale);
    }
  }, [fromAccount]);

  return null;
}

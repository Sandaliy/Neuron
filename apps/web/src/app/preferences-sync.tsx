import { useEffect } from 'react';

import { useLocale } from '../i18n/provider';
import { useAccount } from '../lib/account';
import { useTheme } from '../theme/provider';

/**
 * Brings the account's theme and language onto this device.
 *
 * The two live in two places on purpose. `localStorage` is what the script in
 * `index.html` can read before the first paint, so it decides what is drawn;
 * the account row is what makes the choice follow somebody to a second device.
 *
 * This runs once a session exists and copies the account's answer down, which
 * also puts it into local storage for the next first paint. It only ever
 * changes anything on a device that disagrees, so signing in on a new phone
 * arrives in the right language and the right theme without a flash of the
 * wrong one on the load after.
 */
export function PreferencesSync() {
  const account = useAccount();
  const { theme, setTheme } = useTheme();
  const { locale, setLocale } = useLocale();

  const fromAccount = account.data;

  useEffect(() => {
    if (fromAccount && fromAccount.theme !== theme) {
      setTheme(fromAccount.theme);
    }
    // Only when the account's answer changes. Listing the local value here
    // would undo a switch in settings on the next render, because settings
    // writes to the account and the account has not answered yet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromAccount?.theme]);

  useEffect(() => {
    if (fromAccount && fromAccount.locale !== locale) {
      setLocale(fromAccount.locale);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromAccount?.locale]);

  return null;
}

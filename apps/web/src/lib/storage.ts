/**
 * Local storage that cannot throw.
 *
 * Safari in private browsing, and any browser with site data blocked, throws
 * from `localStorage` rather than returning nothing. Every read here is a
 * preference with a sensible default, so a browser that refuses to remember
 * should mean the app forgets, never that the app fails to start.
 */

/** The keys anything is stored under. Written once, so a typo cannot split one. */
export const STORAGE_KEYS = {
  theme: 'neuron.theme',
  locale: 'neuron.locale',
  glass: 'neuron.glass',
  glassScope: 'neuron.glass-scope',
  motion: 'neuron.motion',
  openDecks: 'neuron.library.open',
} as const;

export const RECOVERY_CODE_KEYS = {
  account: 'neuron.account-codes.pending',
  'two-factor': 'neuron.two-factor-codes.pending',
} as const;

const REGISTRATION_ACCOUNT_KEY = 'neuron.account-codes.owner';
let registrationAccount: string | undefined;
const registrationCodeListeners = new Set<() => void>();

export function registrationCodeOwner() {
  try {
    return registrationAccount ?? sessionStorage.getItem(REGISTRATION_ACCOUNT_KEY) ?? undefined;
  } catch {
    return registrationAccount;
  }
}

export function setRegistrationCodeOwner(accountId: string) {
  registrationAccount = accountId;
  try {
    sessionStorage.setItem(REGISTRATION_ACCOUNT_KEY, accountId);
  } catch {
    /* The current tab still knows the owner. */
  }
}

export function onRegistrationCodesCleared(listener: () => void) {
  registrationCodeListeners.add(listener);
  return () => {
    registrationCodeListeners.delete(listener);
  };
}

/** Unconfirmed credentials may survive a reload within the same account visit. */
export function clearHeldRecoveryCodes(nextAccountId?: string) {
  const clearRegistration =
    nextAccountId === undefined || nextAccountId !== registrationCodeOwner();
  if (clearRegistration) registrationAccount = undefined;
  try {
    if (clearRegistration) {
      sessionStorage.removeItem(RECOVERY_CODE_KEYS.account);
      sessionStorage.removeItem(REGISTRATION_ACCOUNT_KEY);
    }
    sessionStorage.removeItem(RECOVERY_CODE_KEYS['two-factor']);
  } catch {
    /* Session storage is optional. */
  }
  if (clearRegistration) registrationCodeListeners.forEach((listener) => listener());
}

/**
 * Reads a value.
 *
 * @param key what to read
 * @returns the value, or undefined when it is missing or unreadable
 */
export function read(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Writes a value, and shrugs when it cannot.
 *
 * @param key what to write
 * @param value what to write there
 */
export function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Nothing here is worth interrupting somebody over.
  }
}

/**
 * Forgets a value, and shrugs when it cannot.
 *
 * @param key what to forget
 */
export function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // An unreadable value is already forgotten.
  }
}

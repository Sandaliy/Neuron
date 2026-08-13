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
  openDecks: 'neuron.library.open',
} as const;

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

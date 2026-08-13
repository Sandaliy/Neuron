import { THEMES } from '@neuron/shared';
import type { Theme } from '@neuron/shared';

import { STORAGE_KEYS, read, write } from '../lib/storage';

/**
 * Which theme is on, and how it gets onto the page.
 *
 * The same three steps run twice: once as a plain script in `index.html`,
 * before the stylesheet loads, and once from here while the app is running.
 * The first is what stops a light theme from flashing dark on every load; the
 * second is what makes the switch in settings take effect without a reload.
 *
 * `resolve` and `apply` are exported so a test can prove the two copies agree.
 */

/** What is actually painted. `system` resolves to one of these. */
export type Resolved = 'dark' | 'light';

/** The theme the page starts on when nobody has chosen. */
export const DEFAULT_THEME: Theme = 'system';

/**
 * Reads the stored choice.
 *
 * @returns the stored theme, or the default when there is none
 */
export function storedTheme(): Theme {
  const stored = read(STORAGE_KEYS.theme);

  return (THEMES as readonly string[]).includes(stored ?? '') ? (stored as Theme) : DEFAULT_THEME;
}

/** Remembers a choice for the next first paint. */
export function storeTheme(theme: Theme): void {
  write(STORAGE_KEYS.theme, theme);
}

/**
 * Turns a choice into the theme that gets painted.
 *
 * @param theme what was chosen
 * @param prefersDark what the operating system asks for
 * @returns dark or light
 */
export function resolve(theme: Theme, prefersDark: boolean): Resolved {
  if (theme === 'system') {
    return prefersDark ? 'dark' : 'light';
  }

  return theme;
}

/**
 * Puts the resolved theme on the html element.
 *
 * `colorScheme` as well as the attribute, so the browser paints its own
 * furniture to match: scrollbars, the caret, and form controls it draws itself.
 *
 * @param resolved dark or light
 */
export function apply(resolved: Resolved): void {
  const root = document.documentElement;

  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
}

/** Whether the operating system is asking for a dark interface right now. */
export function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

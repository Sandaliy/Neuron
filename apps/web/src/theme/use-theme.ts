import { useCallback, useSyncExternalStore } from 'react';

import { THEMES } from '@neuron/shared';
import type { Theme } from '@neuron/shared';

import { createDevicePreference } from '../preferences/device';
import { syncPreferences } from '../preferences/sync';
import { STORAGE_KEYS } from '../lib/storage';

import { DEFAULT_THEME, apply, resolve, systemPrefersDark } from './theme';

import type { Resolved } from './theme';

/**
 * The theme, as a device preference.
 *
 * The value is read and put on the document while this module is evaluated,
 * which happens before React renders anything. The script in `index.html` has
 * already done the same thing earlier still, so this is the second of two
 * agreeing answers rather than the first one anybody sees.
 *
 * There is no provider and no context. A theme change ends as an attribute on
 * the html element and the rest is CSS, so the only components that need to
 * re-render are the ones that read the value to draw a control.
 */
const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) {
    listener();
  }
}

const preference = createDevicePreference<Theme>({
  key: STORAGE_KEYS.theme,
  fallback: () => DEFAULT_THEME,
  parse: (raw) => ((THEMES as readonly string[]).includes(raw) ? (raw as Theme) : undefined),
  serialise: (value) => value,
  apply: (value) => apply(resolve(value, systemPrefersDark())),
});

/*
 * Follow the operating system while `system` is chosen, without waiting for a
 * reload. A machine that switches theme at sunset with the app open in front of
 * somebody should switch with it.
 */
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  const query = window.matchMedia('(prefers-color-scheme: dark)');

  query.addEventListener('change', (event) => {
    if (preference.get() === 'system') {
      apply(resolve('system', event.matches));
      announce();
    }
  });
}

function subscribe(listener: () => void): () => void {
  const drop = preference.subscribe(listener);

  listeners.add(listener);

  return () => {
    drop();
    listeners.delete(listener);
  };
}

/**
 * Chooses a theme.
 *
 * Storage, the document and every subscriber are updated before this returns.
 * The account row is told afterwards and nothing here waits for it.
 *
 * @param theme what was chosen
 */
export function setTheme(theme: Theme): void {
  preference.set(theme);
  syncPreferences({ theme });
}

/** Whether this device has ever chosen a theme of its own. */
export function themeChosen(): boolean {
  return preference.chosen();
}

/** Adopts a theme without recording it as this device's own choice. */
export function adoptTheme(theme: Theme): void {
  preference.set(theme);
}

export interface ThemeValue {
  /** What was chosen, including `system`. */
  readonly theme: Theme;
  /** What is painted right now. */
  readonly resolved: Resolved;
  readonly setTheme: (theme: Theme) => void;
}

export function useTheme(): ThemeValue {
  const theme = useSyncExternalStore(subscribe, preference.get, preference.get);
  const resolved = useSyncExternalStore(
    subscribe,
    () => resolve(preference.get(), systemPrefersDark()),
    () => resolve(preference.get(), false),
  );

  return { theme, resolved, setTheme: useCallback(setTheme, []) };
}

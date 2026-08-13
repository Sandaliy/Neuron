import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import type { Theme } from '@neuron/shared';

import { apply, resolve, storeTheme, storedTheme, systemPrefersDark } from './theme';

import type { Resolved } from './theme';
import type { ReactNode } from 'react';

interface ThemeValue {
  /** What was chosen, including `system`. */
  readonly theme: Theme;
  /** What is painted right now. */
  readonly resolved: Resolved;
  readonly setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeValue | undefined>(undefined);

export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => storedTheme());
  const [prefersDark, setPrefersDark] = useState<boolean>(() => systemPrefersDark());

  /**
   * Follow the operating system while `system` is chosen.
   *
   * Without this the choice only takes effect on a reload, which is the wrong
   * behaviour for a machine that switches theme at sunset while the app is
   * open in front of somebody.
   */
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches);

    query.addEventListener('change', onChange);

    return () => query.removeEventListener('change', onChange);
  }, []);

  const resolved = resolve(theme, prefersDark);

  useEffect(() => {
    apply(resolved);
  }, [resolved]);

  const setTheme = useCallback((next: Theme) => {
    storeTheme(next);
    setThemeState(next);
  }, []);

  const value = useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);

  if (!value) {
    throw new Error('useTheme was called outside ThemeProvider');
  }

  return value;
}

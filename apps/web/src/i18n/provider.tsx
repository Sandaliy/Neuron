import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { LOCALES, translate } from '@neuron/shared';
import type { Locale, MessageKey, MessageValues } from '@neuron/shared';

import { STORAGE_KEYS, read, write } from '../lib/storage';

import type { ReactNode } from 'react';

/**
 * The language of the interface.
 *
 * The catalogue itself lives in `packages/shared/src/i18n`, not here, because
 * the api answers with codes rather than sentences and both ends have to agree
 * on what `rate_limited` says. This file is only the part that decides which
 * of the two catalogues is in front of the person, and remembers it.
 */

/** Turns a message key into a sentence in the current language. */
export type Translate = (key: MessageKey, values?: MessageValues) => string;

interface LocaleValue {
  readonly locale: Locale;
  readonly setLocale: (locale: Locale) => void;
  readonly t: Translate;
}

const LocaleContext = createContext<LocaleValue | undefined>(undefined);

/**
 * The language to start in when nobody has chosen one.
 *
 * The browser's own preference list, in order, so a Russian speaker whose
 * browser is set to Russian never sees an English screen at all. Anything that
 * is neither of the two falls back to English rather than to nothing.
 *
 * @returns the locale to open in
 */
export function preferredLocale(): Locale {
  const stored = read(STORAGE_KEYS.locale);

  if (isLocale(stored)) {
    return stored;
  }

  for (const candidate of navigator.languages ?? [navigator.language]) {
    const base = candidate.split('-')[0]?.toLowerCase();

    if (isLocale(base)) {
      return base;
    }
  }

  return 'en';
}

function isLocale(value: string | undefined): value is Locale {
  return (LOCALES as readonly string[]).includes(value ?? '');
}

export function LocaleProvider({
  children,
  initial,
}: {
  readonly children: ReactNode;
  readonly initial?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(() => initial ?? preferredLocale());

  // Screen readers pick a voice from this, and the browser hyphenates and picks
  // quotation marks from it. It has to follow the switch, not the first render.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    write(STORAGE_KEYS.locale, next);
    setLocaleState(next);
  }, []);

  const t = useCallback<Translate>((key, values) => translate(locale, key, values), [locale]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleValue {
  const value = useContext(LocaleContext);

  if (!value) {
    throw new Error('useLocale was called outside LocaleProvider');
  }

  return value;
}

/** The common case: a component that only needs to turn keys into sentences. */
export function useTranslate(): Translate {
  return useLocale().t;
}

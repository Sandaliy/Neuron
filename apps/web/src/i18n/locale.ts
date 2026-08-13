import { useCallback, useSyncExternalStore } from 'react';

import { LOCALES, translate } from '@neuron/shared';
import type { Locale, MessageKey, MessageValues } from '@neuron/shared';

import { STORAGE_KEYS } from '../lib/storage';
import { createDevicePreference } from '../preferences/device';
import { syncPreferences } from '../preferences/sync';

/**
 * The language of the interface, as a device preference.
 *
 * The catalogue itself lives in `packages/shared/src/i18n`, not here, because
 * the api answers with codes rather than sentences and both ends have to agree
 * on what `rate_limited` says. This file decides which of the two catalogues is
 * in front of the person, remembers it on this device, and never waits on a
 * request to do either.
 */

/** Turns a message key into a sentence in the current language. */
export type Translate = (key: MessageKey, values?: MessageValues) => string;

function isLocale(value: string | undefined): value is Locale {
  return (LOCALES as readonly string[]).includes(value ?? '');
}

/**
 * The language to open in when this device has never chosen one.
 *
 * The browser's own preference list, in order, so a Russian speaker whose
 * browser is set to Russian never sees an English screen at all. Anything that
 * is neither of the two falls back to English rather than to nothing.
 *
 * @returns the locale to open in
 */
export function preferredLocale(): Locale {
  if (typeof navigator === 'undefined') {
    return 'en';
  }

  for (const candidate of navigator.languages ?? [navigator.language]) {
    const base = candidate.split('-')[0]?.toLowerCase();

    if (isLocale(base)) {
      return base;
    }
  }

  return 'en';
}

const preference = createDevicePreference<Locale>({
  key: STORAGE_KEYS.locale,
  fallback: preferredLocale,
  parse: (raw) => (isLocale(raw) ? raw : undefined),
  serialise: (value) => value,
  // Screen readers pick a voice from this, and the browser hyphenates and
  // chooses quotation marks from it.
  apply: (value) => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = value;
    }
  },
});

/**
 * Chooses a language.
 *
 * Applied and remembered before this returns. The account row is told
 * afterwards and nothing here waits for it.
 *
 * @param locale what was chosen
 */
export function setLocale(locale: Locale): void {
  preference.set(locale);
  syncPreferences({ locale });
}

/** Whether this device has ever chosen a language of its own. */
export function localeChosen(): boolean {
  return preference.chosen();
}

/** Adopts a language without recording it as this device's own choice. */
export function adoptLocale(locale: Locale): void {
  preference.set(locale);
}

export interface LocaleValue {
  readonly locale: Locale;
  readonly setLocale: (locale: Locale) => void;
  readonly t: Translate;
}

export function useLocale(): LocaleValue {
  const locale = useSyncExternalStore(preference.subscribe, preference.get, preference.get);

  const t = useCallback<Translate>((key, values) => translate(locale, key, values), [locale]);

  return { locale, setLocale, t };
}

/** The common case: a component that only needs to turn keys into sentences. */
export function useTranslate(): Translate {
  return useLocale().t;
}

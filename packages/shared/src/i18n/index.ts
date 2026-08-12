import { en } from './en.js';
import { ru } from './ru.js';

import type { MessageKey, Messages } from './en.js';
import type { Locale } from '../preferences.js';

/**
 * The two catalogues, and the one function that reads them.
 *
 * Here rather than in `apps/web` because the api sends codes and never
 * sentences, so the sentence for `rate_limited` has to exist somewhere both
 * ends can agree on, and because the recovery code warning is part of the
 * contract of the endpoint that issues the codes rather than a decoration on
 * the screen that shows them.
 *
 * Deliberately small. There is no plural handling and no date formatting,
 * because nothing needs them yet and a translation layer built before the
 * screens exist is a translation layer built around guesses.
 */

export const CATALOGUES: Record<Locale, Messages> = { en, ru };

/** What a message can be given to fill its placeholders. */
export type MessageValues = Record<string, string | number>;

/**
 * Looks up one message and fills in its placeholders.
 *
 * A missing placeholder is left as it was written rather than replaced with
 * nothing, because `Wait  seconds` reads like a bug the person caused and
 * `Wait {seconds} seconds` reads like a bug we caused, which is the truth.
 *
 * @param locale which language
 * @param key which message
 * @param values what to substitute for `{name}` placeholders
 * @returns the finished string
 */
export function translate(locale: Locale, key: MessageKey, values: MessageValues = {}): string {
  const template = CATALOGUES[locale][key];

  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = values[name];

    return value === undefined ? whole : String(value);
  });
}

export { en } from './en.js';
export { ru } from './ru.js';
export type { MessageKey, Messages } from './en.js';

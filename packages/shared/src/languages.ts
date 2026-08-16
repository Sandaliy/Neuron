import { z } from 'zod';

/**
 * The languages a deck can be about, and how far along its owner is.
 *
 * A short list rather than every ISO code. These three settings exist to fill
 * in the card generation prompt and, later, to decide which grammar fields a
 * word needs, and both of those want a name a model understands rather than a
 * code. Adding a language is one line here plus its two names in the
 * catalogues.
 */

/** ISO 639-1 codes, for the languages the prompt has rules for or near ones. */
export const LANGUAGE_CODES = ['de', 'en', 'ru', 'fr', 'es', 'it'] as const;

export const languageCodeSchema = z.enum(LANGUAGE_CODES);

export type LanguageCode = z.infer<typeof languageCodeSchema>;

/**
 * The English name of each language.
 *
 * The prompt is written in English and read by a model, so this is what gets
 * substituted into it. What a person sees in the interface is a translated
 * string from the catalogues, keyed by the same code.
 */
export const LANGUAGE_NAMES: Record<LanguageCode, string> = {
  de: 'German',
  en: 'English',
  ru: 'Russian',
  fr: 'French',
  es: 'Spanish',
  it: 'Italian',
};

/** The Common European Framework levels, easiest first. */
export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;

export const cefrLevelSchema = z.enum(CEFR_LEVELS);

export type CefrLevel = z.infer<typeof cefrLevelSchema>;

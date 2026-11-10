import { z } from 'zod';

import { CARD_DIRECTIONS, DAYS_PER_WEEK, type CardDirection } from '@neuron/core';

import { cefrLevelSchema, languageCodeSchema } from './languages.js';

import type { CefrLevel, LanguageCode } from './languages.js';

/**
 * Settings on a deck, and how a deck inherits them from its parent.
 *
 * Every field is optional, and absent means "ask my parent". Set a budget on
 * the German folder and every lesson inside it follows. Set one on Lesson 3 and
 * it applies there only. The resolved value is whatever the nearest ancestor
 * that has an opinion says, which is the behaviour people expect from folders
 * and which nobody thanks you for getting wrong.
 */

/**
 * Minutes offered per day of the week, index 0 being Sunday.
 *
 * Sunday first because `Budget.minutesByWeekday` in packages/core is indexed by
 * `Date.getDay`, and two different orderings for the same seven numbers is a
 * bug that hides for six days at a time.
 */
const budgetMinutesSchema = z
  .array(
    z
      .number()
      .int()
      .min(0)
      .max(24 * 60),
  )
  .length(DAYS_PER_WEEK, `needs ${DAYS_PER_WEEK} values, Sunday first`);

// The list of directions belongs to packages/core, which owns the scheduling
// vocabulary. The cast is what it costs to build an enum from a readonly array
// without writing the five names out a second time and letting them drift.
const directionSchema: z.ZodType<CardDirection> = z.enum(
  CARD_DIRECTIONS as unknown as [CardDirection, ...CardDirection[]],
);

/**
 * One rung of the ladder that opens directions one at a time.
 *
 * Three cards per note on day one triples the load on day one. So recognition
 * starts alone, and the next direction opens once the one before it has proved
 * it stuck. `opensAtStability` is the stability, in days, that the previous
 * rung has to reach. Zero on the first rung, because nothing precedes it.
 */
const ladderRungSchema = z.strictObject({
  direction: directionSchema,
  opensAtStability: z.number().min(0),
});

export const deckSettingsSchema = z.strictObject({
  /** Leaf-deck participation only; never inherited from a Folder or account. */
  dailyStudyIncluded: z.boolean().optional(),
  budgetMinutes: budgetMinutesSchema.optional(),
  allowCarryOver: z.boolean().optional(),
  ladder: z.array(ladderRungSchema).min(1).optional(),
  maximumNewCardsPerDay: z.number().int().min(0).max(9999).optional(),
  targetRetention: z.number().min(0.7).max(0.98).optional(),
  studyPresetId: z.uuid().optional(),

  /**
   * What the deck is about, which the editor and the importer both need.
   *
   * The language decides which grammar fields a word is asked for, and all
   * three are substituted into the card generation prompt. They inherit like
   * everything else here, so "German" is set once on the folder and every
   * lesson inside it is German.
   */
  targetLanguage: languageCodeSchema.optional(),
  nativeLanguage: languageCodeSchema.optional(),
  level: cefrLevelSchema.optional(),
});

export type DeckSettings = z.infer<typeof deckSettingsSchema>;

/**
 * The two languages a new deck is created with, both required.
 *
 * A deck's words are in one language and their translations in another, and
 * that is a fact about its notes rather than about where the deck happens to
 * sit. So a new deck stores both as its own settings instead of inheriting
 * them: moving it to another folder, or changing a folder default later, does
 * not change what language its words are in. A folder's languages still
 * prefill the choice. Decks made before this rule keep inheriting.
 *
 * The same code on both sides is allowed: an advanced learner may want German
 * words explained in German.
 */
export const deckLanguagesSchema = z.strictObject({
  targetLanguage: languageCodeSchema,
  nativeLanguage: languageCodeSchema,
});

export type DeckLanguages = z.infer<typeof deckLanguagesSchema>;

export type DeckLanguageField = keyof DeckLanguages;

/**
 * Which of the two languages a deck still lacks once inheritance is applied.
 *
 * Nothing is guessed for a missing one. The screens that need a language say
 * what is missing and offer to set it; study goes on without it.
 *
 * @param settings the deck's resolved settings
 * @returns the missing fields, target first; empty when the deck knows both
 */
export function missingDeckLanguages(
  settings: Pick<ResolvedDeckSettings, 'targetLanguage' | 'nativeLanguage'>,
): DeckLanguageField[] {
  return (['targetLanguage', 'nativeLanguage'] as const).filter(
    (field) => settings[field] === undefined,
  );
}

/**
 * Whether settings sent with a new deck carry both languages or neither.
 *
 * Neither is what an app installed before languages were required sends, and
 * it is still accepted so that work saved on such a device is not lost. One
 * without the other is never sent by any version and is refused.
 */
export function hasBothLanguagesOrNeither(
  settings: Pick<DeckSettings, 'targetLanguage' | 'nativeLanguage'> | null | undefined,
): boolean {
  return (settings?.targetLanguage === undefined) === (settings?.nativeLanguage === undefined);
}

/** One rung of the ladder, once it has been read out of storage. */
export type LadderRung = z.infer<typeof ladderRungSchema>;

/**
 * Deck settings with every question answered.
 *
 * Spelled out rather than derived with `Required`, because that only strips the
 * question mark and leaves the `| undefined` the optional schema put in the
 * type. The whole point of a resolved value is that nothing in it is missing.
 */
export interface ResolvedDeckSettings {
  readonly budgetMinutes: readonly number[];
  readonly allowCarryOver: boolean;
  readonly ladder: readonly LadderRung[];
  readonly maximumNewCardsPerDay: number;
  readonly targetRetention: number;
  /** The one field with no sensible default: a deck may simply have no preset. */
  readonly studyPresetId?: string;
  /**
   * The three that cannot be guessed.
   *
   * A language has no sensible default: assuming German would fill a Spanish
   * deck's prompt with the wrong word and produce five thousand wrong cards
   * before anybody noticed. So they stay absent until somebody says, and the
   * screens that need them say what is missing and where to set it.
   */
  readonly targetLanguage?: LanguageCode;
  readonly nativeLanguage?: LanguageCode;
  readonly level?: CefrLevel;
}

/** What a deck falls back to when nothing above it has an opinion. */
export const DEFAULT_DECK_SETTINGS: Omit<
  ResolvedDeckSettings,
  'studyPresetId' | 'targetLanguage' | 'nativeLanguage' | 'level'
> = {
  budgetMinutes: [30, 15, 15, 15, 15, 15, 30],
  allowCarryOver: true,
  ladder: [
    { direction: 'recognition', opensAtStability: 0 },
    { direction: 'recall', opensAtStability: 14 },
    { direction: 'production', opensAtStability: 21 },
  ],
  maximumNewCardsPerDay: 30,
  targetRetention: 0.9,
};

/**
 * Collapses a chain of decks into the settings that apply at the end of it.
 *
 * @param chain the decks from the root down to the one being asked about, each
 *   contributing its own settings or null when it has none
 * @returns settings with every field filled in, nearest opinion winning
 */
export function resolveDeckSettings(
  chain: readonly (DeckSettings | null | undefined)[],
): ResolvedDeckSettings {
  let resolved: ResolvedDeckSettings = { ...DEFAULT_DECK_SETTINGS };

  for (const settings of chain) {
    if (!settings) {
      continue;
    }

    // Only keys that are actually present override. An explicit undefined in a
    // parsed object would otherwise wipe out a value set further up.
    for (const [key, value] of Object.entries(settings)) {
      if (value !== undefined && key !== 'dailyStudyIncluded') {
        resolved = { ...resolved, [key]: value };
      }
    }
  }

  return resolved;
}

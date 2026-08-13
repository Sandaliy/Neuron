import { z } from 'zod';

import { CARD_DIRECTIONS, DAYS_PER_WEEK, type CardDirection } from '@neuron/core';

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
  budgetMinutes: budgetMinutesSchema.optional(),
  allowCarryOver: z.boolean().optional(),
  ladder: z.array(ladderRungSchema).min(1).optional(),
  maximumNewCardsPerDay: z.number().int().min(0).max(9999).optional(),
  targetRetention: z.number().min(0.7).max(0.98).optional(),
  studyPresetId: z.uuid().optional(),
});

export type DeckSettings = z.infer<typeof deckSettingsSchema>;

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
}

/** What a deck falls back to when nothing above it has an opinion. */
export const DEFAULT_DECK_SETTINGS: Omit<ResolvedDeckSettings, 'studyPresetId'> = {
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
      if (value !== undefined) {
        resolved = { ...resolved, [key]: value };
      }
    }
  }

  return resolved;
}

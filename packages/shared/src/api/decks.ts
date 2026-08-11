import { z } from 'zod';

import { deckSettingsSchema } from '../deck-settings.js';

import { idSchema, nameSchema } from './common.js';

/**
 * Decks, which are also folders.
 *
 * Every schema here is strict: a field the server does not know about is a
 * rejected request, not a silently ignored one. A client sending `parentID`
 * instead of `parentId` should find out immediately rather than wonder for a
 * week why nothing moves.
 */

export const deckSchema = z.object({
  id: idSchema,
  name: z.string(),
  parentId: idSchema.nullable(),
  position: z.number().int(),
  /** Ancestors, root first, this deck not included. */
  path: z.array(idSchema),
  settings: deckSettingsSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  rev: z.number().int(),
});

export type Deck = z.infer<typeof deckSchema>;

/** A deck with its children, as the library screen draws it. */
export interface DeckNode extends Deck {
  readonly children: readonly DeckNode[];
  /** Cards waiting, this deck and everything under it. */
  readonly due: number;
  /** Cards never answered, this deck and everything under it. */
  readonly fresh: number;
}

export const deckNodeSchema: z.ZodType<DeckNode> = deckSchema
  .extend({
    due: z.number().int().min(0),
    fresh: z.number().int().min(0),
    children: z.lazy(() => z.array(deckNodeSchema)),
  })
  .describe('A deck and its subtree, with the counts rolled up');

export const deckTreeSchema = z.object({ decks: z.array(deckNodeSchema) });

export const createDeckSchema = z.strictObject({
  /** Supply one when the deck was made offline, so it keeps its identity. */
  id: idSchema.optional(),
  name: nameSchema,
  parentId: idSchema.nullish(),
  settings: deckSettingsSchema.nullish(),
});

export const updateDeckSchema = z
  .strictObject({
    name: nameSchema.optional(),
    /** Null clears the deck's own settings, so it inherits again. */
    settings: deckSettingsSchema.nullish(),
  })
  .refine(
    (value) => value.name !== undefined || value.settings !== undefined,
    'needs something to change',
  );

export const moveDeckSchema = z.strictObject({
  /** Null moves the deck to the root. */
  parentId: idSchema.nullable(),
});

/**
 * A reorder rewrites one level at a time.
 *
 * The whole level rather than one deck's new index, because a client that sends
 * "put this third" and a server that has since gained a deck disagree about
 * what third means. Sending the order in full leaves no room for that.
 */
export const reorderDecksSchema = z.strictObject({
  parentId: idSchema.nullable(),
  order: z.array(idSchema).min(1).max(500),
});

export type CreateDeckBody = z.infer<typeof createDeckSchema>;
export type UpdateDeckBody = z.infer<typeof updateDeckSchema>;
export type MoveDeckBody = z.infer<typeof moveDeckSchema>;
export type ReorderDecksBody = z.infer<typeof reorderDecksSchema>;

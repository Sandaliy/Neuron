import { z } from 'zod';

import { CARD_DIRECTIONS, CARD_STATES } from '@neuron/core';
import type { CardDirection, CardState } from '@neuron/core';

import { idSchema, limitSchema } from './common.js';

/**
 * Cards, which nobody creates directly.
 *
 * A card follows from a note and a direction. The endpoints here are the four
 * things a person can do to one afterwards: put it aside, take it back, open a
 * direction the ladder has not reached yet, and start it over.
 *
 * The two lists come from packages/core, which owns the scheduling vocabulary,
 * rather than being written out again. The cast is what it costs to build an
 * enum from a readonly array without letting the two copies drift.
 */
export const cardDirectionSchema: z.ZodType<CardDirection> = z.enum(
  CARD_DIRECTIONS as unknown as [CardDirection, ...CardDirection[]],
);

export const cardStateSchema: z.ZodType<CardState> = z.enum(
  CARD_STATES as unknown as [CardState, ...CardState[]],
);

export const cardSchema = z.object({
  id: idSchema,
  noteId: idSchema,
  deckId: idSchema,
  direction: cardDirectionSchema,
  state: cardStateSchema,
  stability: z.number().nullable(),
  difficulty: z.number().nullable(),
  due: z.string(),
  lastReview: z.string().nullable(),
  reps: z.number().int(),
  lapses: z.number().int(),
  learningStep: z.number().int(),
  suspendedAt: z.string().nullable(),
  unlockedAt: z.string().nullable(),
  updatedAt: z.string(),
  rev: z.number().int(),
});

export type Card = z.infer<typeof cardSchema>;

/** What is due now, for the session builder to work from. */
export const dueCardsSchema = z.strictObject({
  deckId: idSchema.optional(),
  limit: limitSchema.optional(),
});

/** Opening a direction the ladder has not reached yet, by hand. */
export const unlockDirectionSchema = z.strictObject({
  direction: cardDirectionSchema,
});

export type DueCardsQuery = z.infer<typeof dueCardsSchema>;
export type UnlockDirectionBody = z.infer<typeof unlockDirectionSchema>;

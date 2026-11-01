import { z } from 'zod';

import { idSchema, nameSchema } from './common.js';
import { deckSchema } from './decks.js';

/** The observed ancestry protects both placement and inherited settings. */
export const createOfflineDeckCommandSchema = z
  .strictObject({
    accountId: z.string().min(1),
    operationId: idSchema,
    entityId: idSchema,
    kind: z.enum(['folder', 'deck']),
    name: nameSchema,
    parentId: idSchema.nullable(),
    ancestors: z
      .array(
        z.strictObject({
          id: idSchema,
          rev: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        }),
      )
      .max(8),
  })
  .refine(
    (value) =>
      (value.parentId === null
        ? value.ancestors.length === 0
        : value.ancestors.at(-1)?.id === value.parentId) &&
      new Set(value.ancestors.map((row) => row.id)).size === value.ancestors.length &&
      !value.ancestors.some((row) => row.id === value.entityId),
    'invalid ancestry',
  );
export type CreateOfflineDeckCommand = z.infer<typeof createOfflineDeckCommandSchema>;

export const createOfflineDeckResultSchema = z.discriminatedUnion('status', [
  z.object({
    operationId: idSchema,
    entityId: idSchema,
    status: z.literal('applied'),
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  }),
  z.object({
    operationId: idSchema,
    entityId: idSchema,
    status: z.literal('conflict'),
    reason: z.enum(['parent_unavailable', 'parent_changed', 'identity_exists', 'name_exists']),
  }),
]);
export type CreateOfflineDeckResult = z.infer<typeof createOfflineDeckResultSchema>;

/** Versioned device record; separate from server-owned collection rows. */
export const savedDeckCreationSchema = z.strictObject({
  version: z.literal(1),
  accountId: z.string().min(1),
  payload: createOfflineDeckCommandSchema,
  ancestors: z.array(deckSchema).max(8),
  createdAt: z.iso.datetime(),
  position: z.number().int().nonnegative(),
  state: z.enum(['pending', 'conflict', 'rejected', 'synchronized', 'resolved']),
  outcome: createOfflineDeckResultSchema.optional(),
  failure: z.string().optional(),
});
export type SavedDeckCreation = z.infer<typeof savedDeckCreationSchema>;

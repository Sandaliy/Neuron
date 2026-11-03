import { z } from 'zod';

import { idSchema } from './common.js';
import { noteSchema } from './notes.js';

// PostgreSQL's 200-character prefix may occupy 400 UTF-16 units in a response.
const keySchema = z
  .string()
  .min(1)
  .max(400)
  .refine((value) => [...value].length <= 200);
const scope = { deckId: idSchema.optional() };

/** Value cursors do not depend on the last Note still existing or keeping its term. */
export const possibleDuplicateGroupsQuerySchema = z.strictObject({
  ...scope,
  search: z.string().trim().min(1).max(100).optional(),
  cursor: keySchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const possibleDuplicateNotesQuerySchema = z.strictObject({
  ...scope,
  key: keySchema,
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export const possibleDuplicateGroupSchema = z.object({
  key: keySchema,
  count: z.number().int().min(2),
});
export const possibleDuplicateNoteSchema = noteSchema.extend({
  deckPath: z.array(z.string()).min(1),
  /** Only a complete downloaded view may include device-only Notes. */
  pending: z.boolean().optional(),
});
export const possibleDuplicateGroupsPageSchema = z.object({
  items: z.array(possibleDuplicateGroupSchema),
  nextCursor: keySchema.optional(),
  local: z.literal(true).optional(),
});
export const possibleDuplicateNotesPageSchema = z.object({
  items: z.array(possibleDuplicateNoteSchema),
  nextCursor: idSchema.optional(),
  local: z.literal(true).optional(),
});

export type PossibleDuplicateGroup = z.infer<typeof possibleDuplicateGroupSchema>;
export type PossibleDuplicateNote = z.infer<typeof possibleDuplicateNoteSchema>;
export type PossibleDuplicateGroupsQuery = z.infer<typeof possibleDuplicateGroupsQuerySchema>;
export type PossibleDuplicateNotesQuery = z.infer<typeof possibleDuplicateNotesQuerySchema>;
export type PossibleDuplicateGroupsPage = z.infer<typeof possibleDuplicateGroupsPageSchema>;
export type PossibleDuplicateNotesPage = z.infer<typeof possibleDuplicateNotesPageSchema>;

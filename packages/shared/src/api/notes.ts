import { z } from 'zod';

import { noteStatusSchema, noteTypeSchema } from '../note-types.js';

import { cursorSchema, idSchema, limitSchema, tagSchema } from './common.js';

/**
 * Notes: the facts, and the ways of asking for them.
 *
 * `fields` is deliberately loose here and strict one layer in. What a `vocab`
 * note has to contain is decided by the schemas in note-types.ts, keyed by the
 * type the note claims to be, and that check cannot be expressed in the same
 * object as the type name it depends on.
 */

export const noteSchema = z.object({
  id: idSchema,
  deckId: idSchema,
  noteType: noteTypeSchema,
  fields: z.record(z.string(), z.unknown()),
  tags: z.array(z.string()),
  source: z.string().nullable(),
  rank: z.number().int().nullable(),
  status: noteStatusSchema,
  importBatchId: idSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  rev: z.number().int(),
});

export type Note = z.infer<typeof noteSchema>;

export const listNotesSchema = z.strictObject({
  deckId: idSchema.optional(),
  /** Whether the decks under `deckId` count as well. Default is that they do. */
  subtree: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  status: noteStatusSchema.optional(),
  tag: tagSchema.optional(),
  /** Matches against the note's fields, case insensitively. */
  search: z.string().trim().min(1).max(100).optional(),
  limit: limitSchema.optional(),
  cursor: cursorSchema.optional(),
});

export const createNoteSchema = z.strictObject({
  id: idSchema.optional(),
  deckId: idSchema,
  noteType: noteTypeSchema,
  fields: z.record(z.string(), z.unknown()),
  tags: z.array(tagSchema).max(50).optional(),
  source: z.string().trim().max(200).nullish(),
  rank: z.number().int().min(0).nullish(),
  status: noteStatusSchema.optional(),
  importBatchId: idSchema.nullish(),
});

export const updateNoteSchema = z
  .strictObject({
    fields: z.record(z.string(), z.unknown()).optional(),
    tags: z.array(tagSchema).max(50).optional(),
    status: noteStatusSchema.optional(),
    deckId: idSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'needs something to change');

/**
 * Changing the status of many notes at once.
 *
 * Marking two hundred words as known after a placement test is one action to
 * the person doing it, and two hundred requests is how that action turns into a
 * spinner. Capped, because an unbounded batch is a way to hold a transaction
 * open for as long as somebody likes.
 */
export const bulkStatusSchema = z.strictObject({
  ids: z.array(idSchema).min(1).max(500),
  status: noteStatusSchema,
});

export type CreateNoteBody = z.infer<typeof createNoteSchema>;
export type UpdateNoteBody = z.infer<typeof updateNoteSchema>;
export type ListNotesQuery = z.infer<typeof listNotesSchema>;
export type BulkStatusBody = z.infer<typeof bulkStatusSchema>;

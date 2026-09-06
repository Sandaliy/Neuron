import { z } from 'zod';

import { noteTypeSchema } from '../note-types.js';

import { idSchema, nameSchema } from './common.js';
import { createNoteSchema } from './notes.js';

/**
 * Saved ways of studying, and imports that can be taken back.
 */

export const studyPresetSchema = z.object({
  id: idSchema,
  name: z.string(),
  deckId: idSchema.nullable(),
  config: z.unknown(),
  isDefault: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  rev: z.number().int(),
});

export type StudyPreset = z.infer<typeof studyPresetSchema>;

export const createPresetSchema = z.strictObject({
  id: idSchema.optional(),
  name: nameSchema,
  /** Null means the preset is offered on every deck. */
  deckId: idSchema.nullish(),
  config: z.record(z.string(), z.unknown()),
  isDefault: z.boolean().optional(),
});

export const updatePresetSchema = z
  .strictObject({
    name: nameSchema.optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    isDefault: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'needs something to change');

export const importBatchSchema = z.object({
  id: idSchema,
  deckId: idSchema,
  source: z.string(),
  format: z.string(),
  noteCount: z.number().int(),
  undoneAt: z.string().nullable(),
  createdAt: z.string(),
  rev: z.number().int(),
});

export type ImportBatch = z.infer<typeof importBatchSchema>;

/**
 * How many notes one chunk of an import may carry.
 *
 * Five thousand rows do not fit in one request: a serverless function has a
 * time limit, and a phone on a train has a connection that ends whenever it
 * likes. So the batch is created first and the notes arrive in chunks against
 * it, which also means a dropped connection costs one chunk rather than the
 * whole list.
 */
export const IMPORT_CHUNK_SIZE = 500;

/** What a note looks like on its way into an import. */
const importedNoteSchema = createNoteSchema.omit({ deckId: true, importBatchId: true });

/**
 * A chunk of an import, idempotent by the ids the client generated.
 *
 * Every note has to carry an id. That is what makes sending the same chunk
 * twice harmless: the second one writes nothing, because the rows are already
 * there under the same ids. Without it, a retry after a timeout that actually
 * succeeded doubles a hundred words and nobody can tell which copy is which.
 */
export const importChunkSchema = z.strictObject({
  notes: z
    .array(importedNoteSchema.extend({ id: idSchema }))
    .min(1)
    .max(IMPORT_CHUNK_SIZE),
});

/**
 * Starting an import.
 *
 * The batch can be created empty and filled by chunks, which is what a large
 * list does. A small one may send its notes here and be done in one request.
 */
export const createImportSchema = z.strictObject({
  id: idSchema.optional(),
  deckId: idSchema,
  source: z.string().trim().min(1).max(200),
  format: z.enum(['json', 'csv', 'tsv', 'text', 'anki', 'manual']).optional(),
  notes: z.array(importedNoteSchema).max(IMPORT_CHUNK_SIZE).optional(),
});

/**
 * What taking an import back would cost, asked before it is taken back.
 *
 * The count is the confirmation. The number of cards that have been answered is
 * the second one, because those are the only part of an import that cannot be
 * recreated by importing the file again.
 */
export const importSummarySchema = z.object({
  import: importBatchSchema,
  notes: z.number().int().min(0),
  cards: z.number().int().min(0),
  reviewedCards: z.number().int().min(0),
});

export type ImportSummary = z.infer<typeof importSummarySchema>;
export type ImportChunkBody = z.infer<typeof importChunkSchema>;

export type CreatePresetBody = z.infer<typeof createPresetSchema>;
export type UpdatePresetBody = z.infer<typeof updatePresetSchema>;
export type CreateImportBody = z.infer<typeof createImportSchema>;

/**
 * Which of these words are already in the library.
 *
 * The whole library, not the target deck: a word already learned in another
 * deck is exactly the duplicate worth knowing about. The terms go up in one
 * request rather than one each, and come back matched against an indexed
 * column, so five thousand rows are a handful of queries.
 */
export const duplicateCheckSchema = z.strictObject({
  terms: z.array(z.string().trim().min(1).max(300)).min(1).max(1000),
});

export const duplicateMatchSchema = z.object({
  /** The comparable form, which is what the caller matches its rows against. */
  term: z.string(),
  noteId: idSchema,
  noteType: noteTypeSchema,
  deckId: idSchema,
  /** As it is actually written on the note that is already there. */
  written: z.string(),
});

export type DuplicateCheckBody = z.infer<typeof duplicateCheckSchema>;
export type DuplicateMatch = z.infer<typeof duplicateMatchSchema>;

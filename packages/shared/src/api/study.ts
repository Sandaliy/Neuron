import { z } from 'zod';

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
 * One import, notes and all, in a single request.
 *
 * The batch and its notes arrive together so they land in one transaction. A
 * batch id handed out first, then notes attached to it over several requests,
 * leaves a half imported deck behind the moment a phone loses signal in the
 * middle, and nothing to undo it with.
 *
 * Two thousand is where a single request stops being reasonable. A larger list
 * is several imports, which is also how a person would want to undo it.
 */
export const createImportSchema = z.strictObject({
  id: idSchema.optional(),
  deckId: idSchema,
  source: z.string().trim().min(1).max(200),
  format: z.enum(['json', 'csv', 'tsv', 'apkg', 'manual']).optional(),
  notes: z
    .array(createNoteSchema.omit({ deckId: true, importBatchId: true }))
    .min(1)
    .max(2000),
});

export type CreatePresetBody = z.infer<typeof createPresetSchema>;
export type UpdatePresetBody = z.infer<typeof updatePresetSchema>;
export type CreateImportBody = z.infer<typeof createImportSchema>;

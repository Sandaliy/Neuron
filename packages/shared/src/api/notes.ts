import { z } from 'zod';

import { noteStatusSchema, noteTypeSchema } from '../note-types.js';

import { cardStateSchema } from './cards.js';
import { cursorSchema, idSchema, tagSchema } from './common.js';

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

/**
 * How a list of notes is ordered.
 *
 * `created` is the order they arrived in, which for an import is the order of
 * the file and therefore usually the order of the lesson. `alpha` is by the
 * word itself. `rank` is by frequency, so an unfinished list of five thousand
 * still teaches the most useful eight hundred rather than a random eight
 * hundred.
 */
export const NOTE_SORTS = ['created', 'alpha', 'rank'] as const;

export const noteSortSchema = z.enum(NOTE_SORTS);

export type NoteSort = z.infer<typeof noteSortSchema>;

/**
 * How many notes one page may hold.
 *
 * Higher than everything else in the api, and deliberately. A deck of five
 * thousand words at two hundred a page is twenty five round trips before the
 * list is complete, which on a cold function is most of a minute. The rows are
 * small, so the larger page is cheaper than the latency it removes.
 */
export const MAX_NOTE_PAGE_SIZE = 1000;

export const noteLimitSchema = z.coerce.number().int().min(1).max(MAX_NOTE_PAGE_SIZE);

export const listNotesSchema = z.strictObject({
  deckId: idSchema.optional(),
  /** Whether the decks under `deckId` count as well. Default is that they do. */
  subtree: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  status: noteStatusSchema.optional(),
  tag: tagSchema.optional(),
  /** Where the notes came from, as it was recorded on the import. */
  source: z.string().trim().min(1).max(200).optional(),
  /** Notes that have at least one card in this state. */
  cardState: cardStateSchema.optional(),
  /** Matches the term, the translation and the tags, case insensitively. */
  search: z.string().trim().min(1).max(100).optional(),
  sort: noteSortSchema.default('created'),
  limit: noteLimitSchema.optional(),
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
    /**
     * Changing the type, which is the one edit that can destroy a card.
     *
     * A word turned into a cloze sentence can no longer be asked the way it was
     * being asked, so its cards go and their schedules go with them. Everything
     * else about an edit keeps every card it had.
     */
    noteType: noteTypeSchema.optional(),
    /**
     * Permission to remove cards that have been answered.
     *
     * Without it the api refuses an edit that would throw away review history,
     * which makes the confirmation a rule rather than a habit of one screen.
     */
    discardCards: z.boolean().optional(),
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
/** How many notes one bulk request may name. */
export const BULK_LIMIT = 500;

const bulkIds = z.array(idSchema).min(1).max(BULK_LIMIT);

export const bulkStatusSchema = z.strictObject({
  ids: bulkIds,
  status: noteStatusSchema,
});

/** Moving a selection into another deck, cards and all. */
export const bulkMoveSchema = z.strictObject({
  ids: bulkIds,
  deckId: idSchema,
});

/**
 * Adding and removing tags across a selection.
 *
 * Both at once, because "replace one tag with another" is one action to the
 * person doing it and two requests is how it becomes half done.
 */
export const bulkTagsSchema = z
  .strictObject({
    ids: bulkIds,
    add: z.array(tagSchema).max(20).optional(),
    remove: z.array(tagSchema).max(20).optional(),
  })
  .refine(
    (value) => (value.add?.length ?? 0) + (value.remove?.length ?? 0) > 0,
    'needs a tag to add or remove',
  );

export const bulkDeleteSchema = z.strictObject({ ids: bulkIds });

export type CreateNoteBody = z.infer<typeof createNoteSchema>;
export type UpdateNoteBody = z.infer<typeof updateNoteSchema>;
export type ListNotesQuery = z.infer<typeof listNotesSchema>;
export type BulkStatusBody = z.infer<typeof bulkStatusSchema>;
export type BulkMoveBody = z.infer<typeof bulkMoveSchema>;
export type BulkTagsBody = z.infer<typeof bulkTagsSchema>;
export type BulkDeleteBody = z.infer<typeof bulkDeleteSchema>;

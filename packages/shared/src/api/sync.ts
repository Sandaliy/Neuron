import { z } from 'zod';

import { deckSettingsSchema } from '../deck-settings.js';
import { noteStatusSchema, noteTypeSchema } from '../note-types.js';

import {
  idSchema,
  instantSchema,
  limitSchema,
  nameSchema,
  revisionSchema,
  tagSchema,
} from './common.js';
import { restoreNoteResultSchema } from './notes.js';
import { submitReviewSchema } from './reviews.js';

/**
 * Sync: one revision stream out, one batch of changes in.
 *
 * Every table a user owns carries `rev`, the value of that user's counter when
 * the row was last written. Pulling is therefore "everything above the number I
 * last saw", in one ordered stream across all the tables, which is what lets a
 * client resume a download that was cut off halfway.
 *
 * Pushing is two different problems wearing one coat, so they travel in two
 * lists. Entities are rows that can be edited twice, so one edit has to lose,
 * and the losing version is written to a conflict log rather than dropped.
 * Reviews cannot conflict at all: they are appended, and the same id arriving
 * twice is the same fact arriving twice.
 */

/** The tables that take part, named as the protocol names them. */
export const SYNC_ENTITIES = [
  'decks',
  'notes',
  'cards',
  'studyPresets',
  'importBatches',
  'reviews',
] as const;

export const syncEntitySchema = z.enum(SYNC_ENTITIES);

export type SyncEntity = z.infer<typeof syncEntitySchema>;

export const pullSyncSchema = z.strictObject({
  /** Zero, or absent, means everything. */
  since: revisionSchema.optional(),
  limit: limitSchema.optional(),
});

export const syncRowSchema = z.object({
  entity: syncEntitySchema,
  id: idSchema,
  rev: z.number().int(),
  /** True when the row is soft deleted, so the client can drop its copy. */
  deleted: z.boolean(),
  row: z.record(z.string(), z.unknown()),
});

export const pullSyncResultSchema = z.object({
  /** What the client asked from. */
  since: z.number().int(),
  /**
   * How far this page reaches. The client stores it and asks from here next
   * time, whether or not there is more.
   */
  revision: z.number().int(),
  /** True when there is another page. */
  hasMore: z.boolean(),
  changes: z.array(syncRowSchema),
});

/**
 * What a client may push for each kind of row.
 *
 * Cards are the interesting entry. A client may suspend one and may delete one,
 * and may not touch its schedule: stability, difficulty and the due date are
 * the server's, derived from the review log, for the same reason the review
 * endpoint recomputes rather than believes. A client that could push a card's
 * stability would not need to forge a review at all.
 */
const deckPayload = z.strictObject({
  name: nameSchema,
  parentId: idSchema.nullish(),
  position: z.number().int().min(0).optional(),
  settings: deckSettingsSchema.nullish(),
});

const notePayload = z.strictObject({
  deckId: idSchema,
  noteType: noteTypeSchema,
  fields: z.record(z.string(), z.unknown()),
  tags: z.array(tagSchema).max(50).optional(),
  source: z.string().trim().max(200).nullish(),
  rank: z.number().int().min(0).nullish(),
  status: noteStatusSchema.optional(),
  importBatchId: idSchema.nullish(),
});

const cardPayload = z.strictObject({
  suspendedAt: instantSchema.nullish(),
});

const presetPayload = z.strictObject({
  name: nameSchema,
  deckId: idSchema.nullish(),
  config: z.record(z.string(), z.unknown()),
  isDefault: z.boolean().optional(),
});

const importPayload = z.strictObject({
  deckId: idSchema,
  source: z.string().trim().min(1).max(200),
  format: z.string().trim().min(1).max(20).optional(),
  noteCount: z.number().int().min(0).optional(),
  undoneAt: instantSchema.nullish(),
});

/**
 * One row's worth of change.
 *
 * `updatedAt` is what the two versions are compared on, and it comes from the
 * client's clock. It is clamped on arrival, never trusted: a phone whose clock
 * is a year fast would otherwise win every conflict it ever took part in, for a
 * year.
 */
function changeTo<E extends SyncEntity, P extends z.ZodType>(entity: E, payload: P) {
  return z.strictObject({
    entity: z.literal(entity),
    id: idSchema,
    updatedAt: instantSchema,
    /** True for a soft delete, in which case `data` is not read. */
    deleted: z.boolean().default(false),
    data: payload.optional(),
  });
}

export const syncChangeSchema = z.discriminatedUnion('entity', [
  changeTo('decks', deckPayload),
  changeTo('notes', notePayload),
  changeTo('cards', cardPayload),
  changeTo('studyPresets', presetPayload),
  changeTo('importBatches', importPayload),
]);

export const pushSyncSchema = z
  .strictObject({
    changes: z.array(syncChangeSchema).max(1000).default([]),
    reviews: z.array(submitReviewSchema).max(1000).default([]),
  })
  .refine(
    (value) => value.changes.length > 0 || value.reviews.length > 0,
    'needs at least one change or one review',
  );

/** Why a pushed version did not win. */
export const SYNC_OUTCOMES = ['applied', 'conflict', 'unchanged'] as const;

export const syncOutcomeSchema = z.enum(SYNC_OUTCOMES);

export const pushSyncResultSchema = z.object({
  /** Restore transitions preserve saved note fields; unrelated edits can follow after a pull. */
  noteRestorations: z.array(restoreNoteResultSchema.extend({ id: idSchema })).optional(),
  applied: z.array(z.object({ entity: syncEntitySchema, id: idSchema })),
  /**
   * The rows whose pushed version lost. Each is in the conflict log too, so
   * nothing was destroyed to produce this list.
   */
  conflicts: z.array(
    z.object({ entity: syncEntitySchema, id: idSchema, reason: z.string(), keptRev: z.number() }),
  ),
  /** Ids whose `updatedAt` was in the future and was pulled back to now. */
  clamped: z.array(idSchema),
  reviews: z.object({ applied: z.number().int(), duplicates: z.number().int() }),
  /** The user's version counter after the batch. */
  revision: z.number().int(),
});

export type PullSyncQuery = z.infer<typeof pullSyncSchema>;
export type PullSyncResult = z.infer<typeof pullSyncResultSchema>;
export type PushSyncBody = z.infer<typeof pushSyncSchema>;
export type PushSyncResult = z.infer<typeof pushSyncResultSchema>;
export type SyncChange = z.infer<typeof syncChangeSchema>;

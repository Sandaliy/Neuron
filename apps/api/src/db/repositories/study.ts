import { and, asc, desc, eq, isNull } from 'drizzle-orm';

import { uuidV7 } from '@neuron/shared';

import { importBatches, notes, studyPresets } from '../schema/index.js';

import { nextRev } from './session.js';

import type { Runner } from './session.js';

/**
 * Saved session settings, and imports that can be taken back.
 */

export type StudyPresetRow = typeof studyPresets.$inferSelect;
export type ImportBatchRow = typeof importBatches.$inferSelect;

export interface CreatePreset {
  readonly id?: string;
  readonly name: string;
  readonly config: unknown;
  readonly deckId?: string | null;
  readonly isDefault?: boolean;
}

export interface PresetRepository {
  create: (input: CreatePreset) => Promise<StudyPresetRow>;
  list: () => Promise<StudyPresetRow[]>;
  softDelete: (id: string) => Promise<boolean>;
}

export interface CreateImportBatch {
  readonly id?: string;
  readonly deckId: string;
  readonly source: string;
  readonly format?: string;
  readonly noteCount?: number;
}

export interface ImportBatchRepository {
  create: (input: CreateImportBatch) => Promise<ImportBatchRow>;
  list: () => Promise<ImportBatchRow[]>;
  /**
   * Takes an import back: every note that arrived in it is marked deleted, and
   * the batch is marked undone. Cards go with their notes through the cascade
   * on the next cleanup, and the review log is left alone, because it records
   * what happened and that did happen.
   */
  undo: (id: string) => Promise<number>;
}

export function presetRepository(userId: string, run: Runner): PresetRepository {
  return {
    async create(input) {
      return run(async (tx) => {
        const rev = await nextRev(tx, userId);

        const [row] = await tx
          .insert(studyPresets)
          .values({
            id: input.id ?? uuidV7(),
            userId,
            deckId: input.deckId ?? null,
            name: input.name.trim(),
            config: input.config,
            isDefault: input.isDefault ?? false,
            rev,
          })
          .returning();

        if (!row) {
          throw new Error('the preset was not written');
        }

        return row;
      });
    },

    async list() {
      return run(async (tx) =>
        tx
          .select()
          .from(studyPresets)
          .where(and(eq(studyPresets.userId, userId), isNull(studyPresets.deletedAt)))
          .orderBy(asc(studyPresets.name)),
      );
    },

    async softDelete(id) {
      return run(async (tx) => {
        const rev = await nextRev(tx, userId);
        const now = new Date();

        const marked = await tx
          .update(studyPresets)
          .set({ deletedAt: now, updatedAt: now, rev })
          .where(
            and(
              eq(studyPresets.userId, userId),
              eq(studyPresets.id, id),
              isNull(studyPresets.deletedAt),
            ),
          )
          .returning({ id: studyPresets.id });

        return marked.length > 0;
      });
    },
  };
}

export function importBatchRepository(userId: string, run: Runner): ImportBatchRepository {
  return {
    async create(input) {
      return run(async (tx) => {
        const rev = await nextRev(tx, userId);

        const [row] = await tx
          .insert(importBatches)
          .values({
            id: input.id ?? uuidV7(),
            userId,
            deckId: input.deckId,
            source: input.source,
            format: input.format ?? 'json',
            noteCount: input.noteCount ?? 0,
            rev,
          })
          .returning();

        if (!row) {
          throw new Error('the import batch was not written');
        }

        return row;
      });
    },

    async list() {
      return run(async (tx) =>
        tx
          .select()
          .from(importBatches)
          .where(and(eq(importBatches.userId, userId), isNull(importBatches.deletedAt)))
          .orderBy(desc(importBatches.createdAt)),
      );
    },

    async undo(id) {
      return run(async (tx) => {
        const rev = await nextRev(tx, userId);
        const now = new Date();

        const marked = await tx
          .update(notes)
          .set({ deletedAt: now, updatedAt: now, rev })
          .where(
            and(eq(notes.userId, userId), eq(notes.importBatchId, id), isNull(notes.deletedAt)),
          )
          .returning({ id: notes.id });

        await tx
          .update(importBatches)
          .set({ undoneAt: now, updatedAt: now, rev })
          .where(and(eq(importBatches.userId, userId), eq(importBatches.id, id)));

        return marked.length;
      });
    },
  };
}

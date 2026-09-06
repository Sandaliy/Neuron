import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { uuidV7 } from '@neuron/shared';

import { cards, importBatches, notes, studyPresets } from '../schema/index.js';

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

export interface UpdatePreset {
  readonly name?: string | undefined;
  readonly config?: unknown;
  readonly isDefault?: boolean | undefined;
}

export interface PresetRepository {
  create: (input: CreatePreset) => Promise<StudyPresetRow>;
  byId: (id: string) => Promise<StudyPresetRow | undefined>;
  list: () => Promise<StudyPresetRow[]>;
  update: (id: string, input: UpdatePreset) => Promise<StudyPresetRow | undefined>;
  softDelete: (id: string) => Promise<boolean>;
}

export interface CreateImportBatch {
  readonly id?: string;
  readonly deckId: string;
  readonly source: string;
  readonly format?: string;
  readonly noteCount?: number;
}

/** What an import holds, for the confirmation before it is taken back. */
export interface ImportContents {
  readonly notes: number;
  readonly cards: number;
  /** Cards in it that have been answered at least once. */
  readonly reviewedCards: number;
}

export interface ImportBatchRepository {
  /**
   * Starts a batch, or answers with the one that is already there.
   *
   * Idempotent by id, because the request that creates it is the first thing a
   * flaky connection drops, and a second batch for the same import would leave
   * half the notes attached to each and neither undo working.
   */
  create: (input: CreateImportBatch) => Promise<ImportBatchRow>;
  byId: (id: string) => Promise<ImportBatchRow | undefined>;
  list: () => Promise<ImportBatchRow[]>;
  /** Adds to the running count as chunks land. */
  addNoteCount: (id: string, added: number) => Promise<void>;
  /** What is in it, and how much of it has been answered. */
  contents: (id: string) => Promise<ImportContents>;
  /**
   * Takes an import back: every note that arrived in it is marked deleted, and
   * the batch is marked undone. Live cards are deleted with those notes in the
   * same transaction. Earlier card deletions and the review log are unchanged.
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

    async byId(id) {
      return run(async (tx) => {
        const [row] = await tx
          .select()
          .from(studyPresets)
          .where(
            and(
              eq(studyPresets.userId, userId),
              eq(studyPresets.id, id),
              isNull(studyPresets.deletedAt),
            ),
          )
          .limit(1);

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

    async update(id, input) {
      return run(async (tx) => {
        const rev = await nextRev(tx, userId);

        const [row] = await tx
          .update(studyPresets)
          .set({
            ...(input.name === undefined ? {} : { name: input.name.trim() }),
            ...(input.config === undefined ? {} : { config: input.config }),
            ...(input.isDefault === undefined ? {} : { isDefault: input.isDefault }),
            updatedAt: new Date(),
            rev,
          })
          .where(
            and(
              eq(studyPresets.userId, userId),
              eq(studyPresets.id, id),
              isNull(studyPresets.deletedAt),
            ),
          )
          .returning();

        return row;
      });
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

        const id = input.id ?? uuidV7();

        const [row] = await tx
          .insert(importBatches)
          .values({
            id,
            userId,
            deckId: input.deckId,
            source: input.source,
            format: input.format ?? 'json',
            noteCount: input.noteCount ?? 0,
            rev,
          })
          .onConflictDoNothing()
          .returning();

        if (row) {
          return row;
        }

        // Already there, which means this request has been sent before. The
        // batch that exists is the one the notes are attached to.
        const [existing] = await tx
          .select()
          .from(importBatches)
          .where(and(eq(importBatches.userId, userId), eq(importBatches.id, id)))
          .limit(1);

        if (!existing) {
          throw new Error('the import batch was not written');
        }

        return existing;
      });
    },

    async addNoteCount(id, added) {
      if (added === 0) {
        return;
      }

      await run(async (tx) => {
        await tx
          .update(importBatches)
          .set({
            noteCount: sql`${importBatches.noteCount} + ${added}`,
            updatedAt: new Date(),
          })
          .where(and(eq(importBatches.userId, userId), eq(importBatches.id, id)));
      });
    },

    async contents(id) {
      return run(async (tx) => {
        const [row] = await tx
          .select({
            notes: sql<number>`count(distinct ${notes.id})`,
            cards: sql<number>`count(${cards.id})`,
            reviewedCards: sql<number>`count(${cards.id}) filter (where ${cards.reps} > 0)`,
          })
          .from(notes)
          .leftJoin(
            cards,
            and(eq(cards.noteId, notes.id), eq(cards.userId, userId), isNull(cards.deletedAt)),
          )
          .where(
            and(eq(notes.userId, userId), eq(notes.importBatchId, id), isNull(notes.deletedAt)),
          );

        return {
          notes: Number(row?.notes ?? 0),
          cards: Number(row?.cards ?? 0),
          reviewedCards: Number(row?.reviewedCards ?? 0),
        };
      });
    },

    async byId(id) {
      return run(async (tx) => {
        const [row] = await tx
          .select()
          .from(importBatches)
          .where(
            and(
              eq(importBatches.userId, userId),
              eq(importBatches.id, id),
              isNull(importBatches.deletedAt),
            ),
          )
          .limit(1);

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

        // The cards the import generated go with their notes, in the same
        // statement rather than at the next cleanup. A card whose note is gone
        // is a question with no answer, and it would keep coming up due.
        if (marked.length > 0) {
          await tx
            .update(cards)
            .set({ deletedAt: now, deletedWithNote: true, updatedAt: now, rev })
            .where(
              and(
                eq(cards.userId, userId),
                inArray(
                  cards.noteId,
                  marked.map((row) => row.id),
                ),
                isNull(cards.deletedAt),
              ),
            );
        }

        await tx
          .update(importBatches)
          .set({ undoneAt: now, updatedAt: now, rev })
          .where(and(eq(importBatches.userId, userId), eq(importBatches.id, id)));

        return marked.length;
      });
    },
  };
}

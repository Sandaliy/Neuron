import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { parseNoteFields, uuidV7 } from '@neuron/shared';
import type { NoteFields, NoteStatus, NoteTypeName } from '@neuron/shared';

import { cards, decks, noteTypes, notes } from '../schema/index.js';

import { nextRev } from './session.js';

import type { Runner, Tx } from './session.js';

/**
 * Notes: the facts, without the cards that ask about them.
 *
 * `fields` is jsonb, so the database will store any shape at all. What makes a
 * vocab note actually have a term and a translation is the check here, run
 * before every write. It holds because this is the only code that writes to the
 * table, which is the reason nothing else is allowed to.
 */

export type NoteRow = typeof notes.$inferSelect;

export interface CreateNote {
  readonly id?: string;
  readonly deckId: string;
  readonly noteType: NoteTypeName;
  readonly fields: NoteFields;
  readonly tags?: readonly string[];
  readonly source?: string | null;
  readonly rank?: number | null;
  readonly status?: NoteStatus;
  readonly importBatchId?: string | null;
}

/** What the browse screen is asking for. */
export interface ListNotes {
  readonly deckId?: string | undefined;
  readonly includeSubtree?: boolean | undefined;
  readonly status?: NoteStatus | undefined;
  readonly tag?: string | undefined;
  readonly search?: string | undefined;
  readonly limit?: number | undefined;
  /** The id of the last note on the previous page. */
  readonly cursor?: string | undefined;
}

/** One page of notes, and where the next one starts. */
export interface NotePage {
  readonly items: NoteRow[];
  readonly nextCursor: string | undefined;
}

export interface NoteRepository {
  create: (input: CreateNote) => Promise<NoteRow>;
  createMany: (inputs: readonly CreateNote[]) => Promise<NoteRow[]>;
  byId: (id: string) => Promise<NoteRow | undefined>;
  /**
   * The browse screen: filtered, and one page at a time.
   *
   * Paged by a cursor rather than an offset. An offset skips a row whenever
   * something ahead of it is deleted between two pages, and a deck being edited
   * while it is being read is the normal case here rather than the odd one.
   * Ids are UUID version 7, so ordering by id is ordering by creation time and
   * the cursor is just the last id seen.
   */
  list: (query: ListNotes) => Promise<NotePage>;
  /** Every note in a deck and, when asked, in the decks under it. */
  inDeck: (deckId: string, options?: { readonly includeSubtree?: boolean }) => Promise<NoteRow[]>;
  updateFields: (id: string, fields: NoteFields) => Promise<NoteRow | undefined>;
  /**
   * Turns a note into another type, fields and all.
   *
   * The two move together because they have to: `vocab` fields are not valid
   * `basic` fields, so a type written without its fields leaves a row that
   * nothing can read back.
   */
  changeType: (id: string, noteType: NoteTypeName, fields: NoteFields) => Promise<NoteRow | undefined>;
  setStatus: (id: string, status: NoteStatus) => Promise<NoteRow | undefined>;
  setTags: (id: string, tags: readonly string[]) => Promise<NoteRow | undefined>;
  /**
   * The same change across many notes, in one statement and one version.
   *
   * Marking two hundred words as known after a placement test is one action to
   * the person doing it. Two hundred requests, each taking its own version
   * number, is how that action becomes a spinner and a torn sync.
   */
  setStatusMany: (ids: readonly string[], status: NoteStatus) => Promise<number>;
  /**
   * Moves a note to another deck, taking its cards with it.
   *
   * The cards carry a copy of the deck for the sake of two queries that run on
   * every app open. This is the one place that copy can go out of step, so it
   * is the one place that has to move both, in one transaction.
   */
  moveToDeck: (id: string, deckId: string) => Promise<NoteRow | undefined>;
  softDelete: (id: string) => Promise<boolean>;
  /** Takes back one delete, bringing the note's cards with it. */
  restore: (id: string) => Promise<boolean>;
}

/** The note type named on a write does not exist, or is not readable. */
export class UnknownNoteType extends Error {
  override readonly name = 'UnknownNoteType';

  constructor(name: string) {
    super(`no note type called ${name}`);
  }
}

/**
 * Finds the id of a note type by its name.
 *
 * The three built in types have no owner and are readable by everyone, which
 * the isolation policy on that table allows for explicitly.
 *
 * @param tx the transaction
 * @param name the type name
 * @returns the row id
 */
async function noteTypeId(tx: Tx, name: string): Promise<string> {
  const [row] = await tx
    .select({ id: noteTypes.id })
    .from(noteTypes)
    .where(and(eq(noteTypes.name, name), isNull(noteTypes.deletedAt)))
    .limit(1);

  if (!row) {
    throw new UnknownNoteType(name);
  }

  return row.id;
}

export function noteRepository(userId: string, run: Runner): NoteRepository {
  async function insert(tx: Tx, inputs: readonly CreateNote[], rev: number): Promise<NoteRow[]> {
    const typeIds = new Map<string, string>();

    for (const input of inputs) {
      if (!typeIds.has(input.noteType)) {
        typeIds.set(input.noteType, await noteTypeId(tx, input.noteType));
      }
    }

    const values = inputs.map((input) => ({
      id: input.id ?? uuidV7(),
      userId,
      deckId: input.deckId,
      noteTypeId: typeIds.get(input.noteType) ?? '',
      // The write is refused here rather than by the database, because Postgres
      // has no opinion about what belongs in a jsonb column.
      fields: parseNoteFields(input.noteType, input.fields),
      tags: [...(input.tags ?? [])],
      source: input.source ?? null,
      rank: input.rank ?? null,
      status: input.status ?? 'active',
      importBatchId: input.importBatchId ?? null,
      rev,
    }));

    return tx.insert(notes).values(values).returning();
  }

  return {
    async create(input) {
      return run(async (tx) => {
        const rev = await nextRev(tx, userId);
        const [row] = await insert(tx, [input], rev);

        if (!row) {
          throw new Error('the note was not written');
        }

        return row;
      });
    },

    async createMany(inputs) {
      if (inputs.length === 0) {
        return [];
      }

      return run(async (tx) => {
        const rev = await nextRev(tx, userId);
        const written: NoteRow[] = [];

        // In batches, because an import can be thousands of rows and one
        // statement carrying all of them runs into the parameter limit.
        for (let start = 0; start < inputs.length; start += 200) {
          written.push(...(await insert(tx, inputs.slice(start, start + 200), rev)));
        }

        return written;
      });
    },

    async byId(id) {
      return run(async (tx) => {
        const [row] = await tx
          .select()
          .from(notes)
          .where(and(eq(notes.userId, userId), eq(notes.id, id), isNull(notes.deletedAt)))
          .limit(1);

        return row;
      });
    },

    async list(query) {
      return run(async (tx) => {
        const limit = Math.min(query.limit ?? 50, 200);
        const conditions = [eq(notes.userId, userId), isNull(notes.deletedAt)];

        if (query.deckId !== undefined) {
          if (query.includeSubtree === false) {
            conditions.push(eq(notes.deckId, query.deckId));
          } else {
            const under = tx
              .select({ id: decks.id })
              .from(decks)
              .where(
                and(
                  eq(decks.userId, userId),
                  isNull(decks.deletedAt),
                  sql`(${decks.id} = ${query.deckId} or ${decks.path} @> array[${query.deckId}]::uuid[])`,
                ),
              );

            conditions.push(inArray(notes.deckId, under));
          }
        }

        if (query.status !== undefined) {
          conditions.push(eq(notes.status, query.status));
        }

        if (query.tag !== undefined) {
          conditions.push(sql`${notes.tags} @> array[${query.tag}]::text[]`);
        }

        if (query.search !== undefined) {
          // Across the whole of `fields` rather than one named column, because
          // the columns differ by note type and a person searching for a word
          // does not care whether it was the term or the example it appeared
          // in. It is a scan, and at the size a person's own collection reaches
          // that is cheaper than the index it would take to avoid one.
          conditions.push(sql`${notes.fields}::text ilike ${`%${query.search}%`}`);
        }

        if (query.cursor !== undefined) {
          conditions.push(sql`${notes.id} > ${query.cursor}::uuid`);
        }

        // One more than asked for, so that "is there another page" is answered
        // by looking rather than by counting the whole table.
        const rows = await tx
          .select()
          .from(notes)
          .where(and(...conditions))
          .orderBy(asc(notes.id))
          .limit(limit + 1);

        const items = rows.slice(0, limit);

        return {
          items,
          nextCursor: rows.length > limit ? items.at(-1)?.id : undefined,
        };
      });
    },

    async inDeck(deckId, options) {
      return run(async (tx) => {
        if (!options?.includeSubtree) {
          return tx
            .select()
            .from(notes)
            .where(and(eq(notes.userId, userId), eq(notes.deckId, deckId), isNull(notes.deletedAt)))
            .orderBy(asc(notes.rank), asc(notes.createdAt));
        }

        const under = tx
          .select({ id: decks.id })
          .from(decks)
          .where(
            and(
              eq(decks.userId, userId),
              isNull(decks.deletedAt),
              sql`(${decks.id} = ${deckId} or ${decks.path} @> array[${deckId}]::uuid[])`,
            ),
          );

        return tx
          .select()
          .from(notes)
          .where(
            and(eq(notes.userId, userId), isNull(notes.deletedAt), inArray(notes.deckId, under)),
          )
          .orderBy(asc(notes.rank), asc(notes.createdAt));
      });
    },

    async updateFields(id, fields) {
      return run(async (tx) => {
        const [existing] = await tx
          .select({ typeName: noteTypes.name })
          .from(notes)
          .innerJoin(noteTypes, eq(noteTypes.id, notes.noteTypeId))
          .where(and(eq(notes.userId, userId), eq(notes.id, id), isNull(notes.deletedAt)))
          .limit(1);

        if (!existing) {
          return undefined;
        }

        const rev = await nextRev(tx, userId);

        const [row] = await tx
          .update(notes)
          .set({
            fields: parseNoteFields(existing.typeName as NoteTypeName, fields),
            updatedAt: new Date(),
            rev,
          })
          .where(and(eq(notes.userId, userId), eq(notes.id, id)))
          .returning();

        return row;
      });
    },

    async changeType(id, noteType, fields) {
      return run(async (tx) => {
        const typeId = await noteTypeId(tx, noteType);
        const rev = await nextRev(tx, userId);

        const [row] = await tx
          .update(notes)
          .set({
            noteTypeId: typeId,
            fields: parseNoteFields(noteType, fields),
            updatedAt: new Date(),
            rev,
          })
          .where(and(eq(notes.userId, userId), eq(notes.id, id), isNull(notes.deletedAt)))
          .returning();

        return row;
      });
    },

    async setStatus(id, status) {
      return run(async (tx) => {
        const rev = await nextRev(tx, userId);

        const [row] = await tx
          .update(notes)
          .set({ status, updatedAt: new Date(), rev })
          .where(and(eq(notes.userId, userId), eq(notes.id, id), isNull(notes.deletedAt)))
          .returning();

        return row;
      });
    },

    async setTags(id, tags) {
      return run(async (tx) => {
        const rev = await nextRev(tx, userId);

        const [row] = await tx
          .update(notes)
          // Deduplicated and ordered, so two notes tagged with the same three
          // words in a different order read the same in a list.
          .set({ tags: [...new Set(tags)].sort(), updatedAt: new Date(), rev })
          .where(and(eq(notes.userId, userId), eq(notes.id, id), isNull(notes.deletedAt)))
          .returning();

        return row;
      });
    },

    async setStatusMany(ids, status) {
      if (ids.length === 0) {
        return 0;
      }

      return run(async (tx) => {
        const rev = await nextRev(tx, userId);

        const changed = await tx
          .update(notes)
          .set({ status, updatedAt: new Date(), rev })
          .where(
            and(
              eq(notes.userId, userId),
              inArray(notes.id, [...new Set(ids)]),
              isNull(notes.deletedAt),
            ),
          )
          .returning({ id: notes.id });

        return changed.length;
      });
    },

    async moveToDeck(id, deckId) {
      return run(async (tx) => {
        const rev = await nextRev(tx, userId);
        const now = new Date();

        const [row] = await tx
          .update(notes)
          .set({ deckId, updatedAt: now, rev })
          .where(and(eq(notes.userId, userId), eq(notes.id, id), isNull(notes.deletedAt)))
          .returning();

        if (!row) {
          return undefined;
        }

        await tx
          .update(cards)
          .set({ deckId, updatedAt: now, rev })
          .where(and(eq(cards.userId, userId), eq(cards.noteId, id), isNull(cards.deletedAt)));

        return row;
      });
    },

    async softDelete(id) {
      return run(async (tx) => {
        const rev = await nextRev(tx, userId);
        const now = new Date();

        const marked = await tx
          .update(notes)
          .set({ deletedAt: now, updatedAt: now, rev })
          .where(and(eq(notes.userId, userId), eq(notes.id, id), isNull(notes.deletedAt)))
          .returning({ id: notes.id });

        // A note with no cards is invisible, and a card whose note is gone is a
        // question with no answer. They are deleted together.
        if (marked.length > 0) {
          await tx
            .update(cards)
            .set({ deletedAt: now, updatedAt: now, rev })
            .where(and(eq(cards.userId, userId), eq(cards.noteId, id), isNull(cards.deletedAt)));
        }

        return marked.length > 0;
      });
    },

    async restore(id) {
      return run(async (tx) => {
        const [note] = await tx
          .select({ deletedAt: notes.deletedAt })
          .from(notes)
          .where(and(eq(notes.userId, userId), eq(notes.id, id)))
          .limit(1);

        if (!note?.deletedAt) {
          return false;
        }

        const rev = await nextRev(tx, userId);
        const now = new Date();

        await tx
          .update(notes)
          .set({ deletedAt: null, updatedAt: now, rev })
          .where(and(eq(notes.userId, userId), eq(notes.id, id)));

        // Only the cards that went with the note. One deleted on its own
        // beforehand was deleted on purpose and stays that way.
        await tx
          .update(cards)
          .set({ deletedAt: null, updatedAt: now, rev })
          .where(
            and(
              eq(cards.userId, userId),
              eq(cards.noteId, id),
              eq(cards.deletedAt, note.deletedAt),
            ),
          );

        return true;
      });
    },
  };
}

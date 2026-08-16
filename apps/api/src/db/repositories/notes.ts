import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { CardState } from '@neuron/core';
import { MAX_NOTE_PAGE_SIZE, parseNoteFields, uuidV7 } from '@neuron/shared';
import type { NoteFields, NoteSort, NoteStatus, NoteTypeName } from '@neuron/shared';

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
  /** Where the notes came from, as it was recorded on the import. */
  readonly source?: string | undefined;
  /** Notes holding at least one card in this state. */
  readonly cardState?: CardState | undefined;
  readonly search?: string | undefined;
  readonly sort?: NoteSort | undefined;
  readonly limit?: number | undefined;
  /** The id of the last note on the previous page. */
  readonly cursor?: string | undefined;
}

/** A note the library already holds, for the importer to offer a choice about. */
export interface DuplicateRow {
  readonly id: string;
  readonly deckId: string;
  readonly termKey: string;
  readonly fields: NoteFields;
}

/** One page of notes, and where the next one starts. */
export interface NotePage {
  readonly items: NoteRow[];
  readonly nextCursor: string | undefined;
}

export interface NoteRepository {
  create: (input: CreateNote) => Promise<NoteRow>;
  /**
   * Writes many notes at once.
   *
   * With `skipExisting`, a note whose id is already there is left alone and is
   * not returned. That is what makes a chunk of an import safe to send twice:
   * the retry writes nothing and creates no second set of cards.
   */
  createMany: (
    inputs: readonly CreateNote[],
    options?: { readonly skipExisting?: boolean },
  ) => Promise<NoteRow[]>;
  /**
   * Which of these words the library already holds.
   *
   * One query for the whole list, matched against the indexed generated column,
   * because an import of five thousand rows cannot become five thousand
   * queries. Across every deck, since a word already learned somewhere else is
   * exactly the duplicate worth knowing about.
   */
  duplicatesOf: (termKeys: readonly string[]) => Promise<DuplicateRow[]>;
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
  changeType: (
    id: string,
    noteType: NoteTypeName,
    fields: NoteFields,
  ) => Promise<NoteRow | undefined>;
  setStatus: (id: string, status: NoteStatus) => Promise<NoteRow | undefined>;
  setTags: (id: string, tags: readonly string[]) => Promise<NoteRow | undefined>;
  /** Moves a selection into another deck, taking every card with them. */
  moveMany: (ids: readonly string[], deckId: string) => Promise<number>;
  /**
   * Adds and removes tags across a selection, in one statement.
   *
   * Both directions at once, because replacing one tag with another is one
   * action to the person doing it and two requests is how it ends up half done.
   */
  tagMany: (
    ids: readonly string[],
    change: { readonly add?: readonly string[]; readonly remove?: readonly string[] },
  ) => Promise<number>;
  /** Deletes a selection, cards and all. */
  softDeleteMany: (ids: readonly string[]) => Promise<number>;
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

/**
 * The rank a note with no rank sorts as.
 *
 * Postgres puts nulls last on an ascending sort anyway, but a null in a row
 * comparison makes the whole comparison null, which silently drops every page
 * after the first. Folding it to a real number keeps the cursor working.
 */
const NO_RANK = 2_147_483_647;

/** The columns each sort orders by, always ending in the id so it is total. */
function order(sort: NoteSort) {
  switch (sort) {
    case 'alpha': {
      return [asc(notes.termKey), asc(notes.id)];
    }

    case 'rank': {
      return [asc(sql`coalesce(${notes.rank}, ${NO_RANK})`), asc(notes.id)];
    }

    default: {
      // Ids are UUID version 7, so ordering by id is ordering by creation time.
      return [asc(notes.id)];
    }
  }
}

/**
 * Where the next page carries on from.
 *
 * The cursor is the last id seen, and the value it sorted by is read back out
 * of that row rather than carried in the cursor. A cursor holding a two hundred
 * character word and a uuid does not fit in a query string anybody wants to
 * look at, and the extra index lookup is one row.
 *
 * @param sort which order the page is in
 * @param cursor the last id of the previous page
 * @returns the condition that skips everything up to and including it
 */
function after(sort: NoteSort, cursor: string) {
  switch (sort) {
    case 'alpha': {
      return sql`(${notes.termKey}, ${notes.id}) > ((select n.term_key from notes n where n.id = ${cursor}::uuid), ${cursor}::uuid)`;
    }

    case 'rank': {
      return sql`(coalesce(${notes.rank}, ${NO_RANK}), ${notes.id}) > ((select coalesce(n.rank, ${NO_RANK}) from notes n where n.id = ${cursor}::uuid), ${cursor}::uuid)`;
    }

    default: {
      return sql`${notes.id} > ${cursor}::uuid`;
    }
  }
}

/** Makes a search term literal, so a typed `%` matches a `%`. */
function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
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
  async function insert(
    tx: Tx,
    inputs: readonly CreateNote[],
    rev: number,
    skipExisting = false,
  ): Promise<NoteRow[]> {
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

    if (!skipExisting) {
      return tx.insert(notes).values(values).returning();
    }

    // Nothing is updated on a conflict. A chunk arriving twice means the first
    // one landed, and the rows it wrote are the truth; overwriting them with
    // the same values would only move the version number and make sync think
    // something changed.
    return tx.insert(notes).values(values).onConflictDoNothing().returning();
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

    async createMany(inputs, options) {
      if (inputs.length === 0) {
        return [];
      }

      return run(async (tx) => {
        const rev = await nextRev(tx, userId);
        const written: NoteRow[] = [];

        // In batches, because an import can be thousands of rows and one
        // statement carrying all of them runs into the parameter limit.
        for (let start = 0; start < inputs.length; start += 200) {
          written.push(
            ...(await insert(
              tx,
              inputs.slice(start, start + 200),
              rev,
              options?.skipExisting ?? false,
            )),
          );
        }

        return written;
      });
    },

    async duplicatesOf(termKeys) {
      if (termKeys.length === 0) {
        return [];
      }

      return run(async (tx) => {
        const wanted = [...new Set(termKeys)].filter((key) => key !== '');

        if (wanted.length === 0) {
          return [];
        }

        const rows = await tx
          .select({
            id: notes.id,
            deckId: notes.deckId,
            termKey: notes.termKey,
            fields: notes.fields,
          })
          .from(notes)
          .where(
            and(eq(notes.userId, userId), isNull(notes.deletedAt), inArray(notes.termKey, wanted)),
          );

        return rows.map((row) => ({ ...row, termKey: row.termKey ?? '' }));
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
        const limit = Math.min(query.limit ?? 50, MAX_NOTE_PAGE_SIZE);
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

        if (query.source !== undefined) {
          conditions.push(eq(notes.source, query.source));
        }

        if (query.cardState !== undefined) {
          // An exists rather than a join, so a note with three cards in that
          // state comes back once rather than three times.
          conditions.push(
            sql`exists (select 1 from cards c where c.note_id = ${notes.id} and c.state = ${query.cardState} and c.deleted_at is null)`,
          );
        }

        if (query.search !== undefined) {
          const pattern = `%${escapeLike(query.search)}%`;

          // Across the whole of `fields` rather than one named column, because
          // the columns differ by note type and a person searching for a word
          // does not care whether it was the term or the example it appeared
          // in. Tags are a column of their own, so they are asked separately.
          // It is a scan, and at the size a person's own collection reaches
          // that is cheaper than the index it would take to avoid one.
          conditions.push(
            sql`(${notes.fields}::text ilike ${pattern} escape '\' or array_to_string(${notes.tags}, ' ') ilike ${pattern} escape '\')`,
          );
        }

        if (query.cursor !== undefined) {
          conditions.push(after(query.sort ?? 'created', query.cursor));
        }

        // One more than asked for, so that "is there another page" is answered
        // by looking rather than by counting the whole table.
        const rows = await tx
          .select()
          .from(notes)
          .where(and(...conditions))
          .orderBy(...order(query.sort ?? 'created'))
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

    async moveMany(ids, deckId) {
      if (ids.length === 0) {
        return 0;
      }

      return run(async (tx) => {
        const unique = [...new Set(ids)];
        const rev = await nextRev(tx, userId);
        const now = new Date();

        const moved = await tx
          .update(notes)
          .set({ deckId, updatedAt: now, rev })
          .where(and(eq(notes.userId, userId), inArray(notes.id, unique), isNull(notes.deletedAt)))
          .returning({ id: notes.id });

        // The cards carry a copy of the deck, and this is one of the two places
        // that copy can go out of step. Both move, in the same transaction.
        if (moved.length > 0) {
          await tx
            .update(cards)
            .set({ deckId, updatedAt: now, rev })
            .where(
              and(
                eq(cards.userId, userId),
                inArray(
                  cards.noteId,
                  moved.map((row) => row.id),
                ),
                isNull(cards.deletedAt),
              ),
            );
        }

        return moved.length;
      });
    },

    async tagMany(ids, change) {
      if (ids.length === 0) {
        return 0;
      }

      return run(async (tx) => {
        const unique = [...new Set(ids)];
        const add = [...new Set(change.add ?? [])];
        const remove = new Set(change.remove ?? []);
        const rev = await nextRev(tx, userId);
        const now = new Date();

        const rows = await tx
          .select({ id: notes.id, tags: notes.tags })
          .from(notes)
          .where(and(eq(notes.userId, userId), inArray(notes.id, unique), isNull(notes.deletedAt)));

        let changed = 0;

        for (const row of rows) {
          const next = [...new Set([...row.tags, ...add])].filter((tag) => !remove.has(tag)).sort();

          // Nothing is written for a note that already reads that way. It keeps
          // a bulk tag off two hundred rows that did not need it, and keeps the
          // version number from moving for no reason.
          if (
            next.length === row.tags.length &&
            next.every((tag, index) => tag === row.tags[index])
          ) {
            continue;
          }

          await tx
            .update(notes)
            .set({ tags: next, updatedAt: now, rev })
            .where(and(eq(notes.userId, userId), eq(notes.id, row.id)));

          changed += 1;
        }

        return changed;
      });
    },

    async softDeleteMany(ids) {
      if (ids.length === 0) {
        return 0;
      }

      return run(async (tx) => {
        const unique = [...new Set(ids)];
        const rev = await nextRev(tx, userId);
        const now = new Date();

        const marked = await tx
          .update(notes)
          .set({ deletedAt: now, updatedAt: now, rev })
          .where(and(eq(notes.userId, userId), inArray(notes.id, unique), isNull(notes.deletedAt)))
          .returning({ id: notes.id });

        if (marked.length > 0) {
          await tx
            .update(cards)
            .set({ deletedAt: now, updatedAt: now, rev })
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

        return marked.length;
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

import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';

import type { CardDirection, SchedulingState } from '@neuron/core';
import { uuidV7 } from '@neuron/shared';

import { cards, decks, notes } from '../schema/index.js';

import { fromSchedulingState, toSchedulingState } from './mapping.js';
import { nextRev } from './session.js';

import type { Runner, Tx } from './session.js';


/**
 * Cards: one direction of asking about a note, each on its own schedule.
 */

export type CardRow = typeof cards.$inferSelect;

export interface CreateCard {
  readonly id?: string;
  readonly noteId: string;
  readonly direction: CardDirection;
  /** When the card should first come up. Usually now. */
  readonly due: Date;
  /** When this direction opened, for the ladder. */
  readonly unlockedAt?: Date | null;
  /** Only for a card being restored from an existing state, such as a seed. */
  readonly scheduling?: SchedulingState;
}

export interface DueQuery {
  readonly now: Date;
  readonly limit?: number;
  /** Restrict to one deck and everything under it. */
  readonly deckId?: string;
}

export interface CardRepository {
  create: (input: CreateCard) => Promise<CardRow>;
  createMany: (inputs: readonly CreateCard[]) => Promise<CardRow[]>;
  byId: (id: string) => Promise<CardRow | undefined>;
  forNote: (noteId: string) => Promise<CardRow[]>;
  /** The query the application runs on every open. */
  due: (query: DueQuery) => Promise<CardRow[]>;
  /** Writes a scheduling state straight onto a card. */
  putState: (id: string, state: SchedulingState) => Promise<CardRow | undefined>;
  softDelete: (id: string) => Promise<boolean>;
}

const DEFAULT_DUE_LIMIT = 200;

/** A card was asked for against a note that is not there. */
export class NoteNotFound extends Error {
  override readonly name = 'NoteNotFound';

  constructor(id: string) {
    super(`no note ${id}`);
  }
}

export function cardRepository(userId: string, run: Runner): CardRepository {
  /**
   * Which deck each of these notes is in.
   *
   * The card carries a copy of its note's deck, so creating one has to read it
   * rather than take it on trust from the caller. Taking it from the caller is
   * how the two get out of step on the very first write.
   */
  async function decksOfNotes(tx: Tx, noteIds: readonly string[]): Promise<Map<string, string>> {
    const rows = await tx
      .select({ id: notes.id, deckId: notes.deckId })
      .from(notes)
      .where(and(eq(notes.userId, userId), inArray(notes.id, [...new Set(noteIds)])));

    return new Map(rows.map((row) => [row.id, row.deckId]));
  }

  function toValues(input: CreateCard, deckId: string, rev: number) {
    const scheduling = input.scheduling
      ? fromSchedulingState(input.scheduling)
      : {
          state: 'new' as const,
          stability: null,
          difficulty: null,
          due: input.due,
          lastReview: null,
          reps: 0,
          lapses: 0,
          learningStep: 0,
        };

    return {
      id: input.id ?? uuidV7(),
      userId,
      noteId: input.noteId,
      deckId,
      direction: input.direction,
      ...scheduling,
      placedDue: scheduling.state === 'new' ? null : scheduling.due,
      unlockedAt: input.unlockedAt ?? null,
      rev,
    };
  }

  return {
    async create(input) {
      return run(async (tx) => {
        const deckId = (await decksOfNotes(tx, [input.noteId])).get(input.noteId);

        if (deckId === undefined) {
          throw new NoteNotFound(input.noteId);
        }

        const rev = await nextRev(tx, userId);
        const [row] = await tx.insert(cards).values(toValues(input, deckId, rev)).returning();

        if (!row) {
          throw new Error('the card was not written');
        }

        return row;
      });
    },

    async createMany(inputs) {
      if (inputs.length === 0) {
        return [];
      }

      return run(async (tx) => {
        const deckIds = await decksOfNotes(
          tx,
          inputs.map((input) => input.noteId),
        );
        const rev = await nextRev(tx, userId);
        const written: CardRow[] = [];

        for (let start = 0; start < inputs.length; start += 200) {
          const batch = inputs.slice(start, start + 200).map((input) => {
            const deckId = deckIds.get(input.noteId);

            if (deckId === undefined) {
              throw new NoteNotFound(input.noteId);
            }

            return toValues(input, deckId, rev);
          });

          written.push(...(await tx.insert(cards).values(batch).returning()));
        }

        return written;
      });
    },

    async byId(id) {
      return run(async (tx) => {
        const [row] = await tx
          .select()
          .from(cards)
          .where(and(eq(cards.userId, userId), eq(cards.id, id), isNull(cards.deletedAt)))
          .limit(1);

        return row;
      });
    },

    async forNote(noteId) {
      return run(async (tx) =>
        tx
          .select()
          .from(cards)
          .where(and(eq(cards.userId, userId), eq(cards.noteId, noteId), isNull(cards.deletedAt)))
          .orderBy(asc(cards.direction)),
      );
    },

    async due(query) {
      return run(async (tx) => {
        const limit = query.limit ?? DEFAULT_DUE_LIMIT;
        const ready = and(
          eq(cards.userId, userId),
          isNull(cards.deletedAt),
          lte(cards.due, query.now),
        );

        if (query.deckId === undefined) {
          return tx.select().from(cards).where(ready).orderBy(asc(cards.due)).limit(limit);
        }

        // The deck is on the card, so this reads one table. It used to join
        // through notes, which cost three times as much on a collection of
        // fifty thousand. The subtree still comes from the deck tree, since
        // that is where the shape of the tree lives.
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

        return tx
          .select()
          .from(cards)
          .where(and(ready, inArray(cards.deckId, under)))
          .orderBy(asc(cards.due))
          .limit(limit);
      });
    },

    async putState(id, state) {
      return run(async (tx) => {
        const rev = await nextRev(tx, userId);
        const columns = fromSchedulingState(state);

        const [row] = await tx
          .update(cards)
          .set({ ...columns, placedDue: columns.due, updatedAt: new Date(), rev })
          .where(and(eq(cards.userId, userId), eq(cards.id, id), isNull(cards.deletedAt)))
          .returning();

        return row;
      });
    },

    async softDelete(id) {
      return run(async (tx) => {
        const rev = await nextRev(tx, userId);
        const now = new Date();

        const marked = await tx
          .update(cards)
          .set({ deletedAt: now, updatedAt: now, rev })
          .where(and(eq(cards.userId, userId), eq(cards.id, id), isNull(cards.deletedAt)))
          .returning({ id: cards.id });

        return marked.length > 0;
      });
    },
  };
}

/** Reads the scheduling half of a card row as the scheduler sees it. */
export function schedulingOf(row: CardRow): SchedulingState {
  return toSchedulingState(row);
}

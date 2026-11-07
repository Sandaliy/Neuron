import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';

import type { CardDirection, SchedulingState } from '@neuron/core';
import { uuidV7 } from '@neuron/shared';
import type { UnlockReason } from '@neuron/shared';

import { cards, decks, notes, user } from '../schema/index.js';

import { fromSchedulingState, toSchedulingState } from './mapping.js';
import { sweepProgression } from './progression.js';
import { requireLiveDeck, RestoreDependency } from './restoration.js';
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
  /** Which gap this card hides, on a cloze note. Zero everywhere else. */
  readonly slot?: number;
  /** When the card should first come up. Usually now. */
  readonly due: Date;
  /** When this direction opened, for the ladder. */
  readonly unlockedAt?: Date | null;
  /** How it opened; see `cards.unlock_reason`. */
  readonly unlockReason?: UnlockReason | null;
  /** The answer whose stability opened it, for progression only. */
  readonly unlockedByReviewId?: string | null;
  /** Only for a card being restored from an existing state, such as a seed. */
  readonly scheduling?: SchedulingState;
}

export interface DueQuery {
  readonly now: Date;
  readonly limit?: number;
  /** Restrict to one deck and everything under it. */
  readonly deckId?: string;
}

export interface SessionCardsQuery {
  readonly deckIds?: readonly string[];
  /** Restrict to one deck or folder and everything below it. */
  readonly deckId?: string;
}

/** How much work one deck is holding, before the tree is rolled up. */
export interface DeckCount {
  readonly nextDue?: string | null;
  readonly deckId: string;
  /** Answered at least once and waiting now. */
  readonly due: number;
  /** Never answered. */
  readonly fresh: number;
}

export interface CardRepository {
  create: (input: CreateCard) => Promise<CardRow>;
  createMany: (inputs: readonly CreateCard[]) => Promise<CardRow[]>;
  byId: (id: string) => Promise<CardRow | undefined>;
  forNote: (noteId: string) => Promise<CardRow[]>;
  /** The query the application runs on every open. */
  due: (query: DueQuery) => Promise<CardRow[]>;
  /** Every live, unsuspended card needed for planning and forecasting a session. */
  forSession: (query: SessionCardsQuery) => Promise<CardRow[]>;
  /**
   * What each deck is holding, in one statement for the whole collection.
   *
   * One query rather than one per deck, and the rolling up of a subtree happens
   * in the caller from the `path` arrays it already has. The measurement in
   * phase 3 made this the slowest query in the schema at fifty thousand cards,
   * so a version that ran once per deck would be felt on the first screen of
   * the app.
   */
  countsByDeck: (now: Date) => Promise<DeckCount[]>;
  /** Writes a scheduling state straight onto a card. */
  putState: (id: string, state: SchedulingState) => Promise<CardRow | undefined>;
  /** Puts a card aside without deleting it or disturbing its schedule. */
  suspend: (id: string) => Promise<CardRow | undefined>;
  unsuspend: (id: string) => Promise<CardRow | undefined>;
  /**
   * Starts a card over.
   *
   * The review log cannot lose a row, so the reset is recorded on the card
   * instead: `resetAt` is the line the replay starts from, and answers given
   * before it stop counting towards the card's state. Without that, rebuilding
   * from the log would undo the reset the first time anyone did it.
   */
  reset: (id: string, now: Date) => Promise<CardRow | undefined>;
  softDelete: (id: string) => Promise<boolean>;
  /**
   * Removes several cards at once, for a note whose type changed.
   *
   * One version number for the lot, because they went together and a sync that
   * saw half of them gone would rebuild a note that can no longer produce them.
   */
  softDeleteMany: (ids: readonly string[]) => Promise<number>;
  restore: (id: string) => Promise<boolean>;
  /**
   * Opens a direction by hand, under the account lock.
   *
   * Returns nothing when the direction already has a live Card, whether it was
   * opened earlier, by another device, or by progression a moment ago. The
   * lock and the partial unique key together mean two such requests, or one
   * racing an answer that qualifies the direction, leave exactly one Card.
   */
  /**
   * Opens the directions existing Notes in these Decks already qualify for.
   * See `sweepProgression`; takes the account lock only when there is work.
   */
  sweepProgression: (deckIds: readonly string[], now: Date) => Promise<CardRow[]>;
  openByHand: (
    noteId: string,
    planned: readonly { direction: CardDirection; slot: number }[],
    now: Date,
  ) => Promise<CardRow[] | undefined>;
}

const DEFAULT_DUE_LIMIT = 200;

/** A card was asked for against a note that is not there. */
export class NoteNotFound extends Error {
  override readonly name = 'NoteNotFound';

  constructor(id: string) {
    super(`no note ${id}`);
  }
}

export function cardRepository(
  userId: string,
  run: Runner,
  batchRevision?: number,
): CardRepository {
  // Walk from live roots rather than trusting cached paths. A broken, deleted,
  // cyclic, or non-folder ancestor cannot admit any descendant to learning.
  const liveStudyDeck = sql`${cards.deckId} in (
    with recursive live_collections as (
      select id, kind from decks
      where user_id = ${userId} and parent_id is null
        and deleted_at is null and purged_at is null
      union all
      select child.id, child.kind from decks child
      join live_collections parent on child.parent_id = parent.id
      where child.user_id = ${userId} and parent.kind = 'folder'
        and child.deleted_at is null and child.purged_at is null
    ) select id from live_collections where kind = 'deck'
  )`;
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
      .where(
        and(
          eq(notes.userId, userId),
          inArray(notes.id, [...new Set(noteIds)]),
          isNull(notes.purgedAt),
        ),
      );

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
      slot: input.slot ?? 0,
      ...scheduling,
      placedDue: scheduling.state === 'new' ? null : scheduling.due,
      unlockedAt: input.unlockedAt ?? null,
      unlockReason: input.unlockReason ?? null,
      unlockedByReviewId: input.unlockedByReviewId ?? null,
      rev,
    };
  }

  return {
    async create(input) {
      return run(async (tx) => {
        const rev = await nextRev(tx, userId);
        const deckId = (await decksOfNotes(tx, [input.noteId])).get(input.noteId);

        if (deckId === undefined) {
          throw new NoteNotFound(input.noteId);
        }

        const [row] = await tx
          .insert(cards)
          .values(toValues(input, deckId, rev))
          .returning();

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
        const rev = batchRevision ?? (await nextRev(tx, userId));
        const deckIds = await decksOfNotes(
          tx,
          inputs.map((input) => input.noteId),
        );
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

    async sweepProgression(deckIds, now) {
      return run((tx) => sweepProgression(tx, userId, deckIds, now));
    },

    async openByHand(noteId, planned, now) {
      return run(async (tx) => {
        await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for('update');
        const directions = [...new Set(planned.map((card) => card.direction))];
        const existing = await tx
          .select({ id: cards.id })
          .from(cards)
          .where(
            and(
              eq(cards.userId, userId),
              eq(cards.noteId, noteId),
              inArray(cards.direction, directions),
              isNull(cards.deletedAt),
            ),
          )
          .limit(1);
        if (existing.length > 0 || planned.length === 0) return undefined;
        const deckId = (await decksOfNotes(tx, [noteId])).get(noteId);
        if (deckId === undefined) throw new NoteNotFound(noteId);
        const rev = await nextRev(tx, userId);
        const written = await tx
          .insert(cards)
          .values(
            planned.map((card) =>
              toValues(
                {
                  noteId,
                  direction: card.direction,
                  slot: card.slot,
                  due: now,
                  unlockedAt: now,
                  unlockReason: 'manual',
                },
                deckId,
                rev,
              ),
            ),
          )
          .onConflictDoNothing({
            target: [cards.noteId, cards.direction, cards.slot],
            where: sql`${cards.deletedAt} is null`,
          })
          .returning();
        return written.length > 0 ? written : undefined;
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
          .orderBy(asc(cards.direction), asc(cards.slot)),
      );
    },

    async due(query) {
      return run(async (tx) => {
        const limit = query.limit ?? DEFAULT_DUE_LIMIT;
        const ready = and(
          liveStudyDeck,
          inArray(
            cards.noteId,
            tx
              .select({ id: notes.id })
              .from(notes)
              .where(
                and(
                  eq(notes.userId, userId),
                  eq(notes.deckId, cards.deckId),
                  eq(notes.status, 'active'),
                  isNull(notes.deletedAt),
                  isNull(notes.purgedAt),
                ),
              ),
          ),
          eq(cards.userId, userId),
          isNull(cards.deletedAt),
          isNull(cards.suspendedAt),
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

    async forSession(query) {
      return run(async (tx) => {
        const live = and(
          liveStudyDeck,
          inArray(
            cards.noteId,
            tx
              .select({ id: notes.id })
              .from(notes)
              .where(
                and(
                  eq(notes.userId, userId),
                  eq(notes.deckId, cards.deckId),
                  eq(notes.status, 'active'),
                  isNull(notes.deletedAt),
                  isNull(notes.purgedAt),
                ),
              ),
          ),
          eq(cards.userId, userId),
          isNull(cards.deletedAt),
          isNull(cards.suspendedAt),
        );

        if (query.deckIds !== undefined) {
          if (!query.deckIds.length) return [];
          return tx
            .select()
            .from(cards)
            .where(and(live, inArray(cards.deckId, [...query.deckIds])))
            .orderBy(asc(cards.due), asc(cards.id));
        }

        if (query.deckId === undefined) {
          return tx.select().from(cards).where(live).orderBy(asc(cards.due), asc(cards.id));
        }

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
          .where(and(live, inArray(cards.deckId, under)))
          .orderBy(asc(cards.due), asc(cards.id));
      });
    },

    async countsByDeck(now) {
      return run(async (tx) => {
        const rows = await tx
          .select({
            deckId: cards.deckId,
            due: sql<number>`count(*) filter (where ${cards.state} <> 'new' and ${cards.due} <= ${now})::int`,
            fresh: sql<number>`count(*) filter (where ${cards.state} = 'new')::int`,
            nextDue: sql<
              string | null
            >`min(${cards.due}) filter (where ${cards.state} <> 'new' and ${cards.due} > ${now})`,
          })
          .from(cards)
          .where(
            and(
              eq(cards.userId, userId),
              liveStudyDeck,
              isNull(cards.deletedAt),
              isNull(cards.suspendedAt),
              inArray(
                cards.noteId,
                tx
                  .select({ id: notes.id })
                  .from(notes)
                  .where(
                    and(
                      eq(notes.userId, userId),
                      eq(notes.status, 'active'),
                      eq(notes.deckId, cards.deckId),
                      isNull(notes.purgedAt),
                      isNull(notes.deletedAt),
                    ),
                  ),
              ),
            ),
          )
          .groupBy(cards.deckId);

        return rows;
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

    async suspend(id) {
      return run(async (tx) => {
        const rev = await nextRev(tx, userId);
        const now = new Date();

        const [row] = await tx
          .update(cards)
          .set({ suspendedAt: now, updatedAt: now, rev })
          .where(
            and(
              eq(cards.userId, userId),
              eq(cards.id, id),
              isNull(cards.deletedAt),
              isNull(cards.suspendedAt),
            ),
          )
          .returning();

        return row;
      });
    },

    async unsuspend(id) {
      return run(async (tx) => {
        const rev = await nextRev(tx, userId);

        const [row] = await tx
          .update(cards)
          .set({ suspendedAt: null, updatedAt: new Date(), rev })
          .where(and(eq(cards.userId, userId), eq(cards.id, id), isNull(cards.deletedAt)))
          .returning();

        return row;
      });
    },

    async reset(id, now) {
      return run(async (tx) => {
        const rev = await nextRev(tx, userId);

        const [row] = await tx
          .update(cards)
          .set({
            state: 'new',
            stability: null,
            difficulty: null,
            lastReview: null,
            due: now,
            placedDue: null,
            reps: 0,
            lapses: 0,
            learningStep: 0,
            resetAt: now,
            updatedAt: now,
            rev,
          })
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
          .set({
            deletedAt: sql`coalesce(${cards.deletedAt}, ${now})`,
            deletedWithNote: false,
            updatedAt: now,
            rev,
          })
          .where(
            and(
              eq(cards.userId, userId),
              eq(cards.id, id),
              or(isNull(cards.deletedAt), eq(cards.deletedWithNote, true)),
            ),
          )
          .returning({ id: cards.id });

        return marked.length > 0;
      });
    },

    async softDeleteMany(ids) {
      if (ids.length === 0) {
        return 0;
      }

      return run(async (tx) => {
        const rev = batchRevision ?? (await nextRev(tx, userId));
        const now = new Date();

        const marked = await tx
          .update(cards)
          .set({
            deletedAt: sql`coalesce(${cards.deletedAt}, ${now})`,
            deletedWithNote: false,
            updatedAt: now,
            rev,
          })
          .where(
            and(
              eq(cards.userId, userId),
              inArray(cards.id, [...new Set(ids)]),
              or(isNull(cards.deletedAt), eq(cards.deletedWithNote, true)),
            ),
          )
          .returning({ id: cards.id });

        return marked.length;
      });
    },

    async restore(id) {
      return run(async (tx) => {
        const rev = await nextRev(tx, userId);
        const now = new Date();
        const [card] = await tx
          .select()
          .from(cards)
          .where(and(eq(cards.userId, userId), eq(cards.id, id)))
          .limit(1);
        if (card?.purgedAt) throw new RestoreDependency();
        if (!card || card.deletedAt === null) return false;
        const [note] = await tx
          .select()
          .from(notes)
          .where(and(eq(notes.userId, userId), eq(notes.id, card.noteId)))
          .limit(1);
        if (!note || note.deletedAt !== null) throw new RestoreDependency();
        await requireLiveDeck(tx, userId, note.deckId, 'deck');

        const restored = await tx
          .update(cards)
          .set({ deletedAt: null, deletedWithNote: false, updatedAt: now, rev })
          .where(and(eq(cards.userId, userId), eq(cards.id, id)))
          .returning({ id: cards.id });

        return restored.length > 0;
      });
    },
  };
}

/** Reads the scheduling half of a card row as the scheduler sees it. */
export function schedulingOf(row: CardRow): SchedulingState {
  return toSchedulingState(row);
}

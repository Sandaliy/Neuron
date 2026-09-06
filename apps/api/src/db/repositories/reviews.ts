import { and, asc, count, eq, gte, inArray, isNull } from 'drizzle-orm';

import { createSchedulerConfig, createSeededRandom, replay, review } from '@neuron/core';
import type {
  Rating,
  RandomSource,
  SchedulerConfig,
  ReviewLog,
  SchedulingState,
} from '@neuron/core';
import { uuidV7 } from '@neuron/shared';

import { cards, reviews, user } from '../schema/index.js';

import { fromReviewLog, fromSchedulingState, toReviewLog, toSchedulingState } from './mapping.js';
import { nextRev } from './session.js';

import type { Runner, Tx } from './session.js';

/**
 * The review log, and the one operation that writes to it.
 *
 * Recording an answer is where the three parts of the project meet: the
 * scheduler decides what the answer means, the log records what was decided,
 * and the card row is overwritten with the result. All three happen in one
 * transaction, because a log entry without its card update would leave the two
 * disagreeing until someone rebuilt the card from the log.
 *
 * Two things here exist because of the network rather than the algorithm.
 *
 * The id comes from the caller. A phone that sends an answer, loses signal
 * before the reply arrives and sends again has to have the second arrival
 * recognised as the same answer. With a server generated id that is impossible,
 * and one tap becomes two reviews and a card whose schedule has quietly moved.
 *
 * The generator is seeded from that id. Fuzz has to land the card on the same
 * day whoever computes it and however many times, so the seed cannot be the
 * clock. Seeding from the id means a retry recomputes exactly what the first
 * attempt did, and a client that seeds the same way agrees with the server
 * rather than triggering a resync on every card.
 */

export type ReviewRow = typeof reviews.$inferSelect;

export interface RecordReview {
  /** Supply one to make the write idempotent. Otherwise one is generated. */
  readonly id?: string;
  readonly cardId: string;
  readonly rating: Rating;
  readonly now: Date;
  readonly durationMs?: number;
  /**
   * Overrides the generator seeded from the id.
   *
   * Only for tests and for the seed, which need a run they can repeat. The
   * request path never passes one.
   */
  readonly rng?: RandomSource;
}

export interface RecordedReview {
  readonly review: ReviewRow;
  readonly card: typeof cards.$inferSelect;
  readonly state: SchedulingState;
  /**
   * False when this id had already been recorded, in which case nothing was
   * written and the card is being returned as it already stood.
   */
  readonly applied: boolean;
}

export interface ReviewRepository {
  record: (input: RecordReview) => Promise<RecordedReview>;
  /** Every answer for one card that still counts, oldest first. */
  forCard: (cardId: string) => Promise<ReviewLog[]>;
  /** All historical answers, including those before a card reset. */
  countForCards: (cardIds: readonly string[]) => Promise<number>;
  /** Rebuilds a card's state from its log, without writing anything. */
  rebuild: (cardId: string) => Promise<SchedulingState>;
  /** Appends entries whose scheduling was already decided elsewhere. */
  append: (
    entries: readonly { readonly cardId: string; readonly log: ReviewLog }[],
  ) => Promise<number>;
}

/** A card that has to exist for an answer to mean anything. */
export class CardNotFound extends Error {
  override readonly name = 'CardNotFound';

  constructor(id: string) {
    super(`no card ${id}`);
  }
}

/**
 * Turns a review id into a seed for the fuzz generator.
 *
 * Any deterministic function of the id would do. This one folds the hex digits
 * into 32 bits, which is what `createSeededRandom` takes, and it is written out
 * rather than pulled from a hash so that a client can reproduce it in a few
 * lines and land its cards on the same days the server does.
 *
 * @param id the review id, a UUID
 * @returns a 32 bit seed
 */
export function seedFromReviewId(id: string): number {
  let seed = 0;

  for (const character of id.replaceAll('-', '')) {
    seed = (Math.imul(seed, 31) + character.charCodeAt(0)) | 0;
  }

  return seed >>> 0;
}

/**
 * The scheduler settings for a user.
 *
 * The timezone and the cutoff hour decide which day an answer counts for, and
 * getting them from the user row rather than from the server's clock is what
 * makes a card answered at one in the morning count for the right day.
 *
 * @param tx the transaction
 * @param userId whose settings to read
 * @returns the settings
 */
export async function schedulerConfigFor(tx: Tx, userId: string): Promise<SchedulerConfig> {
  const [row] = await tx
    .select({
      timezone: user.timezone,
      dayCutoffHour: user.dayCutoffHour,
      settings: user.settings,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  if (!row) {
    throw new Error(`no user row for ${userId}`);
  }

  const retention = row.settings?.targetRetention;

  return createSchedulerConfig({
    timezone: row.timezone,
    dayCutoffHour: row.dayCutoffHour,
    ...(retention === undefined ? {} : { desiredRetention: retention }),
  });
}

/**
 * The answers that still count towards one card.
 *
 * A card that has been reset keeps every row it ever produced, because the log
 * is append only and that is the whole point of it. What changes is where the
 * replay starts: only answers given at or after `reset_at` are part of the
 * card's current life.
 *
 * @param tx the transaction
 * @param userId whose card
 * @param cardId which card
 * @returns the rows to replay, oldest first
 */
async function logFor(tx: Tx, userId: string, cardId: string): Promise<ReviewRow[]> {
  const [card] = await tx
    .select({ resetAt: cards.resetAt })
    .from(cards)
    .where(and(eq(cards.userId, userId), eq(cards.id, cardId)))
    .limit(1);

  const after = card?.resetAt ?? null;

  return tx
    .select()
    .from(reviews)
    .where(
      and(
        eq(reviews.userId, userId),
        eq(reviews.cardId, cardId),
        ...(after === null ? [] : [gte(reviews.reviewedAt, after)]),
      ),
    )
    .orderBy(asc(reviews.reviewedAt), asc(reviews.id));
}

export function reviewRepository(userId: string, run: Runner): ReviewRepository {
  return {
    async record(input) {
      return run(async (tx) => {
        const id = input.id ?? uuidV7();

        const [card] = await tx
          .select()
          .from(cards)
          .where(and(eq(cards.userId, userId), eq(cards.id, input.cardId), isNull(cards.deletedAt)))
          .limit(1);

        if (!card) {
          throw new CardNotFound(input.cardId);
        }

        const config = await schedulerConfigFor(tx, userId);
        const outcome = review(
          toSchedulingState(card),
          input.rating,
          input.now,
          config,
          input.rng ?? createSeededRandom(seedFromReviewId(id)),
          input.durationMs ?? 0,
        );

        const rev = await nextRev(tx, userId);
        const columns = fromReviewLog(outcome.log);

        // The insert is what decides whether this is a retry. Checking first
        // and inserting second would leave a gap between the two in which the
        // retry arrives, and both requests would think they were the original.
        const [written] = await tx
          .insert(reviews)
          .values({ id, userId, cardId: card.id, ...columns, rev })
          .onConflictDoNothing({ target: reviews.id })
          .returning();

        if (!written) {
          const [existing] = await tx
            .select()
            .from(reviews)
            .where(and(eq(reviews.userId, userId), eq(reviews.id, id)))
            .limit(1);

          if (!existing) {
            // The id belongs to somebody else's review. Saying so would confirm
            // that it exists, so it reads as a card that is not there.
            throw new CardNotFound(input.cardId);
          }

          return {
            review: existing,
            card,
            state: toSchedulingState(card),
            applied: false,
          };
        }

        const next = fromSchedulingState(outcome.next);

        const [updated] = await tx
          .update(cards)
          .set({ ...next, placedDue: outcome.log.placedDue, updatedAt: new Date(), rev })
          .where(and(eq(cards.userId, userId), eq(cards.id, card.id)))
          .returning();

        if (!updated) {
          throw new Error('the card was not updated');
        }

        return { review: written, card: updated, state: outcome.next, applied: true };
      });
    },

    async forCard(cardId) {
      return run(async (tx) => (await logFor(tx, userId, cardId)).map(toReviewLog));
    },

    async countForCards(cardIds) {
      if (cardIds.length === 0) return 0;
      return run(async (tx) => {
        const [row] = await tx
          .select({ total: count() })
          .from(reviews)
          .where(and(eq(reviews.userId, userId), inArray(reviews.cardId, [...cardIds])));
        return row?.total ?? 0;
      });
    },

    async rebuild(cardId) {
      return run(async (tx) => {
        const rows = await logFor(tx, userId, cardId);

        return replay(rows.map(toReviewLog), await schedulerConfigFor(tx, userId));
      });
    },

    async append(entries) {
      if (entries.length === 0) {
        return 0;
      }

      return run(async (tx) => {
        const rev = await nextRev(tx, userId);
        let written = 0;

        for (let start = 0; start < entries.length; start += 200) {
          const batch = entries.slice(start, start + 200).map((entry) => ({
            id: uuidV7(),
            userId,
            cardId: entry.cardId,
            ...fromReviewLog(entry.log),
            rev,
          }));

          const rows = await tx.insert(reviews).values(batch).returning({ id: reviews.id });

          written += rows.length;
        }

        return written;
      });
    },
  };
}

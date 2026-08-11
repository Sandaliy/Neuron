import { and, asc, eq, isNull } from 'drizzle-orm';

import { createSchedulerConfig, createSeededRandom, replay, review } from '@neuron/core';
import type { Rating, RandomSource, SchedulerConfig, ReviewLog, SchedulingState } from '@neuron/core';
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
 */

export type ReviewRow = typeof reviews.$inferSelect;

export interface RecordReview {
  readonly cardId: string;
  readonly rating: Rating;
  readonly now: Date;
  readonly durationMs?: number;
  /**
   * Supplied when the answer was given on a device that already drew the fuzz.
   * The log records where the card actually landed, so a second device rebuilds
   * the same card instead of picking a different day.
   */
  readonly rng?: RandomSource;
}

export interface RecordedReview {
  readonly review: ReviewRow;
  readonly card: typeof cards.$inferSelect;
  readonly state: SchedulingState;
}

export interface ReviewRepository {
  record: (input: RecordReview) => Promise<RecordedReview>;
  /** Every answer for one card, oldest first. */
  forCard: (cardId: string) => Promise<ReviewLog[]>;
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

export function reviewRepository(userId: string, run: Runner): ReviewRepository {
  return {
    async record(input) {
      return run(async (tx) => {
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
          input.rng ?? createSeededRandom(Date.now()),
          input.durationMs ?? 0,
        );

        const rev = await nextRev(tx, userId);
        const columns = fromReviewLog(outcome.log);

        const [written] = await tx
          .insert(reviews)
          .values({ id: uuidV7(), userId, cardId: card.id, ...columns })
          .returning();

        if (!written) {
          throw new Error('the review was not written');
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

        return { review: written, card: updated, state: outcome.next };
      });
    },

    async forCard(cardId) {
      return run(async (tx) => {
        const rows = await tx
          .select()
          .from(reviews)
          .where(and(eq(reviews.userId, userId), eq(reviews.cardId, cardId)))
          .orderBy(asc(reviews.reviewedAt), asc(reviews.id));

        return rows.map(toReviewLog);
      });
    },

    async rebuild(cardId) {
      return run(async (tx) => {
        const rows = await tx
          .select()
          .from(reviews)
          .where(and(eq(reviews.userId, userId), eq(reviews.cardId, cardId)))
          .orderBy(asc(reviews.reviewedAt), asc(reviews.id));

        return replay(rows.map(toReviewLog), await schedulerConfigFor(tx, userId));
      });
    },

    async append(entries) {
      if (entries.length === 0) {
        return 0;
      }

      return run(async (tx) => {
        let written = 0;

        for (let start = 0; start < entries.length; start += 200) {
          const batch = entries.slice(start, start + 200).map((entry) => ({
            id: uuidV7(),
            userId,
            cardId: entry.cardId,
            ...fromReviewLog(entry.log),
          }));

          const rows = await tx.insert(reviews).values(batch).returning({ id: reviews.id });

          written += rows.length;
        }

        return written;
      });
    },
  };
}

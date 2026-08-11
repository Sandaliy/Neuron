import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core';

import { CARD_STATES } from '@neuron/core';
import { RATINGS } from '@neuron/shared';

import { user } from './auth.js';
import { cards } from './cards.js';
import { id, instant, literalList } from './columns.js';

/**
 * Every answer ever given. Appended to, never changed, never removed.
 *
 * This is the load bearing table. The state of a card is a projection of this
 * log and can be rebuilt from it at any time, which buys three things:
 * synchronising two devices stops being a conflict problem and becomes a merge
 * of two append only lists, a change to the algorithm can be applied to the
 * whole history rather than only to what happens next, and the statistics are
 * measured rather than accumulated in counters that drift.
 *
 * None of that survives the log being editable, so it is not editable. The
 * application role has no privilege to update or delete a row here, and a rule
 * on the table refuses both for everyone, including the owner. The two are
 * separate on purpose: a grant stops applying the moment someone connects as a
 * different role.
 *
 * The columns are what `ReviewLog` in packages/core needs in order to rebuild a
 * card, plus the two identifiers, and nothing else.
 */
export const reviews = pgTable(
  'reviews',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /**
     * Cascades only because erasing an account has to erase everything in it.
     * Cards are soft deleted in ordinary use, so a deleted card keeps its
     * history and the statistics stay honest.
     */
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    /** When the person answered, as their device recorded it. */
    reviewedAt: instant('reviewed_at').notNull(),
    /**
     * When the row reached the server.
     *
     * Different from `reviewedAt` after a session spent with no network, and
     * the difference is the first thing worth looking at when a sync problem
     * needs explaining.
     */
    createdAt: instant('created_at').notNull().defaultNow(),
    rating: text('rating').notNull(),
    durationMs: integer('duration_ms').notNull().default(0),
    /** Whole days since the previous answer. Zero on the first. */
    elapsedDays: integer('elapsed_days').notNull(),
    /** Whole days the card had been waiting for. Zero while in learning. */
    scheduledDays: integer('scheduled_days').notNull(),
    /**
     * Where this answer placed the card, after fuzz or balancing moved it.
     *
     * The memory model can be recomputed anywhere. The day a card landed on
     * cannot: it came out of a generator on one device. Recording it is what
     * lets a second device rebuild the same card rather than quietly disagree
     * about when it is due.
     */
    placedDue: instant('placed_due').notNull(),
    stateBefore: text('state_before').notNull(),
    /** Absent on the first review of a card, which had no memory state yet. */
    stabilityBefore: doublePrecision('stability_before'),
    difficultyBefore: doublePrecision('difficulty_before'),
    /**
     * The user's version counter at the moment the row was written.
     *
     * The same column every other table carries, and it is here for the same
     * reason: a client asking for everything after the number it last saw has
     * to get its answers back in that one stream, rather than paging the log
     * separately by timestamp and hoping the two orders agree.
     */
    rev: bigint('rev', { mode: 'number' }).notNull().default(0),
  },
  (table) => [
    /** Replay: every answer for one card, oldest first. */
    index('reviews_card_idx').on(table.userId, table.cardId, table.reviewedAt),
    /** Statistics: everything this person did, by date. */
    index('reviews_user_reviewed_idx').on(table.userId, table.reviewedAt),
    index('reviews_user_rev_idx').on(table.userId, table.rev),
    check('reviews_rev_not_negative', sql`${table.rev} >= 0`),
    check('reviews_rating_known', sql`${table.rating} in (${literalList(RATINGS)})`),
    check('reviews_state_before_known', sql`${table.stateBefore} in (${literalList(CARD_STATES)})`),
    check('reviews_duration_not_negative', sql`${table.durationMs} >= 0`),
    check('reviews_elapsed_days_not_negative', sql`${table.elapsedDays} >= 0`),
    check('reviews_scheduled_days_not_negative', sql`${table.scheduledDays} >= 0`),
    check(
      'reviews_difficulty_range',
      sql`${table.difficultyBefore} is null or (${table.difficultyBefore} >= 1 and ${table.difficultyBefore} <= 10)`,
    ),
    check(
      'reviews_stability_positive',
      sql`${table.stabilityBefore} is null or ${table.stabilityBefore} > 0`,
    ),
    /**
     * A first review has no memory state before it, and a later one has both
     * halves of it. The same union as on the card, from the other side.
     */
    check(
      'reviews_first_has_no_memory',
      sql`(${table.stateBefore} = 'new') = (${table.stabilityBefore} is null and ${table.difficultyBefore} is null)`,
    ),
  ],
);

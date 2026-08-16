import { sql } from 'drizzle-orm';
import {
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { CARD_DIRECTIONS, CARD_STATES } from '@neuron/core';

import { id, instant, literalList } from './columns.js';
import { decks } from './decks.js';
import { notes } from './notes.js';
import { owned } from './owned.js';

/**
 * One direction of asking about one note, with its own schedule.
 *
 * The columns mirror `SchedulingState` in packages/core. That is not a
 * coincidence to be maintained by hand: the check constraints below are the
 * union type written out in SQL, so a row that the TypeScript type could not
 * describe cannot be stored either.
 *
 * Stability and difficulty are `double precision`, not `numeric`. The scheduler
 * works in IEEE 754 doubles throughout, and a decimal column would round on the
 * way in and out. Two devices replaying the same log would then disagree in the
 * last digits, drift apart over months, and show different due dates for the
 * same card.
 */
export const cards = pgTable(
  'cards',
  {
    id: id(),
    ...owned(),
    noteId: uuid('note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    /**
     * The deck the card's note is in, copied here.
     *
     * The same fact lives on the note, so this is duplication, and it was added
     * only after measuring what it buys. On fifty thousand cards, "what is due
     * in this folder" went from 7.25 ms to 2.36 ms and the counts behind the
     * library tree went from 43.9 ms to 17.5 ms, because neither has to join
     * through notes any more. The numbers and the plans are in
     * docs/architecture.md.
     *
     * The cost is that moving a note has to move its cards in the same
     * transaction. That happens in one place, noteRepository.moveToDeck, and a
     * test holds it to it.
     */
    deckId: uuid('deck_id')
      .notNull()
      .references(() => decks.id, { onDelete: 'cascade' }),
    direction: text('direction').notNull(),
    /**
     * Which gap this card hides, on a cloze note. Zero everywhere else.
     *
     * A sentence with three gaps is three cards, and all three are in the
     * `cloze` direction, so the direction on its own cannot tell them apart.
     * Every other type has exactly one card per direction and leaves this at
     * zero.
     */
    slot: integer('slot').notNull().default(0),
    state: text('state').notNull().default('new'),
    /** Days until recall drops to the target. Null until first answered. */
    stability: doublePrecision('stability'),
    /** How hard this card is for this person, 1 to 10. */
    difficulty: doublePrecision('difficulty'),
    /** When the card comes up next. */
    due: instant('due').notNull(),
    lastReview: instant('last_review'),
    /**
     * Where the last answer put the card.
     *
     * Normally the same as `due`. They separate when something after the review
     * moves the card: the backlog plan spreading work over a week, or a future
     * reschedule. Keeping both means such a move is visible rather than
     * indistinguishable from what the scheduler asked for, and the review log
     * stays the record of what was actually decided at the time.
     */
    placedDue: instant('placed_due'),
    reps: integer('reps').notNull().default(0),
    lapses: integer('lapses').notNull().default(0),
    learningStep: integer('learning_step').notNull().default(0),
    /** When this direction became available under the ladder. */
    unlockedAt: instant('unlocked_at'),
    /**
     * Set while the card is put aside. Null while it is being studied.
     *
     * Separate from the note's status, which suspends every direction at once.
     * This is for the single direction someone has decided they do not want
     * right now, and it keeps the card out of the due query without deleting
     * it or touching its schedule.
     */
    suspendedAt: instant('suspended_at'),
    /**
     * When the card was put back to new, if it ever was.
     *
     * Resetting cannot remove anything from the review log, so the log alone
     * would rebuild the card as it was before the reset. This is the line the
     * replay starts from: only answers given after it count towards the card's
     * state. Without it, "card state is a projection of the log" would stop
     * being true the first time anyone pressed reset.
     */
    resetAt: instant('reset_at'),
  },
  (table) => [
    uniqueIndex('cards_note_direction_key')
      .on(table.noteId, table.direction, table.slot)
      .where(sql`${table.deletedAt} is null`),
    /**
     * The query the application runs on every open: what is due now.
     *
     * Partial, because a soft deleted card and a suspended one are never due
     * for anything, and carrying those rows in the index makes it larger for
     * no gain.
     */
    index('cards_user_due_idx')
      .on(table.userId, table.due)
      .where(sql`${table.deletedAt} is null and ${table.suspendedAt} is null`),
    /** The same question, narrowed to one deck. */
    index('cards_user_deck_due_idx')
      .on(table.userId, table.deckId, table.due)
      .where(sql`${table.deletedAt} is null and ${table.suspendedAt} is null`),
    /** Counting cards per deck for the library tree. */
    index('cards_user_deck_idx')
      .on(table.userId, table.deckId)
      .where(sql`${table.deletedAt} is null`),
    index('cards_note_idx').on(table.noteId),
    index('cards_user_rev_idx').on(table.userId, table.rev),
    check('cards_direction_known', sql`${table.direction} in (${literalList(CARD_DIRECTIONS)})`),
    check('cards_state_known', sql`${table.state} in (${literalList(CARD_STATES)})`),
    /**
     * A new card has no memory state, and a card with a memory state is not new.
     *
     * This is the `NewCardState | ReviewedCardState` union from packages/core.
     * A zero stability would otherwise flow through the formulas and come out
     * as a number that looks like an answer.
     */
    check(
      'cards_new_has_no_memory',
      sql`(${table.state} = 'new') = (${table.stability} is null and ${table.difficulty} is null and ${table.lastReview} is null)`,
    ),
    check(
      'cards_difficulty_range',
      sql`${table.difficulty} is null or (${table.difficulty} >= 1 and ${table.difficulty} <= 10)`,
    ),
    check('cards_stability_positive', sql`${table.stability} is null or ${table.stability} > 0`),
    check('cards_reps_not_negative', sql`${table.reps} >= 0`),
    check('cards_slot_not_negative', sql`${table.slot} >= 0`),
    check('cards_lapses_not_negative', sql`${table.lapses} >= 0`),
    check('cards_lapses_within_reps', sql`${table.lapses} <= ${table.reps}`),
    check('cards_learning_step_not_negative', sql`${table.learningStep} >= 0`),
    check('cards_rev_not_negative', sql`${table.rev} >= 0`),
  ],
);

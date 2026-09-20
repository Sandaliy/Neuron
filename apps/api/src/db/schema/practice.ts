import { integer, jsonb, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import type { PracticeRun } from '@neuron/shared';

import { id } from './columns.js';
import { decks } from './decks.js';
import { owned } from './owned.js';

export const practiceRuns = pgTable(
  'practice_runs',
  {
    id: id(),
    ...owned(),
    deckId: uuid('deck_id')
      .notNull()
      .references(() => decks.id, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(0),
    lastOperationId: uuid('last_operation_id').notNull(),
    run: jsonb('run').$type<PracticeRun>().notNull(),
  },
  (table) => [uniqueIndex('practice_runs_user_deck').on(table.userId, table.deckId)],
);

/** Receipt also records a restart of an empty deck. Never update or delete. */
export const learningRestarts = pgTable('learning_restarts', {
  id: id(),
  ...owned(),
  deckId: uuid('deck_id')
    .notNull()
    .references(() => decks.id, { onDelete: 'cascade' }),
  cardCount: integer('card_count').notNull(),
});

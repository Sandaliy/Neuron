import { z } from 'zod';

import { PROBLEM_CARD_POLICY, PROBLEM_REASONS } from '../problem-cards.js';
import { ratingSchema } from '../rating.js';

import { cardDirectionSchema, cardStateSchema } from './cards.js';
import { idSchema } from './common.js';
import { noteSchema } from './notes.js';

export const PROBLEM_CARD_SORTS = ['again', 'recent'] as const;
export const PROBLEM_CARD_STATES = ['all', 'studying', 'suspended'] as const;

/** Microsecond UTC instant as PostgreSQL writes it, so a cursor compares exactly. */
const cursorInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ProblemCardCursor {
  readonly again?: number;
  readonly lastAgainAt: string;
  readonly id: string;
}

/** `again~instant~id` for the again order, `instant~id` for the recent order. */
export function readProblemCardCursor(
  sort: (typeof PROBLEM_CARD_SORTS)[number],
  cursor: string,
): ProblemCardCursor | undefined {
  const parts = cursor.split('~');
  const [again, lastAgainAt, id] = sort === 'again' ? parts : [undefined, ...parts];
  if (parts.length !== (sort === 'again' ? 3 : 2)) return undefined;
  if (!lastAgainAt || !cursorInstant.test(lastAgainAt) || !id || !uuid.test(id)) return undefined;
  if (again === undefined) return { lastAgainAt, id };
  if (!/^\d{1,6}$/.test(again)) return undefined;
  return { again: Number(again), lastAgainAt, id };
}

export function problemCardCursor(
  sort: (typeof PROBLEM_CARD_SORTS)[number],
  value: ProblemCardCursor,
): string {
  return sort === 'again'
    ? `${value.again ?? 0}~${value.lastAgainAt}~${value.id}`
    : `${value.lastAgainAt}~${value.id}`;
}

/**
 * One bounded page of listed Cards. Scope is the whole Library, a Folder subtree or one Deck.
 * Cursors carry values, not offsets: a Card resumed, edited or no longer listed between two
 * pages cannot shift the next page. No cursor establishes authorization.
 */
export const problemCardsQuerySchema = z
  .strictObject({
    deckId: idSchema.optional(),
    direction: cardDirectionSchema.optional(),
    state: z.enum(PROBLEM_CARD_STATES).default('all'),
    sort: z.enum(PROBLEM_CARD_SORTS).default('again'),
    search: z.string().trim().min(1).max(100).optional(),
    cursor: z.string().min(1).max(120).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine(
    (query) =>
      query.cursor === undefined || readProblemCardCursor(query.sort, query.cursor) !== undefined,
    { path: ['cursor'], message: 'cursor does not belong to this order' },
  );

const answerSchema = z.object({
  rating: ratingSchema,
  reviewedAt: z.string(),
  stateBefore: cardStateSchema,
});

/** What the server read from the Review log for one Card's current history. */
export const problemHistorySchema = z.object({
  kind: z.literal('history'),
  answers: z.number().int().min(1),
  again: z.number().int().min(0),
  lapses: z.number().int().min(0),
  lastAgainAt: z.string(),
  lastAnsweredAt: z.string(),
  /** Successful answers since the most recent Again. */
  sinceLastAgain: z.number().int().min(0),
  /** The restart or reset this history starts from, when there was one. */
  startedAt: z.string().nullable(),
  /** Newest first, at most `PROBLEM_CARD_POLICY.recentAnswers`. */
  recent: z.array(answerSchema).max(PROBLEM_CARD_POLICY.recentAnswers),
});

/** A complete download carries Card counters, not a verified Review history. */
export const problemCountersSchema = z.object({
  kind: z.literal('counters'),
  answers: z.number().int().min(0),
  lapses: z.number().int().min(0),
  lastAnsweredAt: z.string().nullable(),
});

export const problemCardSchema = z.object({
  card: z.object({
    id: idSchema,
    noteId: idSchema,
    deckId: idSchema,
    direction: cardDirectionSchema,
    slot: z.number().int().min(0),
    state: cardStateSchema,
    due: z.string(),
    suspendedAt: z.string().nullable(),
    rev: z.number().int(),
  }),
  note: noteSchema.pick({ id: true, deckId: true, noteType: true, fields: true, source: true }),
  deckPath: z.array(z.string()).min(1),
  reasons: z.array(z.enum(PROBLEM_REASONS)).min(1),
  evidence: z.discriminatedUnion('kind', [problemHistorySchema, problemCountersSchema]),
});

export const problemCardsPageSchema = z.object({
  items: z.array(problemCardSchema),
  /** Every listed Card in this scope and filter, independent of the cursor. */
  total: z.number().int().min(0),
  nextCursor: z.string().optional(),
  local: z.literal(true).optional(),
});

export type ProblemCardsQuery = z.infer<typeof problemCardsQuerySchema>;
export type ProblemCardSort = (typeof PROBLEM_CARD_SORTS)[number];
export type ProblemCardStateFilter = (typeof PROBLEM_CARD_STATES)[number];
export type ProblemCard = z.infer<typeof problemCardSchema>;
export type ProblemHistory = z.infer<typeof problemHistorySchema>;
export type ProblemCardsPage = z.infer<typeof problemCardsPageSchema>;

import { z } from 'zod';

import { idSchema } from './api/common.js';
import { clozeGaps, noteTypeSchema } from './note-types.js';
import { normaliseTerm } from './text.js';

import type { NoteSort } from './api/notes.js';
import type { NoteStatus, NoteTypeName } from './note-types.js';

/**
 * Triage: deciding, before learning starts, which imported Notes are already
 * known, which are uncertain and which are genuinely new.
 *
 * It is a classification and nothing else. It writes no Review, touches no
 * Card and moves no due date, so the schedule a Note has is still the one its
 * answers gave it. It only ever applies to Notes with no learning history:
 * once a Card has been answered, Study's evidence owns the Note.
 *
 * Known is the existing `known` status, with its existing meaning: the Note
 * sits out of Study until it is returned. Unsure and New keep the Note in
 * Study (`active`) and record the choice beside the status, so a later wave can
 * treat them differently. Study admission does not read the mark yet.
 */

export const TRIAGE_DECISIONS = ['known', 'unsure', 'new'] as const;
export const triageDecisionSchema = z.enum(TRIAGE_DECISIONS);
export type TriageDecision = z.infer<typeof triageDecisionSchema>;

/** What is stored beside an `active` status. Known needs no mark: it is the status. */
export const TRIAGE_MARKS = ['unsure', 'new'] as const;
export const triageMarkSchema = z.enum(TRIAGE_MARKS);
export type TriageMark = z.infer<typeof triageMarkSchema>;

/** A decision, or the absence of one, which is where Undo can return a Note to. */
export const TRIAGE_CHOICES = [...TRIAGE_DECISIONS, 'unsorted'] as const;
export const triageChoiceSchema = z.enum(TRIAGE_CHOICES);
export type TriageChoice = z.infer<typeof triageChoiceSchema>;

/** The statuses triage may read and write. Set aside and Draft belong to the learner's own choice. */
export const TRIAGE_STATUSES = ['active', 'known'] as const satisfies readonly NoteStatus[];

/**
 * The choice a Note currently carries.
 *
 * A Known status wins over a stale mark, so a Note marked known elsewhere reads
 * as Known here too, and returning it to Study brings back the last mark it had.
 *
 * @returns the choice, or undefined for a status triage leaves alone
 */
export function triageChoiceOf(
  status: NoteStatus,
  mark: TriageMark | null | undefined,
): TriageChoice | undefined {
  if (status === 'known') return 'known';
  if (status !== 'active') return undefined;
  return mark ?? 'unsorted';
}

/** The status and mark a choice is stored as. */
export function triageWrite(choice: TriageChoice): {
  readonly status: (typeof TRIAGE_STATUSES)[number];
  readonly triage: TriageMark | null;
} {
  switch (choice) {
    case 'known': {
      return { status: 'known', triage: null };
    }
    case 'unsorted': {
      return { status: 'active', triage: null };
    }
    default: {
      return { status: 'active', triage: choice };
    }
  }
}

/** What a triage card shows: the thing to recognise, a quiet line under it, and its meaning. */
export interface TriageFace {
  readonly term: string;
  readonly detail: string;
  readonly meaning: string;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The face of a Note for triage, for every Note type.
 *
 * A word shows with its article when it has one, because "der See" and "die
 * See" are two words. A cloze text shows with its gaps hidden, and its meaning
 * is the text whole.
 */
export function triageFace(noteType: NoteTypeName, fields: unknown): TriageFace {
  const record = (typeof fields === 'object' && fields !== null ? fields : {}) as Record<
    string,
    unknown
  >;

  if (noteType === 'vocab') {
    const grammar = (record['grammar'] ?? {}) as Record<string, unknown>;
    const article = text(grammar['article']);
    const term = text(record['term']);
    return {
      term: article && term ? `${article} ${term}` : term,
      detail: text(record['reading']),
      meaning: text(record['translation']),
    };
  }

  if (noteType === 'basic') {
    return { term: text(record['front']), detail: '', meaning: text(record['back']) };
  }

  const source = text(record['text']);
  let hidden = '';
  let whole = '';
  let at = 0;
  for (const gap of clozeGaps(source)) {
    hidden += `${source.slice(at, gap.start)}[${gap.hint ?? '…'}]`;
    whole += `${source.slice(at, gap.start)}${gap.answer}`;
    at = gap.end;
  }
  return {
    term: hidden + source.slice(at),
    detail: '',
    meaning: whole + source.slice(at),
  };
}

/** One Note as triage sees it. */
export const triageItemSchema = z.object({
  id: idSchema,
  deckId: idSchema,
  noteType: noteTypeSchema,
  rank: z.number().int().nullable(),
  choice: triageChoiceSchema,
  term: z.string(),
  detail: z.string(),
  meaning: z.string(),
});
export type TriageItem = z.infer<typeof triageItemSchema>;

export const triageQuerySchema = z.strictObject({ deckId: idSchema });

/**
 * Every Note a Folder or Deck holds that triage applies to, in source order.
 *
 * One answer rather than pages: five thousand of these rows are smaller than one
 * page of the browse list, and a sweep needs the whole order before it starts.
 */
export const triageListSchema = z.object({
  items: z.array(triageItemSchema),
  /** Live Notes left out because a Card of theirs has been answered. */
  studied: z.number().int().nonnegative(),
  /** Live Notes left out because they are Set aside or Draft. */
  setAside: z.number().int().nonnegative(),
});
export type TriageList = z.infer<typeof triageListSchema>;

/** How many decisions one request may carry. */
export const TRIAGE_BATCH_LIMIT = 500;

export const triageDecisionsSchema = z.strictObject({
  decisions: z
    .array(z.strictObject({ id: idSchema, choice: triageChoiceSchema }))
    .min(1)
    .max(TRIAGE_BATCH_LIMIT)
    .refine(
      (decisions) => new Set(decisions.map((decision) => decision.id)).size === decisions.length,
      'one decision per Note',
    ),
});
export type TriageDecisionsBody = z.infer<typeof triageDecisionsSchema>;

/**
 * Why a decision was not applied.
 *
 * `studied`: a Card was answered since, so Study owns the Note now. `set_aside`:
 * the Note was set aside or made a draft. `missing`: deleted, or never there.
 */
export const TRIAGE_SKIPS = ['studied', 'set_aside', 'missing'] as const;

export const triageResultSchema = z.object({
  /** Decisions now true on the server, including ones that already were. */
  applied: z.array(z.object({ id: idSchema, choice: triageChoiceSchema })),
  skipped: z.array(z.object({ id: idSchema, reason: z.enum(TRIAGE_SKIPS) })),
});
export type TriageResult = z.infer<typeof triageResultSchema>;

/** Which part of the order a sweep goes through. */
export type TriageQueue = 'unsorted' | 'unsure';

function rankOf(item: { readonly rank: number | null }): number {
  return item.rank ?? Number.POSITIVE_INFINITY;
}

/**
 * The order a sweep follows. Source order is the order the server gave, which
 * is creation order and therefore the order of the imported file. Ties always
 * fall back to source order, so the same choice gives the same sequence.
 */
export function orderTriage<T extends Pick<TriageItem, 'rank' | 'term'>>(
  items: readonly T[],
  sort: NoteSort,
): T[] {
  if (sort === 'created') return [...items];
  const indexed = items.map((item, index) => ({
    item,
    index,
    key: sort === 'alpha' ? normaliseTerm(item.term) : '',
  }));
  indexed.sort((left, right) =>
    sort === 'rank'
      ? rankOf(left.item) - rankOf(right.item) || left.index - right.index
      : left.key.localeCompare(right.key) || left.index - right.index,
  );
  return indexed.map((entry) => entry.item);
}

/** Whether a choice belongs in a queue. */
export function inTriageQueue(queue: TriageQueue, choice: TriageChoice): boolean {
  return queue === 'unsure' ? choice === 'unsure' : choice === 'unsorted';
}

/**
 * The next position the sweep should show.
 *
 * Forward from just after `from`. With `wrap`, it then carries on from the
 * start, so a Note jumped past is still met before the sweep says it is done.
 * A pass over Unsure Notes does not wrap: it is one pass, and deciding Unsure
 * again moves on rather than asking the same Note twice.
 *
 * @param from the current position, or -1 to start at the beginning
 * @returns an index into `order`, or -1 when nothing in the queue remains
 */
export function nextInTriage<T>(
  order: readonly T[],
  choiceOf: (item: T) => TriageChoice,
  queue: TriageQueue,
  from: number,
  wrap = true,
): number {
  const count = order.length;
  const steps = wrap ? count : count - 1 - from;
  for (let step = 1; step <= steps; step++) {
    const index = (from + step) % count;
    if (inTriageQueue(queue, choiceOf(order[index]!))) return index;
  }
  return -1;
}

export interface TriageCounts {
  readonly known: number;
  readonly unsure: number;
  readonly new: number;
  readonly unsorted: number;
}

export function countTriage<T>(
  items: readonly T[],
  choiceOf: (item: T) => TriageChoice,
): TriageCounts {
  const counts = { known: 0, unsure: 0, new: 0, unsorted: 0 };
  for (const item of items) counts[choiceOf(item)]++;
  return counts;
}

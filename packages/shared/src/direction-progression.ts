import type { CardDirection, CardState } from '@neuron/core';

import { openingCards, possibleCards } from './card-plan.js';

import type { LadderStep, PlannedCard } from './card-plan.js';
import type { NoteFields, NoteTypeName } from './note-types.js';

/**
 * Progressive directions: when a Note's next way of being asked opens.
 *
 * A vocabulary Note starts with the opening direction of its Deck's ladder.
 * Each later rung opens once the rung before it has reached the rung's
 * `opensAtStability`, in days, which is FSRS stability: the interval at which
 * recall is expected to drop to 90 per cent. Nothing else is measured and no
 * score is invented. The thresholds are the ladder's own, inherited through the
 * Deck chain exactly as the opening Cards read them.
 *
 * The same function answers three questions so that they cannot disagree: what
 * the server creates after an answer, what a sweep over existing Notes creates,
 * and what the Note screen says is open, next and still locked.
 *
 * Rules, in the order they are applied:
 *
 * - Only directions the Note can produce take part. A rung the type cannot
 *   produce is skipped, and the rung after it follows the nearest earlier rung
 *   the Note does produce. A Basic Note has no Typing, so a Typing rung is
 *   passed over; a Cloze Note has nothing to progress to.
 * - A rung that opens at zero is an opening direction. Opening Cards are made
 *   with the Note (or by the Deck's skill switches), never by progression.
 * - A later rung opens when every live, unsuspended Card of the preceding rung
 *   has been answered and holds a stability at or above the threshold.
 * - A suspended preceding direction holds the rungs after it: the learner set
 *   that direction aside, and nothing is built on it. A Note that is not in
 *   Study (Known, Set aside, Draft) opens nothing.
 * - Opening is one-way. A later lapse does not take a direction back; its
 *   Card has its own schedule and history from the moment it exists. Only the
 *   undo of the very answer that opened it can, and only while it is untouched,
 *   which the server decides.
 * - Directions the ladder does not mention can be opened by hand only.
 */

/** As much of an existing Card as progression needs. */
export interface ProgressionCard {
  readonly direction: CardDirection;
  readonly slot: number;
  readonly state: CardState;
  /** Days, from FSRS. Null until first answered. */
  readonly stability: number | null;
  readonly suspended: boolean;
}

/** Where one direction of a Note stands. */
export type DirectionStatus =
  /** A Card exists. */
  | {
      readonly kind: 'open';
      readonly direction: CardDirection;
      readonly suspended: boolean;
      readonly answered: boolean;
    }
  /** The preceding rung has reached the threshold; the server opens it. */
  | {
      readonly kind: 'ready';
      readonly direction: CardDirection;
      readonly after: CardDirection;
      readonly threshold: number;
      readonly stability: number;
    }
  /** The preceding rung is open but has not reached the threshold yet. */
  | {
      readonly kind: 'next';
      readonly direction: CardDirection;
      readonly after: CardDirection;
      readonly threshold: number;
      /** The lowest stability among the preceding rung's Cards, null if unanswered. */
      readonly stability: number | null;
    }
  /** The preceding rung is itself still locked. */
  | {
      readonly kind: 'waiting';
      readonly direction: CardDirection;
      readonly after: CardDirection;
      readonly threshold: number;
    }
  /** Progress is held: the preceding direction is set aside, or the Note is not in Study. */
  | {
      readonly kind: 'paused';
      readonly direction: CardDirection;
      readonly after: CardDirection;
      readonly threshold: number;
      readonly reason: 'suspended' | 'inactive';
    }
  /** Not on this Deck's ladder, or an opening direction this Note was made without. */
  | { readonly kind: 'manual'; readonly direction: CardDirection };

export interface DirectionProgress {
  /** Every direction the Note can produce, ladder order first. */
  readonly directions: readonly DirectionStatus[];
  /** Cards the server should create now. Empty unless something is `ready` and the Note is in Study. */
  readonly unlock: readonly PlannedCard[];
}

export interface DirectionProgressInput {
  readonly noteType: NoteTypeName;
  readonly fields: NoteFields;
  readonly ladder: readonly LadderStep[];
  /** The Note's live Cards. */
  readonly cards: readonly ProgressionCard[];
  /** Whether the Note is in Study (status `active`). */
  readonly active: boolean;
}

interface Rung {
  readonly direction: CardDirection;
  readonly threshold: number;
  readonly opening: boolean;
}

/**
 * The producible part of the ladder, in order, each direction once.
 *
 * @returns rungs, and every producible direction in the order to show them
 */
function rungsFor(input: DirectionProgressInput): { rungs: Rung[]; order: CardDirection[] } {
  const possible = possibleCards(input.noteType, input.fields);
  const producible = [...new Set(possible.map((card) => card.direction))];
  const opening = new Set(
    openingCards(input.noteType, input.fields, input.ladder).map((card) => card.direction),
  );
  const rungs: Rung[] = [];
  const seen = new Set<CardDirection>();

  // The fallback opening direction (a ladder that shares nothing with the type)
  // starts the sequence, so a later rung still has something to follow.
  for (const direction of opening) {
    if (!input.ladder.some((rung) => rung.direction === direction)) {
      rungs.push({ direction, threshold: 0, opening: true });
      seen.add(direction);
    }
  }

  for (const rung of input.ladder) {
    if (seen.has(rung.direction) || !producible.includes(rung.direction)) continue;
    seen.add(rung.direction);
    rungs.push({
      direction: rung.direction,
      threshold: rung.opensAtStability,
      opening: opening.has(rung.direction) || rung.opensAtStability === 0,
    });
  }

  return {
    rungs,
    order: [...rungs.map((rung) => rung.direction), ...producible.filter((d) => !seen.has(d))],
  };
}

/**
 * Where each direction of one Note stands, and what opens now.
 *
 * Pure and deterministic, so the server, the sweep and the Note screen agree.
 *
 * @param input the Note, its Deck's resolved ladder and its live Cards
 * @returns per-direction status and the Cards to create
 */
export function directionProgress(input: DirectionProgressInput): DirectionProgress {
  const { rungs, order } = rungsFor(input);
  const byDirection = new Map<CardDirection, ProgressionCard[]>();
  for (const card of input.cards) {
    byDirection.set(card.direction, [...(byDirection.get(card.direction) ?? []), card]);
  }
  const statuses = new Map<CardDirection, DirectionStatus>();
  const unlocking = new Set<CardDirection>();
  let previous: Rung | undefined;

  for (const rung of rungs) {
    const own = byDirection.get(rung.direction) ?? [];
    if (own.length > 0) {
      statuses.set(rung.direction, {
        kind: 'open',
        direction: rung.direction,
        suspended: own.every((card) => card.suspended),
        answered: own.some((card) => card.state !== 'new'),
      });
    } else if (rung.opening || previous === undefined) {
      statuses.set(rung.direction, { kind: 'manual', direction: rung.direction });
    } else {
      const after = previous.direction;
      const before = byDirection.get(after) ?? [];
      const studied = before.filter((card) => !card.suspended);
      const base = { direction: rung.direction, after, threshold: rung.threshold };
      if (before.length === 0) {
        statuses.set(rung.direction, { kind: 'waiting', ...base });
      } else if (studied.length === 0) {
        statuses.set(rung.direction, { kind: 'paused', ...base, reason: 'suspended' });
      } else {
        const values = studied.map((card) =>
          card.state === 'new' || card.stability === null ? null : card.stability,
        );
        const lowest = values.includes(null)
          ? null
          : Math.min(...values.filter((value): value is number => value !== null));
        if (lowest !== null && lowest >= rung.threshold) {
          if (input.active) {
            statuses.set(rung.direction, { kind: 'ready', ...base, stability: lowest });
            unlocking.add(rung.direction);
          } else {
            statuses.set(rung.direction, { kind: 'paused', ...base, reason: 'inactive' });
          }
        } else {
          statuses.set(rung.direction, { kind: 'next', ...base, stability: lowest });
        }
      }
    }
    previous = rung;
  }

  for (const direction of order) {
    if (statuses.has(direction)) continue;
    const own = byDirection.get(direction) ?? [];
    statuses.set(
      direction,
      own.length > 0
        ? {
            kind: 'open',
            direction,
            suspended: own.every((card) => card.suspended),
            answered: own.some((card) => card.state !== 'new'),
          }
        : { kind: 'manual', direction },
    );
  }

  const present = new Set(input.cards.map((card) => `${card.direction}:${card.slot}`));
  return {
    directions: order.map((direction) => statuses.get(direction)!),
    unlock: possibleCards(input.noteType, input.fields).filter(
      (card) => unlocking.has(card.direction) && !present.has(`${card.direction}:${card.slot}`),
    ),
  };
}

/**
 * Whether any rung of this ladder could open by progression at all.
 *
 * A cheap filter for sweeps: a Deck whose ladder only has opening rungs never
 * needs its Notes read.
 */
export function ladderProgresses(ladder: readonly LadderStep[]): boolean {
  return ladder.some((rung) => rung.opensAtStability > 0);
}

/** How a Card came to exist, as the server records it. */
export const UNLOCK_REASONS = ['opening', 'manual', 'ladder'] as const;
export type UnlockReason = (typeof UNLOCK_REASONS)[number];

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import {
  directionProgress,
  ladderProgresses,
  resolveDeckSettings,
  studyDecks,
  uuidV7,
} from '@neuron/shared';
import type {
  DeckSettings,
  LadderStep,
  NoteFields,
  NoteTypeName,
  PlannedCard,
  ProgressionCard,
} from '@neuron/shared';

import { cards, decks, notes, noteTypes, reviews, user } from '../schema/index.js';

import { nextRev } from './session.js';

import type { CardRow } from './cards.js';
import type { Tx } from './session.js';

/**
 * Progressive directions, applied to the database.
 *
 * The rule itself is `directionProgress` in packages/shared. This file is the
 * only writer of Cards it opens, and it only ever runs on the server, inside a
 * transaction that already holds the account lock (`user` row `for update`).
 * That lock is what Review recording, Undo, manual opening and Note writes
 * serialize on, so "is the direction missing?" and "create it" cannot be split
 * by another device. The partial unique key on (note, direction, slot) is the
 * second barrier: an insert that would duplicate a live Card does nothing.
 *
 * A device never creates these Cards. Offline Study plans with the Cards it
 * downloaded; a direction that qualifies offline opens when the answer that
 * qualified it reaches the server, and arrives with the next download.
 */

interface LiveDeck {
  readonly id: string;
  readonly parentId: string | null;
  readonly kind: string;
  readonly settings: DeckSettings | null;
}

/** Live study Decks and the ladder each resolves to, nearest opinion winning. */
async function laddersByDeck(tx: Tx, userId: string): Promise<Map<string, readonly LadderStep[]>> {
  const rows: LiveDeck[] = await tx
    .select({ id: decks.id, parentId: decks.parentId, kind: decks.kind, settings: decks.settings })
    .from(decks)
    .where(and(eq(decks.userId, userId), isNull(decks.deletedAt), isNull(decks.purgedAt)));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ladders = new Map<string, readonly LadderStep[]>();
  for (const deck of studyDecks(rows)) {
    const chain: (DeckSettings | null)[] = [];
    let at: LiveDeck | undefined = deck;
    while (at) {
      chain.unshift(at.settings);
      at = at.parentId === null ? undefined : byId.get(at.parentId);
    }
    // The same chain the opening Cards read (`settingsForDeck`): Deck settings
    // only, so a Note's first and later directions follow one ladder.
    ladders.set(deck.id, resolveDeckSettings(chain).ladder);
  }
  return ladders;
}

function progressionCard(row: {
  direction: string;
  slot: number;
  state: string;
  stability: number | null;
  suspendedAt: Date | null;
}): ProgressionCard {
  return {
    direction: row.direction as ProgressionCard['direction'],
    slot: row.slot,
    state: row.state as ProgressionCard['state'],
    stability: row.stability,
    suspended: row.suspendedAt !== null,
  };
}

export interface ProgressOptions {
  readonly now: Date;
  /** The revision stamped on everything written. Taken when absent. */
  readonly rev?: number;
  /** The answer that may have qualified these Notes, recorded as provenance. */
  readonly reviewId?: string;
  /**
   * An answer that was just undone. Directions it opened are taken back if they
   * no longer qualify and have never been answered, suspended or otherwise used.
   */
  readonly undoneReviewId?: string;
}

export interface ProgressOutcome {
  readonly opened: CardRow[];
  readonly retracted: string[];
}

/**
 * Opens every direction these Notes now qualify for, and takes back what an
 * undone answer opened if it no longer qualifies.
 *
 * The caller holds the account lock.
 *
 * @param tx the transaction
 * @param userId whose Notes
 * @param noteIds which Notes to evaluate
 * @param options clock, revision and provenance
 * @returns the Cards created and the ids taken back
 */
export async function progressNotes(
  tx: Tx,
  userId: string,
  noteIds: readonly string[],
  options: ProgressOptions,
): Promise<ProgressOutcome> {
  const ids = [...new Set(noteIds)];
  if (ids.length === 0) return { opened: [], retracted: [] };
  const ladders = await laddersByDeck(tx, userId);
  const noteRows = await tx
    .select({
      id: notes.id,
      deckId: notes.deckId,
      status: notes.status,
      fields: notes.fields,
      type: noteTypes.name,
    })
    .from(notes)
    .innerJoin(noteTypes, eq(noteTypes.id, notes.noteTypeId))
    .where(
      and(
        eq(notes.userId, userId),
        inArray(notes.id, ids),
        isNull(notes.deletedAt),
        isNull(notes.purgedAt),
      ),
    );
  const eligible = noteRows.filter((note) => {
    const ladder = ladders.get(note.deckId);
    return ladder !== undefined && (ladderProgresses(ladder) || options.undoneReviewId);
  });
  if (eligible.length === 0) return { opened: [], retracted: [] };
  const cardRows = await tx
    .select()
    .from(cards)
    .where(
      and(
        eq(cards.userId, userId),
        inArray(
          cards.noteId,
          eligible.map((note) => note.id),
        ),
        isNull(cards.deletedAt),
      ),
    );

  let rev = options.rev;
  const revision = async () => (rev ??= await nextRev(tx, userId));
  const opened: CardRow[] = [];
  const retracted: string[] = [];
  const creations: { noteId: string; deckId: string; card: PlannedCard }[] = [];

  const cardsByNote = new Map<string, CardRow[]>();
  for (const card of cardRows)
    cardsByNote.set(card.noteId, [...(cardsByNote.get(card.noteId) ?? []), card]);

  for (const note of eligible) {
    const ladder = ladders.get(note.deckId)!;
    const own = cardsByNote.get(note.id) ?? [];
    const candidates =
      options.undoneReviewId === undefined
        ? []
        : own.filter((card) => card.unlockedByReviewId === options.undoneReviewId);
    const kept = own.filter((card) => !candidates.includes(card));
    const progress = directionProgress({
      noteType: note.type as NoteTypeName,
      fields: note.fields as NoteFields,
      ladder,
      cards: kept.map(progressionCard),
      active: note.status === 'active',
    });
    const stillQualifies = new Set(progress.unlock.map((card) => `${card.direction}:${card.slot}`));
    const present = new Set(kept.map((card) => `${card.direction}:${card.slot}`));

    for (const card of candidates) {
      const key = `${card.direction}:${card.slot}`;
      const untouched =
        card.reps === 0 &&
        card.state === 'new' &&
        card.suspendedAt === null &&
        card.resetAt === null &&
        (
          await tx
            .select({ id: reviews.id })
            .from(reviews)
            .where(and(eq(reviews.userId, userId), eq(reviews.cardId, card.id)))
            .limit(1)
        ).length === 0;
      if (stillQualifies.has(key) || !untouched) {
        present.add(key);
        continue;
      }
      const at = await revision();
      await tx
        .update(cards)
        .set({ deletedAt: options.now, updatedAt: options.now, rev: at })
        .where(and(eq(cards.userId, userId), eq(cards.id, card.id), isNull(cards.deletedAt)));
      retracted.push(card.id);
    }

    for (const card of progress.unlock) {
      if (present.has(`${card.direction}:${card.slot}`)) continue;
      creations.push({ noteId: note.id, deckId: note.deckId, card });
    }
  }

  // One statement per few hundred Cards: a catch-up over thousands of Notes is
  // a handful of round trips rather than one per Note.
  for (let start = 0; start < creations.length; start += 500) {
    const at = await revision();
    const written = await tx
      .insert(cards)
      .values(
        creations.slice(start, start + 500).map(({ noteId, deckId, card }) => ({
          id: uuidV7(),
          userId,
          noteId,
          deckId,
          direction: card.direction,
          slot: card.slot,
          state: 'new',
          due: options.now,
          unlockedAt: options.now,
          unlockReason: 'ladder',
          unlockedByReviewId: options.reviewId ?? null,
          rev: at,
        })),
      )
      .onConflictDoNothing({
        target: [cards.noteId, cards.direction, cards.slot],
        where: sql`${cards.deletedAt} is null`,
      })
      .returning();
    opened.push(...written);
  }

  return { opened, retracted };
}

/** Placeholder fields: which directions Vocabulary and Basic produce never depends on content. */
const SHAPE_FIELDS: Partial<Record<NoteTypeName, NoteFields>> = {
  vocab: { term: 'x', translation: 'x' } as NoteFields,
  basic: { front: 'x', back: 'x' } as NoteFields,
};

/**
 * Opens what existing Notes already qualify for.
 *
 * Learners who answered before progression existed, a ladder whose threshold
 * was lowered, and a Note returned to Study all have Notes that qualify without
 * a new answer. Planning runs this first, over the Decks it plans, so the plan
 * and the forecast see the Cards the ladder owes.
 *
 * Cheap when there is nothing to do, which is almost always: one read of the
 * planned Decks' Cards with their Note's type and status, evaluated in memory.
 * Only Notes that qualify are read in full, under the account lock, and decided
 * again there.
 *
 * Cards opened here carry no answer as provenance, so no Undo takes them back.
 *
 * @param tx the transaction
 * @param userId whose collection
 * @param deckIds the Decks being planned
 * @param now the clock
 * @returns the Cards created
 */
export async function sweepProgression(
  tx: Tx,
  userId: string,
  deckIds: readonly string[],
  now: Date,
): Promise<CardRow[]> {
  const ladders = await laddersByDeck(tx, userId);
  const scope = deckIds.filter((id) => {
    const ladder = ladders.get(id);
    return ladder !== undefined && ladderProgresses(ladder);
  });
  if (scope.length === 0) return [];
  const rows = await tx
    .select({
      noteId: cards.noteId,
      deckId: notes.deckId,
      type: noteTypes.name,
      direction: cards.direction,
      slot: cards.slot,
      state: cards.state,
      stability: cards.stability,
      suspendedAt: cards.suspendedAt,
    })
    .from(cards)
    .innerJoin(notes, and(eq(notes.id, cards.noteId), eq(notes.userId, userId)))
    .innerJoin(noteTypes, eq(noteTypes.id, notes.noteTypeId))
    .where(
      and(
        eq(cards.userId, userId),
        inArray(cards.deckId, scope),
        eq(notes.deckId, cards.deckId),
        isNull(cards.deletedAt),
        eq(notes.status, 'active'),
        isNull(notes.deletedAt),
        isNull(notes.purgedAt),
      ),
    );
  const byNote = new Map<string, typeof rows>();
  for (const row of rows) byNote.set(row.noteId, [...(byNote.get(row.noteId) ?? []), row]);
  const candidates: string[] = [];
  for (const [noteId, own] of byNote) {
    const first = own[0]!;
    const fields = SHAPE_FIELDS[first.type as NoteTypeName];
    if (!fields) continue;
    const progress = directionProgress({
      noteType: first.type as NoteTypeName,
      fields,
      ladder: ladders.get(first.deckId)!,
      cards: own.map(progressionCard),
      active: true,
    });
    if (progress.unlock.length > 0) candidates.push(noteId);
  }
  if (candidates.length === 0) return [];
  await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for('update');
  const opened: CardRow[] = [];
  for (let at = 0; at < candidates.length; at += 500) {
    // A revision is taken only when the exact check still finds work.
    const outcome = await progressNotes(tx, userId, candidates.slice(at, at + 500), { now });
    opened.push(...outcome.opened);
  }
  return opened;
}

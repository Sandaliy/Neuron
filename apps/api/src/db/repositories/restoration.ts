import { and, count, eq, isNotNull, isNull, sql } from 'drizzle-orm';

import type { RestoreNoteResult } from '@neuron/shared';

import { cards, decks, notes } from '../schema/index.js';

import type { Tx } from './session.js';

export class RestoreDependency extends Error {
  override readonly name = 'RestoreDependency';

  constructor() {
    super('the original parent must be live');
  }
}

/** Call under the user's write lock. Check the actual parent chain, including legacy rows. */
export async function requireLiveDeck(tx: Tx, userId: string, id: string): Promise<string[]> {
  let current: string | null = id;
  const seen = new Set<string>();
  while (current !== null) {
    if (seen.has(current) || seen.size > 8) throw new RestoreDependency();
    seen.add(current);
    const [deck] = await tx
      .select({ parentId: decks.parentId, deletedAt: decks.deletedAt })
      .from(decks)
      .where(and(eq(decks.userId, userId), eq(decks.id, current)))
      .limit(1);
    if (!deck || deck.deletedAt !== null) throw new RestoreDependency();
    current = deck.parentId;
  }
  return [...seen].reverse();
}

/** Follow parent links so legacy sync rows with incomplete paths cannot escape deletion. */
export async function softDeleteDeck(
  tx: Tx,
  userId: string,
  id: string,
  rev: number,
  now: Date,
): Promise<number> {
  const marked = await tx
    .update(decks)
    .set({ deletedAt: now, updatedAt: now, rev })
    .where(
      and(
        eq(decks.userId, userId),
        isNull(decks.deletedAt),
        sql`${decks.id} in (
      with recursive subtree(id) as (
        select id from decks where user_id = ${userId} and id = ${id}
        union
        select child.id from decks child join subtree parent on child.parent_id = parent.id
        where child.user_id = ${userId}
      ) select id from subtree
    )`,
      ),
    )
    .returning({ id: decks.id });
  return marked.length;
}

/** Restore identity and fields unchanged. The caller owns the transaction and revision lock. */
export async function restoreNote(
  tx: Tx,
  userId: string,
  id: string,
  rev: number,
  now: Date,
): Promise<RestoreNoteResult> {
  const [note] = await tx
    .select()
    .from(notes)
    .where(and(eq(notes.userId, userId), eq(notes.id, id)))
    .limit(1);
  if (!note) return { restored: false, cardsRestored: 0, cardsRemainingDeleted: 0 };

  let cardsRestored = 0;
  if (note.deletedAt !== null) {
    await requireLiveDeck(tx, userId, note.deckId);
    await tx
      .update(notes)
      .set({ deletedAt: null, updatedAt: now, rev })
      .where(and(eq(notes.userId, userId), eq(notes.id, id)));
    const restored = await tx
      .update(cards)
      .set({ deletedAt: null, deletedWithNote: false, updatedAt: now, rev })
      .where(
        and(
          eq(cards.userId, userId),
          eq(cards.noteId, id),
          isNotNull(cards.deletedAt),
          eq(cards.deletedWithNote, true),
        ),
      )
      .returning({ id: cards.id });
    cardsRestored = restored.length;
  }
  const [remaining] = await tx
    .select({ total: count() })
    .from(cards)
    .where(and(eq(cards.userId, userId), eq(cards.noteId, id), isNotNull(cards.deletedAt)));
  return {
    restored: note.deletedAt !== null,
    cardsRestored,
    cardsRemainingDeleted: remaining?.total ?? 0,
  };
}

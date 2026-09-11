import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import { cards, decks, notes, syncConflicts } from '../schema/index.js';

import { RestoreDependency } from './restoration.js';
import { nextRev } from './session.js';

import type { Runner, Tx } from './session.js';

export type PurgeTarget = 'decks' | 'notes';
export interface PurgeImpact {
  name: string;
  folders: number;
  decks: number;
  notes: number;
  cards: number;
}

/** Follow ownership links, including independently deleted descendants. */
async function affected(tx: Tx, userId: string, target: PurgeTarget, id: string) {
  const allDecks = await tx.select().from(decks).where(eq(decks.userId, userId));
  const root =
    target === 'decks'
      ? allDecks.find((row) => row.id === id)
      : (
          await tx
            .select()
            .from(notes)
            .where(and(eq(notes.userId, userId), eq(notes.id, id)))
            .limit(1)
        )[0];
  if (!root || root.deletedAt === null) throw new RestoreDependency();
  const ids = new Set(target === 'decks' ? [id] : []);
  let size = -1;
  while (size !== ids.size) {
    size = ids.size;
    for (const row of allDecks) if (row.parentId && ids.has(row.parentId)) ids.add(row.id);
  }
  const deckRows = allDecks.filter((row) => ids.has(row.id) && row.purgedAt === null);
  const noteRows = await tx
    .select()
    .from(notes)
    .where(
      and(
        eq(notes.userId, userId),
        isNull(notes.purgedAt),
        target === 'notes' ? eq(notes.id, id) : inArray(notes.deckId, [...ids]),
      ),
    );
  const noteIds = noteRows.map((row) => row.id);
  const cardRows = noteIds.length
    ? await tx
        .select({ id: cards.id })
        .from(cards)
        .where(
          and(eq(cards.userId, userId), inArray(cards.noteId, noteIds), isNull(cards.purgedAt)),
        )
    : [];
  const fields = 'fields' in root ? (root.fields as Record<string, unknown>) : {};
  const name =
    'name' in root ? root.name : String(fields['term'] ?? fields['front'] ?? fields['text'] ?? '');
  return {
    root,
    deckRows,
    noteIds,
    cardIds: cardRows.map((row) => row.id),
    impact: {
      name,
      folders: deckRows.filter((row) => row.kind === 'folder').length,
      decks: deckRows.filter((row) => row.kind === 'deck').length,
      notes: noteRows.length,
      cards: cardRows.length,
    },
  };
}

export function purgeRepository(userId: string, run: Runner) {
  return {
    impact: (target: PurgeTarget, id: string): Promise<PurgeImpact> =>
      run(async (tx) => (await affected(tx, userId, target, id)).impact),
    remove: (target: PurgeTarget, id: string): Promise<PurgeImpact> =>
      run(async (tx) => {
        const rev = await nextRev(tx, userId);
        const found = await affected(tx, userId, target, id);
        if (found.root.purgedAt) return found.impact;
        const now = new Date();
        const mark = { purgedAt: now, deletedAt: now, updatedAt: now, rev };
        if (found.cardIds.length)
          await tx
            .update(cards)
            .set({ ...mark, deletedWithNote: false })
            .where(and(eq(cards.userId, userId), inArray(cards.id, found.cardIds)));
        if (found.noteIds.length)
          await tx
            .update(notes)
            .set({ ...mark, fields: sql`'{}'::jsonb`, tags: [], source: null, rank: null })
            .where(and(eq(notes.userId, userId), inArray(notes.id, found.noteIds)));
        const deckIds = found.deckRows.map((row) => row.id);
        if (deckIds.length)
          await tx
            .update(decks)
            .set({ ...mark, name: '', settings: null, deletionId: null })
            .where(and(eq(decks.userId, userId), inArray(decks.id, deckIds)));
        const ids = [...deckIds, ...found.noteIds, ...found.cardIds];
        const conflictEntities = [
          deckIds.length
            ? and(eq(syncConflicts.entity, 'decks'), inArray(syncConflicts.entityId, deckIds))
            : undefined,
          found.noteIds.length
            ? and(eq(syncConflicts.entity, 'notes'), inArray(syncConflicts.entityId, found.noteIds))
            : undefined,
          found.cardIds.length
            ? and(eq(syncConflicts.entity, 'cards'), inArray(syncConflicts.entityId, found.cardIds))
            : undefined,
        ].filter(
          (condition): condition is NonNullable<typeof condition> => condition !== undefined,
        );
        if (ids.length && conflictEntities.length)
          await tx
            .update(syncConflicts)
            .set({ losing: {}, kept: null })
            .where(and(eq(syncConflicts.userId, userId), or(...conflictEntities)));
        return found.impact;
      }),
  };
}

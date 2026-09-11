import { and, count, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';

import { uuidV7 } from '@neuron/shared';
import type { RestoreNoteResult } from '@neuron/shared';

import { cards, decks, notes } from '../schema/index.js';

import type { Tx } from './session.js';

export class InvalidCollectionKind extends Error {
  override readonly name = 'InvalidCollectionKind';
  constructor() {
    super('invalid collection kind for this operation');
  }
}

export class RestoreDependency extends Error {
  override readonly name = 'RestoreDependency';

  constructor() {
    super('the original parent must be live');
  }
}

/** Call under the user's write lock. Check the actual parent chain, including legacy rows. */
export async function requireLiveDeck(
  tx: Tx,
  userId: string,
  id: string,
  kind?: 'folder' | 'deck',
): Promise<string[]> {
  let current: string | null = id;
  const seen = new Set<string>();
  while (current !== null) {
    if (seen.has(current) || seen.size > 8) throw new RestoreDependency();
    seen.add(current);
    const [deck] = await tx
      .select({ parentId: decks.parentId, deletedAt: decks.deletedAt, kind: decks.kind })
      .from(decks)
      .where(and(eq(decks.userId, userId), eq(decks.id, current)))
      .limit(1);
    if (!deck || deck.deletedAt !== null) throw new RestoreDependency();
    if (
      (current === id && kind && deck.kind !== kind) ||
      (current !== id && deck.kind !== 'folder')
    )
      throw new InvalidCollectionKind();
    current = deck.parentId;
  }
  return [...seen].reverse();
}

/** Rebuild every materialized path from parent links, including tombstones. */
export async function rewriteDeckSubtree(
  tx: Tx,
  userId: string,
  id: string,
  newPath: readonly string[],
  rev: number,
  now: Date,
): Promise<void> {
  const prefix =
    newPath.length === 0
      ? sql`ARRAY[]::uuid[]`
      : sql`ARRAY[${sql.join(
          newPath.map((ancestor) => sql`${ancestor}`),
          sql`, `,
        )}]::uuid[]`;

  await tx.execute(sql`
    WITH RECURSIVE subtree(id, relative_path, visited) AS (
      SELECT root.id, ARRAY[]::uuid[], ARRAY[root.id]::uuid[]
      FROM decks root
      WHERE root.user_id = ${userId} AND root.id = ${id}
      UNION ALL
      SELECT child.id, subtree.relative_path || subtree.id, subtree.visited || child.id
      FROM decks child
      JOIN subtree ON child.parent_id = subtree.id
      WHERE child.user_id = ${userId} AND NOT child.id = ANY(subtree.visited)
    )
    UPDATE decks target
    SET path = ${prefix} || subtree.relative_path,
        updated_at = ${now},
        rev = ${rev}
    FROM subtree
    WHERE target.user_id = ${userId} AND target.id = subtree.id
  `);
}

/** Follow parent links so legacy sync rows with incomplete paths cannot escape deletion. */
export async function softDeleteDeck(
  tx: Tx,
  userId: string,
  id: string,
  rev: number,
  now: Date,
): Promise<number> {
  const [root] = await tx
    .select()
    .from(decks)
    .where(and(eq(decks.userId, userId), eq(decks.id, id)))
    .limit(1);
  if (!root || root.purgedAt) return 0;
  // A later explicit delete of an included child becomes its own operation.
  // Retrying that child delete is then a no-op because its parent has another ID.
  let detach = false;
  if (root.deletedAt !== null) {
    if (root.parentId && root.deletionId) {
      const [parent] = await tx
        .select({ deletionId: decks.deletionId })
        .from(decks)
        .where(and(eq(decks.userId, userId), eq(decks.id, root.parentId)))
        .limit(1);
      detach = parent?.deletionId === root.deletionId;
    }
    if (!detach) return 0;
  }
  const deletionId = uuidV7();
  const marked = await tx
    .update(decks)
    .set({ deletedAt: now, updatedAt: now, rev, deletionId })
    .where(
      and(
        eq(decks.userId, userId),
        isNull(decks.purgedAt),
        detach && root.deletionId
          ? or(isNull(decks.deletedAt), eq(decks.deletionId, root.deletionId))
          : isNull(decks.deletedAt),
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
  if (note?.purgedAt) throw new RestoreDependency();
  if (!note) return { restored: false, cardsRestored: 0, cardsRemainingDeleted: 0 };

  let cardsRestored = 0;
  if (note.deletedAt !== null) {
    await requireLiveDeck(tx, userId, note.deckId, 'deck');
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

/** Recover only the connected subtree attributed to this server-owned operation. */
export async function restoreDeck(
  tx: Tx,
  userId: string,
  id: string,
  rev: number,
  now: Date,
): Promise<number> {
  const [root] = await tx
    .select()
    .from(decks)
    .where(and(eq(decks.userId, userId), eq(decks.id, id)))
    .limit(1);
  if (!root || root.purgedAt) throw new RestoreDependency();
  if (root.deletedAt === null) return 0;
  if (root.parentId !== null) await requireLiveDeck(tx, userId, root.parentId, 'folder');
  const restored = await tx
    .update(decks)
    .set({ deletedAt: null, deletionId: null, updatedAt: now, rev })
    .where(
      and(
        eq(decks.userId, userId),
        isNull(decks.purgedAt),
        sql`${decks.id} in (
      with recursive recovery(id) as (
        select id from decks where id=${id} and user_id=${userId}
        union
        select c.id from decks c join recovery p on c.parent_id=p.id
        where c.user_id=${userId} and c.deletion_id=${root.deletionId}::uuid and c.purged_at is null
      ) select id from recovery
    )`,
      ),
    )
    .returning({ id: decks.id });
  return restored.length;
}

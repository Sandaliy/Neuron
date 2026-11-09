import { createHash } from 'node:crypto';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { openingCards, parseNoteFields, resolveDeckSettings, uuidV7 } from '@neuron/shared';
import type { DeckSettings, NoteFields, NoteStatus, NoteTypeName } from '@neuron/shared';

import { decks, importBatches, notes, noteTypes, syncReceipts, user } from '../schema/index.js';

import { requireLiveDeck } from './restoration.js';

import type { Runner } from './session.js';

const REVISION_ROWS = 200;

export class ImportConflict extends Error {
  override readonly name = 'ImportConflict';
  constructor() {
    super('the frozen import cannot be applied');
  }
}

export interface ImportWriteNote {
  readonly id?: string | undefined;
  readonly noteType: NoteTypeName;
  readonly fields: NoteFields;
  readonly tags?: readonly string[] | undefined;
  readonly source?: string | null | undefined;
  readonly rank?: number | null | undefined;
  readonly status?: NoteStatus | undefined;
}

/** Undo commits atomically and publishes bounded groups of Note and Card tombstones. */
export function undoImport(userId: string, run: Runner, id: string): Promise<number> {
  return run(async (tx) => {
    const [account] = await tx
      .select({ revision: user.currentRev })
      .from(user)
      .where(eq(user.id, userId))
      .for('update');
    const [batch] = await tx
      .select({ undoneAt: importBatches.undoneAt })
      .from(importBatches)
      .where(
        and(
          eq(importBatches.userId, userId),
          eq(importBatches.id, id),
          isNull(importBatches.deletedAt),
        ),
      );
    if (!account || !batch || batch.undoneAt) return 0;

    const now = new Date();
    const stamp = now.toISOString();
    const marked = await tx.execute<{ id: string }>(sql`
      with ranked as (
        select id, (row_number() over (order by id) - 1) / ${REVISION_ROWS} as group_number
        from notes
        where user_id = ${userId} and import_batch_id = ${id}::uuid and deleted_at is null
      )
      update notes n
      set deleted_at = ${stamp}::timestamptz, updated_at = ${stamp}::timestamptz,
          rev = ${account.revision + 1} + ranked.group_number
      from ranked where n.user_id = ${userId} and n.id = ranked.id
      returning n.id
    `);
    let revision = account.revision + Math.ceil(marked.rows.length / REVISION_ROWS);
    if (marked.rows.length) {
      const result = await tx.execute<{ count: number }>(sql`
        with ranked as (
          select id, (row_number() over (order by id) - 1) / ${REVISION_ROWS} as group_number
          from cards
          where user_id = ${userId} and deleted_at is null
            and note_id = any(${sql.param(marked.rows.map((row) => row.id))}::uuid[])
        ), changed as (
          update cards c
          set deleted_at = ${stamp}::timestamptz, updated_at = ${stamp}::timestamptz,
              deleted_with_note = true, rev = ${revision + 1} + ranked.group_number
          from ranked where c.user_id = ${userId} and c.id = ranked.id
          returning c.id
        )
        select count(*)::int as count from changed
      `);
      revision += Math.ceil(result.rows[0]!.count / REVISION_ROWS);
    }
    const batchRevision = revision + 1;
    await tx
      .update(importBatches)
      .set({ undoneAt: now, updatedAt: now, rev: batchRevision })
      .where(and(eq(importBatches.userId, userId), eq(importBatches.id, id)));
    await tx
      .update(user)
      .set({ currentRev: batchRevision, updatedAt: now })
      .where(eq(user.id, userId));
    return marked.rows.length;
  });
}

/** Import-only bulk writes. The user lock orders delivery against Undo and collection mutations. */
export async function appendImport(
  userId: string,
  run: Runner,
  id: string,
  inputs: readonly ImportWriteNote[],
) {
  // Repository validation remains authoritative even for callers other than HTTP routes.
  const parsed = inputs.map((note) => ({
    ...note,
    id: note.id?.toLowerCase() ?? uuidV7(),
    fields: parseNoteFields(note.noteType, note.fields),
  }));
  if (new Set(parsed.map((note) => note.id)).size !== parsed.length) throw new ImportConflict();
  return run(async (tx) => {
    const [account] = await tx
      .select({ revision: user.currentRev })
      .from(user)
      .where(eq(user.id, userId))
      .for('update');
    if (!account) throw new ImportConflict();
    const [batch] = await tx
      .select()
      .from(importBatches)
      .where(
        and(
          eq(importBatches.userId, userId),
          eq(importBatches.id, id),
          isNull(importBatches.deletedAt),
        ),
      )
      .limit(1);
    if (!batch) return undefined;
    if (batch.undoneAt) throw new ImportConflict();
    if (!parsed.length) return { notes: 0, cards: 0, skipped: 0 };
    const chain = await requireLiveDeck(tx, userId, batch.deckId, 'deck');
    const existing = await tx
      .select({
        id: notes.id,
        batchId: notes.importBatchId,
        deckId: notes.deckId,
        deletedAt: notes.deletedAt,
      })
      .from(notes)
      .where(
        and(
          eq(notes.userId, userId),
          inArray(
            notes.id,
            parsed.map((note) => note.id),
          ),
        ),
      );
    if (
      existing.some(
        (note) => note.batchId !== batch.id || note.deckId !== batch.deckId || note.deletedAt,
      )
    )
      throw new ImportConflict();
    const known = new Set(existing.map((note) => note.id));
    const pending = parsed.filter((note) => !known.has(note.id));
    if (!pending.length) return { notes: 0, cards: 0, skipped: parsed.length };
    const types = await tx
      .select({ id: noteTypes.id, name: noteTypes.name })
      .from(noteTypes)
      .where(
        and(
          inArray(noteTypes.name, [...new Set(pending.map((note) => note.noteType))]),
          isNull(noteTypes.deletedAt),
        ),
      );
    const typeIds = new Map(types.map((type) => [type.name, type.id]));
    const ancestors = await tx
      .select({ id: decks.id, settings: decks.settings })
      .from(decks)
      .where(and(eq(decks.userId, userId), inArray(decks.id, chain)));
    const byId = new Map(ancestors.map((deck) => [deck.id, deck.settings]));
    const settings = resolveDeckSettings(
      chain.map((deckId) => byId.get(deckId) as DeckSettings | null),
    );
    const planned = pending.flatMap((note) =>
      openingCards(note.noteType, note.fields, settings.ladder).map(({ direction, slot }) => ({
        id: uuidV7(),
        noteId: note.id,
        direction,
        slot,
      })),
    );
    const noteRevisions = Math.ceil(pending.length / REVISION_ROWS);
    const revisions = noteRevisions + Math.ceil(planned.length / REVISION_ROWS);
    // Reserve the whole range once, after confirming that this chunk has new rows.
    const rev = account.revision + 1;
    const batchRev = rev + revisions - 1;
    await tx
      .update(user)
      .set({ currentRev: batchRev, updatedAt: new Date() })
      .where(eq(user.id, userId));
    const values = pending.map((note, index) => ({
      ...note,
      noteTypeId: typeIds.get(note.noteType),
      tags: note.tags ?? [],
      source: note.source ?? batch.source,
      rank: note.rank ?? null,
      status: note.status ?? 'active',
      rev: rev + Math.floor(index / REVISION_ROWS),
    }));
    if (values.some((note) => !note.noteTypeId)) throw new ImportConflict();
    // One bound JSON value avoids thousands of SQL fragments/parameters and full-row return allocations.
    const inserted = await tx.execute<{ id: string }>(sql`
      insert into notes (id, user_id, deck_id, note_type_id, fields, tags, source, rank, status, import_batch_id, rev)
      select r.id, ${userId}, ${batch.deckId}::uuid, r."noteTypeId", r.fields, r.tags, r.source, r.rank, r.status, ${id}::uuid, r.rev
      from jsonb_to_recordset(${JSON.stringify(values)}::jsonb)
        as r(id uuid, "noteTypeId" uuid, fields jsonb, tags text[], source text, rank integer, status text, rev bigint)
      on conflict do nothing returning id
    `);
    // RLS may hide a conflicting foreign ID. Never turn that into a successful missing row.
    if (inserted.rows.length !== pending.length) throw new ImportConflict();
    const now = new Date().toISOString();
    for (let start = 0; start < planned.length; start += 2000) {
      const rows = planned.slice(start, start + 2000).map((card, index) => ({
        ...card,
        rev: rev + noteRevisions + Math.floor((start + index) / REVISION_ROWS),
      }));
      await tx.execute(sql`
        insert into cards (id, user_id, note_id, deck_id, direction, slot, due, unlocked_at, unlock_reason, rev)
        select r.id, ${userId}, r."noteId", ${batch.deckId}::uuid, r.direction, r.slot, ${now}::timestamptz, ${now}::timestamptz, 'opening', r.rev
        from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as r(id uuid, "noteId" uuid, direction text, slot integer, rev bigint)
      `);
    }
    await tx
      .update(importBatches)
      .set({
        noteCount: sql`${importBatches.noteCount} + ${pending.length}`,
        updatedAt: new Date(now),
        rev: batchRev,
      })
      .where(and(eq(importBatches.userId, userId), eq(importBatches.id, id)));
    return { notes: pending.length, cards: planned.length, skipped: existing.length };
  });
}

/** The caller holds the account lock and commits the receipt with the fill-blank edit. */
export function pendingImportMerge(
  userId: string,
  run: Runner,
  attemptId: string,
  noteId: string,
  deckId: string,
  noteType: NoteTypeName,
  fields: NoteFields,
) {
  return run(async (tx) => {
    const fingerprint = `import-merge:${attemptId.toLowerCase()}:${noteId.toLowerCase()}`;
    const digest = createHash('sha256')
      .update(JSON.stringify([deckId.toLowerCase(), noteType, fields]))
      .digest('hex');
    const [receipt] = await tx
      .select({ outcome: syncReceipts.outcome })
      .from(syncReceipts)
      .where(and(eq(syncReceipts.userId, userId), eq(syncReceipts.fingerprint, fingerprint)));
    if (receipt) {
      if (receipt.outcome.importMerge?.digest !== digest) throw new ImportConflict();
      return undefined;
    }
    return async () => {
      await tx
        .insert(syncReceipts)
        .values({ userId, fingerprint, outcome: { clamped: false, importMerge: { digest } } });
    };
  });
}

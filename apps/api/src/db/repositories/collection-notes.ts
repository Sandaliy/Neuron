import { createHash } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';

import { parseNoteFields } from '@neuron/shared';
import type { EditOfflineNoteCommand, EditOfflineNoteResult, NoteTypeName } from '@neuron/shared';

import { ApiError } from '../../errors.js';
import { applyCardChange, planCardChange } from '../../note-cards.js';
import { notes, syncReceipts, user } from '../schema/index.js';

import { cardRepository } from './cards.js';
import { deckRepository } from './decks.js';
import { noteTypeRepository } from './note-types.js';
import { noteRepository } from './notes.js';
import { requireLiveDeck, RestoreDependency } from './restoration.js';
import { reviewRepository } from './reviews.js';

import type { Runner } from './session.js';

/** Exact retry and Note-specific compare-and-set share the account write lock. */
export function collectionNoteRepository(userId: string, run: Runner) {
  return {
    edit: (id: string, command: EditOfflineNoteCommand): Promise<EditOfflineNoteResult> =>
      run(async (tx) => {
        if (command.accountId !== userId) throw new ApiError('sync_rejected');
        await tx.execute(
          sql`select ${user.id} from ${user} where ${user.id} = ${userId} for update`,
        );
        const fingerprint = `note-edit:${command.operationId}`;
        const digest = createHash('sha256')
          .update(
            JSON.stringify([id, command.accountId, command.baseRev, command.fields, command.tags]),
          )
          .digest('hex');
        const [receipt] = await tx
          .select()
          .from(syncReceipts)
          .where(and(eq(syncReceipts.userId, userId), eq(syncReceipts.fingerprint, fingerprint)));
        if (receipt) {
          if (receipt.outcome.noteEdit?.digest !== digest) throw new ApiError('sync_rejected');
          return receipt.outcome.noteEdit.result;
        }

        const [stored] = await tx
          .select()
          .from(notes)
          .where(and(eq(notes.userId, userId), eq(notes.id, id)));
        let deleted = !stored || stored.deletedAt !== null || stored.purgedAt !== null;
        if (!deleted) {
          try {
            await requireLiveDeck(tx, userId, stored!.deckId);
          } catch (error) {
            if (error instanceof RestoreDependency) deleted = true;
            else throw error;
          }
        }
        let result: EditOfflineNoteResult;
        if (deleted || stored!.rev !== command.baseRev) {
          result = {
            operationId: command.operationId,
            status: 'conflict',
            revision: stored?.rev ?? 0,
            reason: deleted ? 'deleted_remotely' : 'changed_remotely',
          };
        } else {
          const within: Runner = async (work) => work(tx);
          const inner = {
            decks: deckRepository(userId, within),
            cards: cardRepository(userId, within),
            reviews: reviewRepository(userId, within),
          };
          const noteRepo = noteRepository(userId, within);
          const names = await noteTypeRepository(userId, within).namesById();
          const noteType = names.get(stored!.noteTypeId) as NoteTypeName | undefined;
          if (!noteType) throw new ApiError('invalid_request');
          const fields = parseNoteFields(noteType, command.fields);
          const change = await planCardChange(
            inner,
            id,
            stored!.deckId,
            noteType,
            fields,
            noteType,
          );
          if (change.remove.length > 0) {
            result = {
              operationId: command.operationId,
              status: 'unsupported',
              revision: stored!.rev,
              reason: 'cards_would_be_lost',
            };
          } else {
            await noteRepo.updateFields(id, fields);
            await applyCardChange(inner, id, change);
            const row = await noteRepo.setTags(id, command.tags);
            if (!row) throw new ApiError('not_found');
            result = { operationId: command.operationId, status: 'applied', revision: row.rev };
          }
        }
        await tx.insert(syncReceipts).values({
          userId,
          fingerprint,
          outcome: { clamped: false, noteEdit: { digest, result } },
        });
        return result;
      }),
  };
}

import { createHash } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';

import type { RenameDeckCommand, RenameDeckResult } from '@neuron/shared';

import { ApiError } from '../../errors.js';
import { decks, syncReceipts, user } from '../schema/index.js';

import { requireLiveDeck, RestoreDependency } from './restoration.js';
import { nextRev } from './session.js';

import type { Runner } from './session.js';

/** Shares the account write lock and immutable receipt authority with sync. */
export function collectionRenameRepository(userId: string, run: Runner) {
  return {
    rename: (id: string, command: RenameDeckCommand): Promise<RenameDeckResult> =>
      run(async (tx) => {
        if (command.accountId !== userId) throw new ApiError('sync_rejected');
        await tx.execute(
          sql`select ${user.id} from ${user} where ${user.id} = ${userId} for update`,
        );
        const fingerprint = `rename:${command.operationId}`;
        const digest = createHash('sha256')
          .update(JSON.stringify([id, command.accountId, command.baseRev, command.name]))
          .digest('hex');
        const [receipt] = await tx
          .select()
          .from(syncReceipts)
          .where(and(eq(syncReceipts.userId, userId), eq(syncReceipts.fingerprint, fingerprint)));
        if (receipt) {
          if (receipt.outcome.rename?.digest !== digest) throw new ApiError('sync_rejected');
          return receipt.outcome.rename.result;
        }
        const [row] = await tx
          .select()
          .from(decks)
          .where(and(eq(decks.userId, userId), eq(decks.id, id)));
        let deleted = !row || row.deletedAt !== null || row.purgedAt !== null;
        if (!deleted) {
          try {
            await requireLiveDeck(tx, userId, id);
          } catch (error) {
            if (error instanceof RestoreDependency) deleted = true;
            else throw error;
          }
        }
        let result: RenameDeckResult;
        if (deleted || row!.rev !== command.baseRev) {
          result = {
            operationId: command.operationId,
            status: 'conflict',
            revision: row?.rev ?? 0,
            reason: deleted ? 'deleted_remotely' : 'changed_remotely',
          };
        } else {
          const revision = await nextRev(tx, userId);
          await tx
            .update(decks)
            .set({ name: command.name, updatedAt: new Date(), rev: revision })
            .where(and(eq(decks.userId, userId), eq(decks.id, id)));
          result = { operationId: command.operationId, status: 'applied', revision };
        }
        // Keep only outcome metadata. The device retains base row and losing intent;
        // server receipts cannot retain purged collection names.
        await tx
          .insert(syncReceipts)
          .values({ userId, fingerprint, outcome: { clamped: false, rename: { digest, result } } });
        return result;
      }),
  };
}

import { createHash } from 'node:crypto';

import { and, eq, isNull, sql } from 'drizzle-orm';

import type { CreateOfflineDeckCommand, CreateOfflineDeckResult } from '@neuron/shared';

import { ApiError } from '../../errors.js';
import { decks, syncReceipts, user } from '../schema/index.js';

import { nextRev } from './session.js';

import type { Runner } from './session.js';

/** Collection creation and its immutable receipt share the account write transaction. */
export function collectionCreationRepository(userId: string, run: Runner) {
  return {
    create: (command: CreateOfflineDeckCommand): Promise<CreateOfflineDeckResult> =>
      run(async (tx) => {
        if (command.accountId !== userId) throw new ApiError('sync_rejected');
        await tx.execute(
          sql`select ${user.id} from ${user} where ${user.id} = ${userId} for update`,
        );
        const fingerprint = `deck-create:${command.operationId}`;
        const digest = createHash('sha256')
          .update(
            JSON.stringify([
              command.accountId,
              command.entityId,
              command.kind,
              command.name,
              command.parentId,
              command.ancestors,
              // Languages joined this command later. A command without them must
              // keep the digest it was first received with, so that an exact
              // retry of an older app's creation still matches its receipt.
              ...(command.settings === undefined
                ? []
                : [[command.settings.targetLanguage, command.settings.nativeLanguage]]),
            ]),
          )
          .digest('hex');
        const [receipt] = await tx
          .select()
          .from(syncReceipts)
          .where(and(eq(syncReceipts.userId, userId), eq(syncReceipts.fingerprint, fingerprint)));
        if (receipt) {
          if (receipt.outcome.deckCreation?.digest !== digest) throw new ApiError('sync_rejected');
          return receipt.outcome.deckCreation.result;
        }
        const identity = { operationId: command.operationId, entityId: command.entityId };
        let result: CreateOfflineDeckResult | undefined;
        // Follow actual parent links, never the materialized path supplied by a client.
        const actual: { id: string; rev: number }[] = [];
        let parentId = command.parentId;
        const seen = new Set([command.entityId]);
        while (parentId !== null) {
          if (seen.has(parentId) || actual.length >= 8) {
            result = { ...identity, status: 'conflict', reason: 'parent_unavailable' };
            break;
          }
          seen.add(parentId);
          const [parent] = await tx
            .select()
            .from(decks)
            .where(and(eq(decks.userId, userId), eq(decks.id, parentId)));
          if (!parent || parent.deletedAt || parent.purgedAt || parent.kind !== 'folder') {
            result = { ...identity, status: 'conflict', reason: 'parent_unavailable' };
            break;
          }
          actual.unshift({ id: parent.id, rev: parent.rev });
          parentId = parent.parentId;
        }
        if (!result && JSON.stringify(actual) !== JSON.stringify(command.ancestors))
          result = { ...identity, status: 'conflict', reason: 'parent_changed' };
        if (!result) {
          const [sameName] = await tx
            .select({ id: decks.id })
            .from(decks)
            .where(
              and(
                eq(decks.userId, userId),
                isNull(decks.deletedAt),
                command.parentId === null
                  ? isNull(decks.parentId)
                  : eq(decks.parentId, command.parentId),
                sql`lower(${decks.name}) = lower(${command.name})`,
              ),
            );
          if (sameName) result = { ...identity, status: 'conflict', reason: 'name_exists' };
        }
        if (!result) {
          const [position] = await tx
            .select({ next: sql<number>`coalesce(max(${decks.position}), -1) + 1` })
            .from(decks)
            .where(
              and(
                eq(decks.userId, userId),
                isNull(decks.deletedAt),
                command.parentId === null
                  ? isNull(decks.parentId)
                  : eq(decks.parentId, command.parentId),
              ),
            );
          // Unique constraints see identities hidden by RLS too. Do not turn a collision
          // into an upsert or disclose the row that already owns this identity.
          const [created] = await tx
            .insert(decks)
            .values({
              id: command.entityId,
              userId,
              kind: command.kind,
              name: command.name,
              parentId: command.parentId,
              path: actual.map((row) => row.id),
              position: position?.next ?? 0,
              // A deck's own languages; nothing else is set at creation.
              settings:
                command.settings === undefined
                  ? null
                  : {
                      targetLanguage: command.settings.targetLanguage,
                      nativeLanguage: command.settings.nativeLanguage,
                    },
              rev: 0,
            })
            .onConflictDoNothing()
            .returning({ id: decks.id });
          if (!created) result = { ...identity, status: 'conflict', reason: 'identity_exists' };
          else {
            const revision = await nextRev(tx, userId);
            await tx
              .update(decks)
              .set({ rev: revision })
              .where(and(eq(decks.userId, userId), eq(decks.id, command.entityId)));
            result = { ...identity, status: 'applied', revision };
          }
        }
        await tx.insert(syncReceipts).values({
          userId,
          fingerprint,
          outcome: { clamped: false, deckCreation: { digest, result } },
        });
        return result;
      }),
  };
}

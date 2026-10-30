import { createHash } from 'node:crypto';

import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { advancePractice, reconcilePractice, uuidV7 } from '@neuron/shared';
import type { PracticeCommand, PracticeRun } from '@neuron/shared';

import { decks, notes, practiceRuns, syncConflicts, syncReceipts, user } from '../schema/index.js';

import { requireLiveDeck } from './restoration.js';
import { nextRev } from './session.js';

import type { Runner, Tx } from './session.js';

export class PracticeConflict extends Error {
  override readonly name = 'PracticeConflict';
}
export function practiceRepository(userId: string, run: Runner) {
  async function read(tx: Tx, deckId: string) {
    await requireLiveDeck(tx, userId, deckId, 'deck');
    const [stored] = await tx
      .select()
      .from(practiceRuns)
      .where(and(eq(practiceRuns.userId, userId), eq(practiceRuns.deckId, deckId)));
    const pool = await tx
      .select({ id: notes.id, fields: notes.fields })
      .from(notes)
      .where(and(eq(notes.userId, userId), eq(notes.deckId, deckId), isNull(notes.deletedAt)))
      .orderBy(asc(notes.createdAt), asc(notes.id));
    return { stored, pool, current: stored ? reconcilePractice(stored.run, pool) : null };
  }
  return {
    // Reading reconciles without writing. The version counts commands only, so a Note
    // changed elsewhere never invalidates commands a device saved while away.
    get: (deckId: string) =>
      run(async (tx) => {
        const { stored, current } = await read(tx, deckId);
        return { run: current, version: stored?.version ?? 0 };
      }),
    /** Stored runs of live Decks, unreconciled: the device reconciles with its own pool. */
    list: () =>
      run(async (tx) => {
        const rows = await tx
          .select({
            deckId: practiceRuns.deckId,
            run: practiceRuns.run,
            version: practiceRuns.version,
          })
          .from(practiceRuns)
          .innerJoin(decks, and(eq(decks.userId, userId), eq(decks.id, practiceRuns.deckId)))
          .where(and(eq(practiceRuns.userId, userId), isNull(decks.deletedAt)))
          .orderBy(asc(practiceRuns.deckId));
        return { runs: rows.filter((row) => row.version > 0) };
      }),
    apply: (deckId: string, command: PracticeCommand) =>
      run(async (tx) => {
        await tx.execute(
          sql`select ${user.id} from ${user} where ${user.id} = ${userId} for update`,
        );
        const { stored, current, pool } = await read(tx, deckId);
        const fingerprint = `practice:${command.id}`;
        const digest = createHash('sha256')
          .update(JSON.stringify([deckId, command]))
          .digest('hex');
        const [receipt] = await tx
          .select()
          .from(syncReceipts)
          .where(and(eq(syncReceipts.userId, userId), eq(syncReceipts.fingerprint, fingerprint)));
        // An exact retry is answered with the present state, even after later commands.
        if (receipt) {
          if (receipt.outcome.practice?.digest !== digest || !stored)
            throw new PracticeConflict('Practice command reused');
          return { run: current, version: stored.version };
        }
        if (stored?.lastOperationId === command.id)
          return { run: current, version: stored.version };
        if ((stored?.version ?? 0) !== command.expectedVersion)
          throw new PracticeConflict('Practice changed on another device');
        let next: PracticeRun;
        try {
          next = advancePractice(current, command, pool);
        } catch {
          throw new PracticeConflict('Practice content changed');
        }
        const rev = await nextRev(tx, userId);
        const version = command.expectedVersion + 1;
        const values = {
          userId,
          deckId,
          run: next,
          version,
          lastOperationId: command.id,
          rev,
          updatedAt: new Date(),
        };
        if (stored) {
          // The learner chose another device's run. The one it replaces stays readable.
          if (command.kind === 'replace' && current)
            await tx.insert(syncConflicts).values({
              id: uuidV7(),
              userId,
              entity: 'practiceRuns',
              entityId: stored.id,
              reason: 'older_update',
              losing: { deckId, version: stored.version, run: current },
              kept: { deckId, version, run: next },
            });
          await tx
            .update(practiceRuns)
            .set(values)
            .where(and(eq(practiceRuns.userId, userId), eq(practiceRuns.id, stored.id)));
        } else await tx.insert(practiceRuns).values({ id: uuidV7(), ...values });
        // Outcome metadata only: a purged collection leaves no content behind here.
        await tx.insert(syncReceipts).values({
          userId,
          fingerprint,
          outcome: { clamped: false, practice: { deckId, digest } },
        });
        return { run: next, version };
      }),
  };
}

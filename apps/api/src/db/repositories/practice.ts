import { isDeepStrictEqual } from 'node:util';

import { and, asc, eq, isNull } from 'drizzle-orm';

import { advancePractice, reconcilePractice, uuidV7 } from '@neuron/shared';
import type { PracticeCommand } from '@neuron/shared';

import { notes, practiceRuns, user } from '../schema/index.js';

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
    get: (deckId: string) =>
      run(async (tx) => {
        await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for('update');
        const { stored, current } = await read(tx, deckId);
        if (stored && current && !isDeepStrictEqual(stored.run, current)) {
          const rev = await nextRev(tx, userId);
          const version = stored.version + 1;
          await tx
            .update(practiceRuns)
            .set({ run: current, version, rev, updatedAt: new Date() })
            .where(and(eq(practiceRuns.userId, userId), eq(practiceRuns.id, stored.id)));
          return { run: current, version };
        }
        return { run: current, version: stored?.version ?? 0 };
      }),
    apply: (deckId: string, command: PracticeCommand) =>
      run(async (tx) => {
        const rev = await nextRev(tx, userId);
        const { stored, current, pool } = await read(tx, deckId);
        if (stored?.lastOperationId === command.id)
          return { run: current, version: stored.version };
        if ((stored?.version ?? 0) !== command.expectedVersion)
          throw new PracticeConflict('Practice changed on another device');
        let next;
        try {
          next = advancePractice(current, command, pool);
        } catch {
          throw new PracticeConflict('Practice content changed');
        }
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
        if (stored)
          await tx
            .update(practiceRuns)
            .set(values)
            .where(and(eq(practiceRuns.userId, userId), eq(practiceRuns.id, stored.id)));
        else await tx.insert(practiceRuns).values({ id: uuidV7(), ...values });
        return { run: next, version };
      }),
  };
}

import { and, eq, isNull } from 'drizzle-orm';

import type { DeckSettings, Locale, Theme } from '@neuron/shared';

import { cards, decks, importBatches, notes, studyPresets, user } from '../schema/index.js';

import { nextRev } from './session.js';

import type { Runner } from './session.js';

/**
 * The user's own row: the preferences on it, and how a person leaves.
 *
 * The application role may read ten columns of `user` and write seven, on its
 * own row only. The name, the email address and the credentials are not among
 * them, so everything here works within that and the parts that do not are
 * somewhere else on purpose.
 */

/** What the application is allowed to know about the person signed in. */
export interface AccountRow {
  readonly id: string;
  readonly locale: string;
  readonly theme: string;
  readonly timezone: string;
  readonly dayCutoffHour: number;
  readonly plan: string;
  readonly settings: DeckSettings;
  readonly currentRev: number;
}

export interface UpdatePreferences {
  readonly locale?: Locale;
  readonly theme?: Theme;
  readonly timezone?: string;
  readonly dayCutoffHour?: number;
  readonly settings?: DeckSettings;
}

export interface AccountRepository {
  read: () => Promise<AccountRow>;
  updatePreferences: (input: UpdatePreferences) => Promise<AccountRow>;
  /**
   * Soft deletes everything the person made.
   *
   * The half of leaving that the application role can do. The other half, which
   * anonymises the name and the email and drops the credentials, needs the
   * authentication connection and lives in the account route.
   *
   * Nothing is removed here and no review is touched. What actually deletes
   * rows is `pnpm db:erase`, which runs as the database owner thirty days
   * later. The request path has no route to a deleted review at all.
   *
   * @returns how many rows were marked
   */
  softDeleteCollection: () => Promise<number>;
}

export function accountRepository(userId: string, run: Runner): AccountRepository {
  const columns = {
    id: user.id,
    locale: user.locale,
    theme: user.theme,
    timezone: user.timezone,
    dayCutoffHour: user.dayCutoffHour,
    plan: user.plan,
    settings: user.settings,
    currentRev: user.currentRev,
  };

  return {
    async read() {
      return run(async (tx) => {
        const [row] = await tx.select(columns).from(user).where(eq(user.id, userId)).limit(1);

        if (!row) {
          throw new Error(`no user row for ${userId}`);
        }

        return row;
      });
    },

    async updatePreferences(input) {
      return run(async (tx) => {
        // A preference change is a change a second device has to hear about,
        // so it takes a version like every other write. The day cutoff hour in
        // particular decides what "today" means, and a phone that missed it
        // would count a session against the wrong day.
        const rev = await nextRev(tx, userId);

        const [row] = await tx
          .update(user)
          .set({
            ...(input.locale === undefined ? {} : { locale: input.locale }),
            ...(input.theme === undefined ? {} : { theme: input.theme }),
            ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
            ...(input.dayCutoffHour === undefined ? {} : { dayCutoffHour: input.dayCutoffHour }),
            ...(input.settings === undefined ? {} : { settings: input.settings }),
            updatedAt: new Date(),
          })
          .where(eq(user.id, userId))
          .returning(columns);

        if (!row) {
          throw new Error(`no user row for ${userId}`);
        }

        return { ...row, currentRev: rev };
      });
    },

    async softDeleteCollection() {
      return run(async (tx) => {
        const rev = await nextRev(tx, userId);
        const now = new Date();
        const marked = { deletedAt: now, updatedAt: now, rev };
        let count = 0;

        for (const table of [cards, notes, decks, studyPresets, importBatches]) {
          const rows = await tx
            .update(table)
            .set(marked)
            .where(and(eq(table.userId, userId), isNull(table.deletedAt)))
            .returning({ id: table.id });

          count += rows.length;
        }

        return count;
      });
    },
  };
}

import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { deckSettingsSchema, uuidV7 } from '@neuron/shared';
import type { DeckSettings } from '@neuron/shared';

import { decks } from '../schema/index.js';

import { nextRev } from './session.js';

import type { Runner, Tx } from './session.js';

/**
 * Decks, which are also folders.
 *
 * The tree is stored as a `path` array of ancestors on every row, so "give me
 * everything under this folder" is one indexed query rather than a walk. The
 * cost of that is keeping the array true, which is what most of this file is
 * about: a move has to rewrite the path of every row underneath the deck being
 * moved, and it has to happen in the transaction that moved it.
 */

export type DeckRow = typeof decks.$inferSelect;

export interface CreateDeck {
  /** Supply one when the client made it offline. Otherwise one is generated. */
  readonly id?: string;
  readonly name: string;
  readonly parentId?: string | null;
  readonly settings?: DeckSettings | null;
}

export interface DeckRepository {
  create: (input: CreateDeck) => Promise<DeckRow>;
  byId: (id: string) => Promise<DeckRow | undefined>;
  list: () => Promise<DeckRow[]>;
  /** The deck itself and everything under it, at any depth. */
  subtree: (id: string) => Promise<DeckRow[]>;
  /** The deck and its ancestors, root first, for resolving settings. */
  chain: (id: string) => Promise<DeckRow[]>;
  rename: (id: string, name: string) => Promise<DeckRow | undefined>;
  updateSettings: (id: string, settings: DeckSettings | null) => Promise<DeckRow | undefined>;
  move: (id: string, parentId: string | null) => Promise<DeckRow | undefined>;
  /** Marks the deck and everything under it. Nothing is removed. */
  softDelete: (id: string) => Promise<number>;
}

/** A deck that has to exist for the operation to make sense. */
export class DeckNotFound extends Error {
  override readonly name = 'DeckNotFound';

  constructor(id: string) {
    super(`no deck ${id}`);
  }
}

/** A move that would put a deck inside itself. */
export class DeckCycle extends Error {
  override readonly name = 'DeckCycle';

  constructor() {
    super('a deck cannot be moved into itself or into one of its own children');
  }
}

async function loadDeck(tx: Tx, userId: string, id: string): Promise<DeckRow> {
  const [row] = await tx
    .select()
    .from(decks)
    .where(and(eq(decks.userId, userId), eq(decks.id, id), isNull(decks.deletedAt)))
    .limit(1);

  if (!row) {
    throw new DeckNotFound(id);
  }

  return row;
}

/**
 * Where a new deck sits among its siblings.
 *
 * @param tx the transaction
 * @param userId the owner
 * @param parentId the parent, or null at the root
 * @returns one past the last sibling
 */
async function nextPosition(tx: Tx, userId: string, parentId: string | null): Promise<number> {
  const [row] = await tx
    .select({ next: sql<number>`coalesce(max(${decks.position}), -1) + 1` })
    .from(decks)
    .where(
      and(
        eq(decks.userId, userId),
        parentId === null ? isNull(decks.parentId) : eq(decks.parentId, parentId),
        isNull(decks.deletedAt),
      ),
    );

  return row?.next ?? 0;
}

export function deckRepository(userId: string, run: Runner): DeckRepository {
  return {
    async create(input) {
      return run(async (tx) => {
        const parentId = input.parentId ?? null;
        const parent = parentId === null ? undefined : await loadDeck(tx, userId, parentId);
        const path = parent ? [...parent.path, parent.id] : [];
        const settings = input.settings ? deckSettingsSchema.parse(input.settings) : null;
        const rev = await nextRev(tx, userId);

        const [row] = await tx
          .insert(decks)
          .values({
            id: input.id ?? uuidV7(),
            userId,
            parentId,
            name: input.name.trim(),
            position: await nextPosition(tx, userId, parentId),
            path,
            settings,
            rev,
          })
          .returning();

        if (!row) {
          throw new Error('the deck was not written');
        }

        return row;
      });
    },

    async byId(id) {
      return run(async (tx) => {
        const [row] = await tx
          .select()
          .from(decks)
          .where(and(eq(decks.userId, userId), eq(decks.id, id), isNull(decks.deletedAt)))
          .limit(1);

        return row;
      });
    },

    async list() {
      return run(async (tx) =>
        tx
          .select()
          .from(decks)
          .where(and(eq(decks.userId, userId), isNull(decks.deletedAt)))
          .orderBy(asc(decks.position), asc(decks.name)),
      );
    },

    async subtree(id) {
      return run(async (tx) =>
        tx
          .select()
          .from(decks)
          .where(
            and(
              eq(decks.userId, userId),
              isNull(decks.deletedAt),
              // The deck itself, plus every row that names it as an ancestor.
              sql`(${decks.id} = ${id} or ${decks.path} @> array[${id}]::uuid[])`,
            ),
          )
          .orderBy(asc(decks.position), asc(decks.name)),
      );
    },

    async chain(id) {
      return run(async (tx) => {
        const deck = await loadDeck(tx, userId, id);

        if (deck.path.length === 0) {
          return [deck];
        }

        const ancestors = await tx
          .select()
          .from(decks)
          .where(
            and(
              eq(decks.userId, userId),
              sql`${decks.id} = any(array[${sql.join(
                deck.path.map((ancestor) => sql`${ancestor}`),
                sql`, `,
              )}]::uuid[])`,
            ),
          );

        // Ordered by the path itself rather than by whatever came back, since
        // the chain has to read root first for settings to resolve correctly.
        const byId = new Map(ancestors.map((row) => [row.id, row]));
        const ordered = deck.path.flatMap((ancestor) => {
          const row = byId.get(ancestor);

          return row ? [row] : [];
        });

        return [...ordered, deck];
      });
    },

    async rename(id, name) {
      return run(async (tx) => {
        const rev = await nextRev(tx, userId);

        const [row] = await tx
          .update(decks)
          .set({ name: name.trim(), updatedAt: new Date(), rev })
          .where(and(eq(decks.userId, userId), eq(decks.id, id), isNull(decks.deletedAt)))
          .returning();

        return row;
      });
    },

    async updateSettings(id, settings) {
      return run(async (tx) => {
        const parsed = settings === null ? null : deckSettingsSchema.parse(settings);
        const rev = await nextRev(tx, userId);

        const [row] = await tx
          .update(decks)
          .set({ settings: parsed, updatedAt: new Date(), rev })
          .where(and(eq(decks.userId, userId), eq(decks.id, id), isNull(decks.deletedAt)))
          .returning();

        return row;
      });
    },

    async move(id, parentId) {
      return run(async (tx) => {
        const deck = await loadDeck(tx, userId, id);
        const parent = parentId === null ? undefined : await loadDeck(tx, userId, parentId);

        if (parent && (parent.id === deck.id || parent.path.includes(deck.id))) {
          throw new DeckCycle();
        }

        const newPath = parent ? [...parent.path, parent.id] : [];
        const oldDepth = deck.path.length;
        const rev = await nextRev(tx, userId);
        const now = new Date();

        // Every descendant's path starts with this deck's old path, then this
        // deck's id, then whatever is below. Replacing the first `oldDepth`
        // entries with the new path moves the whole subtree in one statement
        // and leaves the shape underneath untouched.
        await tx
          .update(decks)
          .set({
            path: sql`array[${sql.join(
              newPath.map((ancestor) => sql`${ancestor}`),
              sql`, `,
            )}]::uuid[] || ${decks.path}[${oldDepth + 1}:]`,
            updatedAt: now,
            rev,
          })
          .where(
            and(
              eq(decks.userId, userId),
              sql`${decks.path} @> array[${id}]::uuid[]`,
              isNull(decks.deletedAt),
            ),
          );

        const [row] = await tx
          .update(decks)
          .set({
            parentId,
            path: newPath,
            position: await nextPosition(tx, userId, parentId),
            updatedAt: now,
            rev,
          })
          .where(and(eq(decks.userId, userId), eq(decks.id, id)))
          .returning();

        return row;
      });
    },

    async softDelete(id) {
      return run(async (tx) => {
        const rev = await nextRev(tx, userId);

        const marked = await tx
          .update(decks)
          .set({ deletedAt: new Date(), updatedAt: new Date(), rev })
          .where(
            and(
              eq(decks.userId, userId),
              isNull(decks.deletedAt),
              sql`(${decks.id} = ${id} or ${decks.path} @> array[${id}]::uuid[])`,
            ),
          )
          .returning({ id: decks.id });

        return marked.length;
      });
    },
  };
}

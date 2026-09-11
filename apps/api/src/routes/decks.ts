import { Hono } from 'hono';

import {
  createDeckSchema,
  idParamSchema,
  moveDeckSchema,
  purgeConfirmationSchema,
  reorderDecksSchema,
  updateDeckSchema,
} from '@neuron/shared';

import { repositoriesOf } from '../context.js';
import { ApiError } from '../errors.js';
import { buildDeckTree, serialiseDeck } from '../serialise.js';
import { readBody, readParams } from '../validation.js';

import type { RequestBindings } from '../context.js';

/**
 * Folders and leaf study decks share one collection hierarchy.
 *
 * The tree endpoint is the one that matters. It is what the library screen
 * draws, it runs on every app open, and it carries the counts, so getting it
 * wrong is felt immediately rather than eventually.
 */
export function deckRoutes(): Hono<RequestBindings> {
  const routes = new Hono<RequestBindings>();

  /**
   * The whole tree with the counts rolled up.
   *
   * Two queries: the decks, and what each one holds. Not one query per deck,
   * which is the shape this naturally takes and which would put a hundred round
   * trips on the first screen of the app.
   */
  routes.get('/', async (context) => {
    const repositories = repositoriesOf(context);
    const [decks, counts] = await Promise.all([
      repositories.decks.list(),
      repositories.cards.countsByDeck(new Date()),
    ]);

    return context.json({ decks: buildDeckTree(decks, counts) });
  });

  routes.post('/', async (context) => {
    const body = await readBody(context, createDeckSchema);
    const deck = await repositoriesOf(context).decks.create({
      kind: body.kind,
      ...(body.id === undefined ? {} : { id: body.id }),
      name: body.name,
      parentId: body.parentId ?? null,
      settings: body.settings ?? null,
    });

    return context.json({ deck: serialiseDeck(deck) }, 201);
  });

  routes.get('/deleted', async (context) => {
    const repositories = repositoriesOf(context);
    const [deleted, live] = await Promise.all([
      repositories.decks.listDeleted(),
      repositories.decks.list(),
    ]);
    const byId = new Map([...live, ...deleted].map((deck) => [deck.id, deck]));
    const contextIds = new Set<string>();

    // Parent links are authoritative. A legacy sync client may have left a
    // stale materialized path, but Deleted still has to show the live ancestors
    // that explain where a tombstone belongs.
    for (const row of deleted) {
      for (const ancestor of ancestorChain(row, byId)) {
        if (ancestor.deletedAt === null) contextIds.add(ancestor.id);
      }
    }

    return context.json({
      decks: [...live.filter((deck) => contextIds.has(deck.id)), ...deleted].map((deck) => {
        const parent = deck.parentId === null ? undefined : byId.get(deck.parentId);
        const ancestors = ancestorChain(deck, byId);

        return {
          ...serialiseDeck(deck),
          context: deck.deletedAt === null,
          pathNames: ancestors.map((ancestor) => ancestor.name),
          parentDeleted: parent?.deletedAt !== null && parent !== undefined,
        };
      }),
    });
  });

  routes.get('/:id', async (context) => {
    const { id } = readParams(context, idParamSchema);
    const deck = await repositoriesOf(context).decks.byId(id);

    if (!deck) {
      throw new ApiError('not_found');
    }

    return context.json({ deck: serialiseDeck(deck) });
  });

  routes.patch('/:id', async (context) => {
    const { id } = readParams(context, idParamSchema);
    const body = await readBody(context, updateDeckSchema);
    const repositories = repositoriesOf(context);

    // Both in one transaction, so a rename that succeeds and a settings change
    // that fails cannot leave half the request applied.
    const deck = await repositories.transaction(async (inner) => {
      let row =
        body.name === undefined
          ? await inner.decks.byId(id)
          : await inner.decks.rename(id, body.name);

      if (body.settings !== undefined) {
        row = await inner.decks.updateSettings(id, body.settings ?? null);
      }

      return row;
    });

    if (!deck) {
      throw new ApiError('not_found');
    }

    return context.json({ deck: serialiseDeck(deck) });
  });

  routes.post('/:id/move', async (context) => {
    const { id } = readParams(context, idParamSchema);
    const body = await readBody(context, moveDeckSchema);
    const deck = await repositoriesOf(context).decks.move(id, body.parentId);

    if (!deck) {
      throw new ApiError('not_found');
    }

    return context.json({ deck: serialiseDeck(deck) });
  });

  routes.post('/reorder', async (context) => {
    const body = await readBody(context, reorderDecksSchema);
    const decks = await repositoriesOf(context).decks.reorder(body.parentId, body.order);

    return context.json({ decks: decks.map(serialiseDeck) });
  });

  routes.delete('/:id', async (context) => {
    const { id } = readParams(context, idParamSchema);
    const marked = await repositoriesOf(context).decks.softDelete(id);

    if (marked === 0) {
      throw new ApiError('not_found');
    }

    // Recovery preserves the original rows and their deletion operation.
    return context.json({ deleted: marked });
  });

  routes.post('/:id/restore', async (context) => {
    const { id } = readParams(context, idParamSchema);

    return context.json({ restored: await repositoriesOf(context).decks.restore(id) });
  });

  routes.get('/:id/purge-impact', async (context) => {
    const { id } = readParams(context, idParamSchema);
    return context.json(await repositoriesOf(context).purge.impact('decks', id));
  });
  routes.post('/:id/purge', async (context) => {
    const { id } = readParams(context, idParamSchema);
    await readBody(context, purgeConfirmationSchema);
    return context.json(await repositoriesOf(context).purge.remove('decks', id));
  });

  return routes;
}

/** Resolves a row's original parent chain without trusting its cached path. */
function ancestorChain(
  row: { readonly parentId: string | null },
  byId: ReadonlyMap<
    string,
    {
      readonly id: string;
      readonly parentId: string | null;
      readonly name: string;
      readonly deletedAt: Date | null;
    }
  >,
) {
  const chain: {
    readonly id: string;
    readonly parentId: string | null;
    readonly name: string;
    readonly deletedAt: Date | null;
  }[] = [];
  const seen = new Set<string>();
  let parentId = row.parentId;

  while (parentId !== null && !seen.has(parentId) && seen.size < 8) {
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    chain.unshift(parent);
    parentId = parent.parentId;
  }

  return chain;
}

import { Hono } from 'hono';

import {
  createDeckSchema,
  idParamSchema,
  moveDeckSchema,
  reorderDecksSchema,
  updateDeckSchema,
} from '@neuron/shared';

import { repositoriesOf } from '../context.js';
import { ApiError } from '../errors.js';
import { buildDeckTree, serialiseDeck } from '../serialise.js';
import { readBody, readParams } from '../validation.js';

import type { RequestBindings } from '../context.js';

/**
 * Decks, which are also folders.
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

    return context.json({
      decks: deleted.map((deck) => {
        const parent = deck.parentId === null ? undefined : byId.get(deck.parentId);

        return {
          ...serialiseDeck(deck),
          pathNames: deck.path.flatMap((id) => {
            const ancestor = byId.get(id);
            return ancestor ? [ancestor.name] : [];
          }),
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

    // Nothing is removed. The rows carry a deletion mark and are swept thirty
    // days later, so this is undoable until then.
    return context.json({ deleted: marked });
  });

  routes.post('/:id/restore', async (context) => {
    const { id } = readParams(context, idParamSchema);

    return context.json({ restored: await repositoriesOf(context).decks.restore(id) });
  });

  return routes;
}

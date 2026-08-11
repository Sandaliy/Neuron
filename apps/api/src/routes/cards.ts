import { Hono } from 'hono';

import { dueCardsSchema, idParamSchema, templatesFor, unlockDirectionSchema } from '@neuron/shared';
import type { NoteFields, NoteTypeName } from '@neuron/shared';

import { repositoriesOf } from '../context.js';
import { ApiError } from '../errors.js';
import { serialiseCard } from '../serialise.js';
import { readBody, readParams, readQuery } from '../validation.js';

import type { RequestBindings } from '../context.js';

/**
 * Cards: the four things a person can do to one after it exists.
 *
 * There is no create endpoint. A card follows from a note and a direction, and
 * a client that could make one on its own could make one whose schedule it had
 * chosen, which is the same hole the review endpoint exists to close.
 */
export function cardRoutes(): Hono<RequestBindings> {
  const routes = new Hono<RequestBindings>();

  /** What is waiting, for the session builder to work from. */
  routes.get('/due', async (context) => {
    const query = readQuery(context, dueCardsSchema);
    const cards = await repositoriesOf(context).cards.due({
      now: new Date(),
      ...(query.deckId === undefined ? {} : { deckId: query.deckId }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    });

    return context.json({ cards: cards.map(serialiseCard) });
  });

  routes.get('/:id', async (context) => {
    const { id } = readParams(context, idParamSchema);
    const card = await repositoriesOf(context).cards.byId(id);

    if (!card) {
      throw new ApiError('not_found');
    }

    return context.json({ card: serialiseCard(card) });
  });

  routes.post('/:id/suspend', async (context) => {
    const { id } = readParams(context, idParamSchema);
    const card = await repositoriesOf(context).cards.suspend(id);

    if (!card) {
      // Either it is not there or it was already suspended. From the caller's
      // side those are the same request twice, and the second one succeeding
      // quietly would be the wrong answer for the first.
      throw new ApiError('not_found');
    }

    return context.json({ card: serialiseCard(card) });
  });

  routes.post('/:id/unsuspend', async (context) => {
    const { id } = readParams(context, idParamSchema);
    const card = await repositoriesOf(context).cards.unsuspend(id);

    if (!card) {
      throw new ApiError('not_found');
    }

    return context.json({ card: serialiseCard(card) });
  });

  /**
   * Puts a card back to the beginning.
   *
   * The review log keeps every row, because it is append only and that is the
   * whole point of it. What moves is the line the replay starts from, which is
   * recorded on the card. Rebuilding the card from the log afterwards produces
   * the reset card rather than quietly undoing the reset.
   */
  routes.post('/:id/reset', async (context) => {
    const { id } = readParams(context, idParamSchema);
    const card = await repositoriesOf(context).cards.reset(id, new Date());

    if (!card) {
      throw new ApiError('not_found');
    }

    return context.json({ card: serialiseCard(card) });
  });

  return routes;
}

/**
 * Opening a direction by hand, before the ladder would have.
 *
 * Lives under the note rather than under a card because that is what it is: a
 * new way of asking about a fact, not a change to an existing card.
 */
export function unlockRoute(): Hono<RequestBindings> {
  const routes = new Hono<RequestBindings>();

  routes.post('/:id/cards', async (context) => {
    const { id } = readParams(context, idParamSchema);
    const body = await readBody(context, unlockDirectionSchema);
    const repositories = repositoriesOf(context);

    const note = await repositories.notes.byId(id);

    if (!note) {
      throw new ApiError('not_found');
    }

    const typeNames = await repositories.noteTypes.namesById();
    const typeName = (typeNames.get(note.noteTypeId) ?? 'basic') as NoteTypeName;
    const possible = templatesFor(typeName, note.fields as NoteFields);

    if (!possible.some((template) => template.direction === body.direction)) {
      // The note cannot produce this direction at all: a listening card needs
      // audio, and a cloze note has only one way of being asked.
      throw new ApiError('direction_unavailable');
    }

    const existing = await repositories.cards.forNote(id);

    if (existing.some((card) => card.direction === body.direction)) {
      throw new ApiError('direction_unavailable');
    }

    const now = new Date();
    const card = await repositories.cards.create({
      noteId: id,
      direction: body.direction,
      due: now,
      unlockedAt: now,
    });

    return context.json({ card: serialiseCard(card) }, 201);
  });

  return routes;
}

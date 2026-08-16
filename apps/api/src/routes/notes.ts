import { Hono } from 'hono';

import {
  bulkStatusSchema,
  createNoteSchema,
  idParamSchema,
  listNotesSchema,
  parseNoteFields,
  updateNoteSchema,
} from '@neuron/shared';
import type { NoteTypeName } from '@neuron/shared';

import { repositoriesOf } from '../context.js';
import { ApiError } from '../errors.js';
import { applyCardChange, createOpeningCards, planCardChange } from '../note-cards.js';
import { serialiseCard, serialiseNote } from '../serialise.js';
import { readBody, readParams, readQuery } from '../validation.js';

import type { RequestBindings } from '../context.js';

/**
 * Notes: the facts, and the cards that follow from them.
 *
 * Creating a note creates its first cards in the same transaction. A note with
 * no cards is invisible to the person who wrote it, and a card whose note never
 * landed is a question with no answer, so the two cannot be allowed to arrive
 * separately.
 */
export function noteRoutes(): Hono<RequestBindings> {
  const routes = new Hono<RequestBindings>();

  routes.get('/', async (context) => {
    const query = readQuery(context, listNotesSchema);
    const repositories = repositoriesOf(context);

    const [page, typeNames] = await Promise.all([
      repositories.notes.list({
        deckId: query.deckId,
        includeSubtree: query.subtree,
        status: query.status,
        tag: query.tag,
        search: query.search,
        limit: query.limit,
        cursor: query.cursor,
      }),
      repositories.noteTypes.namesById(),
    ]);

    return context.json({
      items: page.items.map((row) => serialiseNote(row, typeNames)),
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    });
  });

  routes.post('/', async (context) => {
    const body = await readBody(context, createNoteSchema);
    const repositories = repositoriesOf(context);

    // Checked here as well as in the repository, because the error a person
    // sees for a badly filled in note should say which field, and by the time
    // the write fails that has become a database error with a column name in
    // it.
    const fields = parseFields(body.noteType, body.fields);

    const written = await repositories.transaction(async (inner) => {
      const note = await inner.notes.create({
        ...(body.id === undefined ? {} : { id: body.id }),
        deckId: body.deckId,
        noteType: body.noteType,
        fields,
        ...(body.tags === undefined ? {} : { tags: body.tags }),
        source: body.source ?? null,
        rank: body.rank ?? null,
        ...(body.status === undefined ? {} : { status: body.status }),
        importBatchId: body.importBatchId ?? null,
      });

      const cards = await createOpeningCards(inner, note.id, body.deckId, body.noteType, fields);

      return { note, cards };
    });

    const typeNames = await repositories.noteTypes.namesById();

    return context.json(
      {
        note: serialiseNote(written.note, typeNames),
        cards: written.cards.map(serialiseCard),
      },
      201,
    );
  });

  routes.post('/status', async (context) => {
    const body = await readBody(context, bulkStatusSchema);
    const changed = await repositoriesOf(context).notes.setStatusMany(body.ids, body.status);

    return context.json({ changed });
  });

  routes.get('/:id', async (context) => {
    const { id } = readParams(context, idParamSchema);
    const repositories = repositoriesOf(context);
    const note = await repositories.notes.byId(id);

    if (!note) {
      throw new ApiError('not_found');
    }

    const [cards, typeNames] = await Promise.all([
      repositories.cards.forNote(id),
      repositories.noteTypes.namesById(),
    ]);

    return context.json({
      note: serialiseNote(note, typeNames),
      cards: cards.map(serialiseCard),
    });
  });

  /**
   * Editing a note, which must not cost it its schedule.
   *
   * Changing the translation of a word answered forty times keeps the forty.
   * The only edits that can remove a card are the ones that make the card
   * impossible: changing the type, or taking a gap out of a cloze sentence. In
   * that case the api refuses unless the caller says it knows, so the
   * confirmation is a rule rather than the habit of one screen.
   */
  routes.patch('/:id', async (context) => {
    const { id } = readParams(context, idParamSchema);
    const body = await readBody(context, updateNoteSchema);
    const repositories = repositoriesOf(context);

    const written = await repositories.transaction(async (inner) => {
      const existing = await inner.notes.byId(id);

      if (!existing) {
        return undefined;
      }

      const typeNames = await inner.noteTypes.namesById();
      const currentType = (typeNames.get(existing.noteTypeId) ?? 'basic') as NoteTypeName;
      const noteType = body.noteType ?? currentType;
      // The old fields are re-checked against the new type on purpose. A type
      // change with no fields to go with it leaves a row nothing can read back,
      // and this is where that is caught, by name, before anything is written.
      const fields = parseFields(noteType, body.fields ?? existing.fields);

      const change = await planCardChange(inner, id, existing.deckId, noteType, fields);

      if (change.reviewsLost > 0 && body.discardCards !== true) {
        throw new ApiError('cards_would_be_lost', {
          details: { cards: change.remove.length, reviews: change.reviewsLost },
        });
      }

      let row =
        noteType === currentType
          ? body.fields === undefined
            ? existing
            : await inner.notes.updateFields(id, fields)
          : await inner.notes.changeType(id, noteType, fields);

      await applyCardChange(inner, id, change);

      if (body.tags !== undefined) {
        row = await inner.notes.setTags(id, body.tags);
      }

      if (body.status !== undefined) {
        row = await inner.notes.setStatus(id, body.status);
      }

      // Last, because moving a note moves its cards with it and the cards this
      // edit created have to exist by then.
      if (body.deckId !== undefined) {
        row = await inner.notes.moveToDeck(id, body.deckId);
      }

      return row;
    });

    if (!written) {
      throw new ApiError('not_found');
    }

    const [cards, typeNames] = await Promise.all([
      repositories.cards.forNote(id),
      repositories.noteTypes.namesById(),
    ]);

    return context.json({
      note: serialiseNote(written, typeNames),
      cards: cards.map(serialiseCard),
    });
  });

  routes.delete('/:id', async (context) => {
    const { id } = readParams(context, idParamSchema);

    if (!(await repositoriesOf(context).notes.softDelete(id))) {
      throw new ApiError('not_found');
    }

    return context.json({ deleted: true });
  });

  routes.post('/:id/restore', async (context) => {
    const { id } = readParams(context, idParamSchema);

    return context.json({ restored: await repositoriesOf(context).notes.restore(id) });
  });

  return routes;
}

/**
 * Checks a note's fields against the type it claims to be.
 *
 * @param noteType the type
 * @param fields the fields as they arrived
 * @returns the parsed fields, with blank values dropped
 * @throws ApiError naming the fields that are wrong
 */
export function parseFields(noteType: Parameters<typeof parseNoteFields>[0], fields: unknown) {
  try {
    return parseNoteFields(noteType, fields);
  } catch (error) {
    throw new ApiError('invalid_note_fields', {
      details: {
        fields: fieldsFromZod(error),
      },
      cause: error,
    });
  }
}

/** Reads the failing paths out of a Zod error without quoting any values. */
function fieldsFromZod(error: unknown): { path: string; code: string }[] {
  if (typeof error !== 'object' || error === null || !('issues' in error)) {
    return [];
  }

  const issues = (error as { issues: unknown }).issues;

  if (!Array.isArray(issues)) {
    return [];
  }

  return issues.slice(0, 20).map((issue: { path?: unknown[]; code?: unknown }) => ({
    path: (issue.path ?? []).map(String).join('.') || '(fields)',
    code: String(issue.code ?? 'invalid'),
  }));
}

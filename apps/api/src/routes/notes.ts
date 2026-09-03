import { isDeepStrictEqual } from 'node:util';

import { Hono } from 'hono';

import {
  bulkDeleteSchema,
  bulkMoveSchema,
  bulkStatusSchema,
  bulkTagsSchema,
  createNoteSchema,
  duplicateCheckSchema,
  idParamSchema,
  listNotesSchema,
  normaliseTerm,
  noteTermKey,
  mergeNoteFields,
  termOf,
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
        source: query.source,
        cardState: query.cardState,
        search: query.search,
        sort: query.sort,
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

  /**
   * The bulk actions, which are what makes a large import usable.
   *
   * Marking two hundred words as known after a placement test is one action to
   * the person doing it, and two hundred requests is how that action becomes a
   * spinner. Each of these is capped, because an unbounded batch is a way to
   * hold a transaction open for as long as somebody likes.
   */
  routes.post('/status', async (context) => {
    const body = await readBody(context, bulkStatusSchema);
    const changed = await repositoriesOf(context).notes.setStatusMany(body.ids, body.status);

    return context.json({ changed });
  });

  /**
   * Which of these words the library already holds.
   *
   * One request for a whole chunk of an import, answered from an indexed
   * generated column, so five thousand rows are five queries rather than five
   * thousand. Across every deck, because a word already learned somewhere else
   * is exactly the duplicate worth knowing about.
   */
  routes.post('/duplicates', async (context) => {
    const body = await readBody(context, duplicateCheckSchema);
    const repositories = repositoriesOf(context);
    const keys = body.terms.map((term) => normaliseTerm(term));
    const rows = await repositories.notes.duplicatesOf(keys);

    return context.json({
      matches: rows.map((row) => ({
        term: row.termKey,
        noteId: row.id,
        noteType: row.noteType,
        deckId: row.deckId,
        written: termOf(row.fields),
      })),
    });
  });

  routes.post('/move', async (context) => {
    const body = await readBody(context, bulkMoveSchema);
    const changed = await repositoriesOf(context).notes.moveMany(body.ids, body.deckId);

    return context.json({ changed });
  });

  routes.post('/tags', async (context) => {
    const body = await readBody(context, bulkTagsSchema);
    const changed = await repositoriesOf(context).notes.tagMany(body.ids, {
      ...(body.add === undefined ? {} : { add: body.add }),
      ...(body.remove === undefined ? {} : { remove: body.remove }),
    });

    return context.json({ changed });
  });

  routes.post('/delete', async (context) => {
    const body = await readBody(context, bulkDeleteSchema);
    const deleted = await repositoriesOf(context).notes.softDeleteMany(body.ids);

    return context.json({ deleted });
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
      const existing = await inner.notes.byId(id, { forUpdate: true });

      if (!existing) {
        return undefined;
      }

      const typeNames = await inner.noteTypes.namesById();
      const currentType = (typeNames.get(existing.noteTypeId) ?? 'basic') as NoteTypeName;
      const noteType = body.noteType ?? currentType;
      // The old fields are re-checked against the new type on purpose. A type
      // change with no fields to go with it leaves a row nothing can read back,
      // and this is where that is caught, by name, before anything is written.
      const incoming = parseFields(noteType, body.fields ?? existing.fields);

      if (body.merge) {
        if (noteType !== currentType || noteTermKey(incoming) !== noteTermKey(existing.fields)) {
          throw new ApiError('invalid_request');
        }

        const eligible = (await inner.notes.duplicatesOf([noteTermKey(incoming)])).filter(
          (match) => match.noteType === currentType,
        );

        if (eligible.length !== 1 || eligible[0]?.id !== id) {
          throw new ApiError('invalid_request');
        }
      }

      const fields = body.merge ? mergeNoteFields(noteType, existing.fields, incoming) : incoming;

      const change = await planCardChange(inner, id, existing.deckId, noteType, fields);

      if (body.merge && change.remove.length > 0) {
        throw new ApiError('cards_would_be_lost');
      }

      if (change.reviewsLost > 0 && body.discardCards !== true) {
        throw new ApiError('cards_would_be_lost', {
          details: { cards: change.remove.length, reviews: change.reviewsLost },
        });
      }

      let row =
        noteType === currentType
          ? body.fields === undefined || (body.merge && isDeepStrictEqual(fields, existing.fields))
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

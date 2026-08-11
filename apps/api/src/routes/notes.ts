import { Hono } from 'hono';

import {
  bulkStatusSchema,
  createNoteSchema,
  idParamSchema,
  listNotesSchema,
  parseNoteFields,
  updateNoteSchema,
} from '@neuron/shared';
import type { NoteFields } from '@neuron/shared';

import { repositoriesOf } from '../context.js';
import { ApiError } from '../errors.js';
import { openingDirections, settingsForDeck } from '../note-cards.js';
import { serialiseCard, serialiseNote } from '../serialise.js';
import { readBody, readParams, readQuery } from '../validation.js';

import type { RequestBindings } from '../context.js';
import type { Repositories } from '../db/repositories/index.js';

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

  routes.patch('/:id', async (context) => {
    const { id } = readParams(context, idParamSchema);
    const body = await readBody(context, updateNoteSchema);
    const repositories = repositoriesOf(context);

    const note = await repositories.transaction(async (inner) => {
      let row = await inner.notes.byId(id);

      if (!row) {
        return undefined;
      }

      if (body.fields !== undefined) {
        row = await inner.notes.updateFields(id, body.fields as NoteFields);
      }

      if (body.status !== undefined) {
        row = await inner.notes.setStatus(id, body.status);
      }

      // Last, because moving a note moves its cards with it and the cards have
      // to exist by then.
      if (body.deckId !== undefined) {
        row = await inner.notes.moveToDeck(id, body.deckId);
      }

      return row;
    });

    if (!note) {
      throw new ApiError('not_found');
    }

    const typeNames = await repositories.noteTypes.namesById();

    return context.json({ note: serialiseNote(note, typeNames) });
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

/**
 * Creates the cards a new note starts with.
 *
 * @param repositories the repositories, already inside the transaction
 * @param noteId the note just written
 * @param deckId where it landed, for reading the ladder
 * @param noteType which type it is
 * @param fields its fields, which decide which directions are possible
 * @returns the cards written
 */
export async function createOpeningCards(
  repositories: Repositories,
  noteId: string,
  deckId: string,
  noteType: Parameters<typeof parseNoteFields>[0],
  fields: NoteFields,
) {
  const settings = await settingsForDeck(repositories, deckId);
  const directions = openingDirections(noteType, fields, settings.ladder);
  const now = new Date();

  return repositories.cards.createMany(
    directions.map((direction) => ({ noteId, direction, due: now, unlockedAt: now })),
  );
}

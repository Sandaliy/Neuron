import { Hono } from 'hono';

import {
  createImportSchema,
  createPresetSchema,
  idParamSchema,
  importChunkSchema,
  openingCards,
  updatePresetSchema,
} from '@neuron/shared';
import type { NoteFields, NoteStatus, NoteTypeName } from '@neuron/shared';

import { repositoriesOf } from '../context.js';
import { ApiError } from '../errors.js';
import { settingsForDeck } from '../note-cards.js';
import { serialiseImportBatch, serialisePreset } from '../serialise.js';
import { readBody, readParams } from '../validation.js';

import { parseFields } from './notes.js';

import type { RequestBindings } from '../context.js';
import type { Repositories } from '../db/repositories/index.js';

/** Saved ways of studying. */
export function presetRoutes(): Hono<RequestBindings> {
  const routes = new Hono<RequestBindings>();

  routes.get('/', async (context) => {
    const presets = await repositoriesOf(context).presets.list();

    return context.json({ presets: presets.map(serialisePreset) });
  });

  routes.post('/', async (context) => {
    const body = await readBody(context, createPresetSchema);
    const preset = await repositoriesOf(context).presets.create({
      ...(body.id === undefined ? {} : { id: body.id }),
      name: body.name,
      deckId: body.deckId ?? null,
      config: body.config,
      ...(body.isDefault === undefined ? {} : { isDefault: body.isDefault }),
    });

    return context.json({ preset: serialisePreset(preset) }, 201);
  });

  routes.patch('/:id', async (context) => {
    const { id } = readParams(context, idParamSchema);
    const body = await readBody(context, updatePresetSchema);
    const preset = await repositoriesOf(context).presets.update(id, body);

    if (!preset) {
      throw new ApiError('not_found');
    }

    return context.json({ preset: serialisePreset(preset) });
  });

  routes.delete('/:id', async (context) => {
    const { id } = readParams(context, idParamSchema);

    if (!(await repositoriesOf(context).presets.softDelete(id))) {
      throw new ApiError('not_found');
    }

    return context.json({ deleted: true });
  });

  return routes;
}

/**
 * Imports, which exist so that a bad one can be taken back in one action.
 *
 * Five hundred badly generated cards is a normal thing to do once. Picking them
 * out of a deck by hand afterwards is not, so every imported note points back
 * at the batch it arrived in and the undo follows that pointer.
 *
 * A large list arrives in chunks. The batch is created first and the notes are
 * sent against it a few hundred at a time, because five thousand rows do not
 * fit in one serverless invocation and a phone on a train does not hold one
 * connection open long enough to try. Every note in a chunk carries an id the
 * client generated, which is what makes sending the same chunk twice write
 * nothing the second time.
 */
export function importRoutes(): Hono<RequestBindings> {
  const routes = new Hono<RequestBindings>();

  routes.get('/', async (context) => {
    const batches = await repositoriesOf(context).importBatches.list();

    return context.json({ imports: batches.map(serialiseImportBatch) });
  });

  routes.post('/', async (context) => {
    const body = await readBody(context, createImportSchema);
    const repositories = repositoriesOf(context);

    // Every field checked before anything is written, so a bad row two thirds
    // of the way down does not leave two thirds of an import behind.
    const parsed = (body.notes ?? []).map((note) => ({
      ...note,
      fields: parseFields(note.noteType, note.fields),
    }));

    const written = await repositories.transaction(async (inner) => {
      const batch = await inner.importBatches.create({
        ...(body.id === undefined ? {} : { id: body.id }),
        deckId: body.deckId,
        source: body.source,
        ...(body.format === undefined ? {} : { format: body.format }),
      });

      return { batch, ...(await addImportedNotes(inner, batch, parsed)) };
    });

    return context.json(
      {
        import: serialiseImportBatch(written.batch),
        notes: written.notes,
        cards: written.cards,
      },
      201,
    );
  });

  /**
   * One chunk of a large import.
   *
   * A chunk that arrives twice writes nothing the second time and reports
   * nothing added, so a client whose connection dropped mid request can simply
   * send it again rather than work out whether it landed.
   */
  routes.post('/:id/notes', async (context) => {
    const { id } = readParams(context, idParamSchema);
    const body = await readBody(context, importChunkSchema);
    const repositories = repositoriesOf(context);

    const parsed = body.notes.map((note) => ({
      ...note,
      fields: parseFields(note.noteType, note.fields),
    }));

    const written = await repositories.transaction(async (inner) => {
      const batch = await inner.importBatches.byId(id);

      if (!batch) {
        throw new ApiError('not_found');
      }

      return addImportedNotes(inner, batch, parsed);
    });

    return context.json(written);
  });

  /** What is in an import, which is what the undo has to confirm with. */
  routes.get('/:id', async (context) => {
    const { id } = readParams(context, idParamSchema);
    const repositories = repositoriesOf(context);
    const batch = await repositories.importBatches.byId(id);

    if (!batch) {
      throw new ApiError('not_found');
    }

    const contents = await repositories.importBatches.contents(id);

    return context.json({ import: serialiseImportBatch(batch), ...contents });
  });

  routes.post('/:id/undo', async (context) => {
    const { id } = readParams(context, idParamSchema);
    const repositories = repositoriesOf(context);

    if (!(await repositories.importBatches.byId(id))) {
      throw new ApiError('not_found');
    }

    // The notes and the cards they generated are marked deleted and the batch
    // is marked undone. The review log is left alone: it records what happened,
    // and it did happen.
    return context.json({ undone: await repositories.importBatches.undo(id) });
  });

  return routes;
}

/** A note on its way into an import, with its fields already checked. */
interface ParsedImportNote {
  readonly id?: string | undefined;
  readonly noteType: NoteTypeName;
  readonly fields: NoteFields;
  readonly tags?: readonly string[] | undefined;
  readonly source?: string | null | undefined;
  readonly rank?: number | null | undefined;
  readonly status?: NoteStatus | undefined;
}

/**
 * Writes a chunk of imported notes and the cards they open with.
 *
 * Batched rather than one note at a time. Written the obvious way, a chunk of
 * five hundred is a couple of thousand round trips to a database in another
 * country, which is minutes and well past what a serverless function is given.
 * This is four statements: the notes, the deck's settings, the cards, and the
 * running count.
 *
 * The cards come from `openingCards` in packages/shared, which is the same
 * function the editor calls, so an imported word and a typed one arrive with
 * exactly the same cards.
 *
 * @param repositories the repositories, inside the transaction
 * @param batch the batch the notes belong to
 * @param notes the notes, already checked against their types
 * @returns how many notes and cards were written, and how many were already there
 */
async function addImportedNotes(
  repositories: Repositories,
  batch: { readonly id: string; readonly deckId: string; readonly source: string },
  notes: readonly ParsedImportNote[],
) {
  if (notes.length === 0) {
    return { notes: 0, cards: 0, skipped: 0 };
  }

  const written = await repositories.notes.createMany(
    notes.map((note) => ({
      ...(note.id === undefined ? {} : { id: note.id }),
      deckId: batch.deckId,
      noteType: note.noteType,
      fields: note.fields,
      ...(note.tags === undefined ? {} : { tags: note.tags }),
      source: note.source ?? batch.source,
      rank: note.rank ?? null,
      ...(note.status === undefined ? {} : { status: note.status }),
      importBatchId: batch.id,
    })),
    { skipExisting: true },
  );

  if (written.length === 0) {
    return { notes: 0, cards: 0, skipped: notes.length };
  }

  const settings = await settingsForDeck(repositories, batch.deckId);
  const byId = new Map(
    notes.filter((note) => note.id !== undefined).map((note) => [note.id, note]),
  );
  const now = new Date();

  const planned = written.flatMap((row, index) => {
    // A note with no client id can only be matched by position, and the insert
    // returns them in the order they were sent.
    const note = byId.get(row.id) ?? notes[index];

    if (!note) {
      return [];
    }

    return openingCards(note.noteType, note.fields, settings.ladder).map((card) => ({
      noteId: row.id,
      direction: card.direction,
      slot: card.slot,
      due: now,
      unlockedAt: now,
    }));
  });

  const cards = await repositories.cards.createMany(planned);

  await repositories.importBatches.addNoteCount(batch.id, written.length);

  return { notes: written.length, cards: cards.length, skipped: notes.length - written.length };
}

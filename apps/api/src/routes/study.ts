import { Hono } from 'hono';

import {
  createImportSchema,
  createPresetSchema,
  idParamSchema,
  updatePresetSchema,
} from '@neuron/shared';

import { repositoriesOf } from '../context.js';
import { ApiError } from '../errors.js';
import { createOpeningCards } from '../note-cards.js';
import { serialiseImportBatch, serialisePreset } from '../serialise.js';
import { readBody, readParams } from '../validation.js';

import { parseFields } from './notes.js';

import type { RequestBindings } from '../context.js';

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
    const parsed = body.notes.map((note) => ({
      ...note,
      fields: parseFields(note.noteType, note.fields),
    }));

    const written = await repositories.transaction(async (inner) => {
      const batch = await inner.importBatches.create({
        ...(body.id === undefined ? {} : { id: body.id }),
        deckId: body.deckId,
        source: body.source,
        ...(body.format === undefined ? {} : { format: body.format }),
        noteCount: parsed.length,
      });

      let cards = 0;

      for (const note of parsed) {
        const row = await inner.notes.create({
          ...(note.id === undefined ? {} : { id: note.id }),
          deckId: body.deckId,
          noteType: note.noteType,
          fields: note.fields,
          ...(note.tags === undefined ? {} : { tags: note.tags }),
          source: note.source ?? body.source,
          rank: note.rank ?? null,
          ...(note.status === undefined ? {} : { status: note.status }),
          importBatchId: batch.id,
        });

        const made = await createOpeningCards(
          inner,
          row.id,
          body.deckId,
          note.noteType,
          note.fields,
        );

        cards += made.length;
      }

      return { batch, notes: parsed.length, cards };
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

  routes.post('/:id/undo', async (context) => {
    const { id } = readParams(context, idParamSchema);
    const repositories = repositoriesOf(context);

    if (!(await repositories.importBatches.byId(id))) {
      throw new ApiError('not_found');
    }

    // The notes are marked deleted and the batch is marked undone. The review
    // log is left alone: it records what happened, and it did happen.
    return context.json({ undone: await repositories.importBatches.undo(id) });
  });

  return routes;
}

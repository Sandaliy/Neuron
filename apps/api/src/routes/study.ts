import { Hono } from 'hono';

import type { WorkloadCard } from '@neuron/core';
import {
  createImportSchema,
  createPresetSchema,
  dailyStudySessionRequestSchema,
  idParamSchema,
  importChunkSchema,
  resolveDeckSettings,
  planDailyStudy,
  studyDecks,
  updatePresetSchema,
} from '@neuron/shared';
import type { DeckSettings } from '@neuron/shared';

import { repositoriesOf } from '../context.js';
import { toSchedulingState } from '../db/repositories/index.js';
import { ApiError } from '../errors.js';
import {
  serialiseCard,
  serialiseImportBatch,
  serialisePreset,
  serialiseNote,
} from '../serialise.js';
import { readBody, readParams } from '../validation.js';

import { parseFields } from './notes.js';

import type { RequestBindings } from '../context.js';

/** Builds a Daily Study plan without persisting a session or changing settings. */
export function dailyStudyRoutes(): Hono<RequestBindings> {
  const routes = new Hono<RequestBindings>();

  routes.post('/session', async (context) => {
    const body = await readBody(context, dailyStudySessionRequestSchema);
    const started = performance.now();
    // Share one user-bound transaction instead of repeating BEGIN, identity and
    // COMMIT for every read. The restricted role and all repository filters stay.
    const result = await repositoriesOf(context).transaction(async (repositories) => {
      const [account, collections, allLogs, typeNames] = await Promise.all([
        repositories.account.read(),
        repositories.decks.list(),
        repositories.reviews.workload(),
        repositories.noteTypes.namesById(),
      ]);
      const deckChain: DeckSettings[] = [];

      if (body.deckId !== undefined) {
        if (!(await repositories.decks.byId(body.deckId))) {
          throw new ApiError('not_found');
        }

        deckChain.push(
          ...(await repositories.decks.chain(body.deckId)).map(
            (deck) => (deck.settings ?? {}) as DeckSettings,
          ),
        );
      }

      const settings = resolveDeckSettings([account.settings, ...deckChain]);
      const now = new Date();
      const liveDecks = studyDecks(collections);
      let scope = body.deckIds;
      if (body.deckId !== undefined) {
        const subtree = new Set(
          (await repositories.decks.subtree(body.deckId)).map((deck) => deck.id),
        );
        scope = liveDecks.filter((deck) => subtree.has(deck.id)).map((deck) => deck.id);
      }
      if (scope?.some((id) => !liveDecks.some((deck) => deck.id === id)))
        throw new ApiError('not_found');
      const scopeDeckIds = [
        ...new Set(
          scope ??
            liveDecks
              .filter((deck) => deck.settings?.dailyStudyIncluded !== false)
              .map((deck) => deck.id),
        ),
      ].sort();
      // Directions existing Notes already qualify for open before planning
      // reads, so the plan, its forecast and its revision include them.
      const opened = await repositories.cards.sweepProgression(scopeDeckIds, now);
      const planningRevision =
        opened.length > 0 ? (await repositories.account.read()).currentRev : account.currentRev;
      const [rows, unsure] = await Promise.all([
        repositories.cards.forSession({ deckIds: scopeDeckIds }),
        repositories.notes.unsureIn(scopeDeckIds),
      ]);
      const cards: WorkloadCard[] = rows.map((row) => ({
        id: row.id,
        deckId: row.deckId,
        noteId: row.noteId,
        direction: row.direction as WorkloadCard['direction'],
        scheduling: toSchedulingState(row),
      }));
      const readAt = performance.now();
      const session = planDailyStudy({
        account,
        collections,
        scopeDeckIds,
        settings,
        cards,
        unsureNoteIds: new Set(unsure),
        allLogs,
        body,
        now,
        explicitScope: scope !== undefined,
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      const plannedAt = performance.now();
      const notes = await repositories.notes.byIds(session.cards.map((card) => card.noteId));
      context.header(
        'Server-Timing',
        `study_read;dur=${(readAt - started).toFixed(1)}, study_plan;dur=${(plannedAt - readAt).toFixed(1)}, study_notes;dur=${(performance.now() - plannedAt).toFixed(1)}`,
        { append: true },
      );

      return {
        ...session,
        planningContext: { accountId: account.id, revision: planningRevision },
        notes: notes.map((note) => serialiseNote(note, typeNames)),
        cards: session.cards.flatMap((card) => {
          const row = byId.get(card.id);
          return row === undefined ? [] : [serialiseCard(row)];
        }),
      };
    });
    context.header('Server-Timing', `study_total;dur=${(performance.now() - started).toFixed(1)}`, {
      append: true,
    });
    return context.json(result);
  });

  return routes;
}

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

      const applied = parsed.length
        ? await inner.importBatches.append(batch.id, parsed)
        : { notes: 0, cards: 0, skipped: 0 };
      if (!applied) throw new ApiError('not_found');
      const committed = applied.notes ? await inner.importBatches.byId(batch.id) : batch;
      if (!committed) throw new ApiError('not_found');
      return { batch: committed, ...applied };
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

    const written = await repositories.importBatches.append(id, parsed);
    if (!written) throw new ApiError('not_found');

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

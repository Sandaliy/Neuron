import { z } from 'zod';

import {
  apiErrorSchema,
  bulkStatusSchema,
  cardSchema,
  createDeckSchema,
  createImportSchema,
  createNoteSchema,
  createPresetSchema,
  deletedDeckListSchema,
  deletedDeckSchema,
  deletedNoteListSchema,
  deletedNoteSchema,
  deckTreeSchema,
  deleteAccountSchema,
  dueCardsSchema,
  listNotesSchema,
  meSchema,
  moveDeckSchema,
  noteSchema,
  pullSyncResultSchema,
  pullSyncSchema,
  pushSyncResultSchema,
  pushSyncSchema,
  reorderDecksSchema,
  restoreNoteResultSchema,
  reviewBatchResultSchema,
  reviewResultSchema,
  studyPresetSchema,
  submitReviewBatchSchema,
  submitReviewSchema,
  unlockDirectionSchema,
  updateDeckSchema,
  updateNoteSchema,
  updatePreferencesSchema,
  updatePresetSchema,
} from '@neuron/shared';

/**
 * The api described, generated from the schemas it actually validates with.
 *
 * Written by hand, this document would be wrong within a month. Every request
 * shape below is the same object the route parses the request with, turned into
 * JSON Schema by Zod itself, so a field added to a request is a field that
 * appears here without anybody remembering to add it.
 *
 * `io: 'input'` matters. Several schemas parse an ISO string into a Date, and
 * the documentation has to describe what a caller sends, not what the handler
 * ends up holding.
 */

const registry: Record<string, z.ZodType> = {
  ApiError: apiErrorSchema,
  DeckTree: deckTreeSchema,
  DeletedDeck: deletedDeckSchema,
  DeletedDeckList: deletedDeckListSchema,
  CreateDeck: createDeckSchema,
  UpdateDeck: updateDeckSchema,
  MoveDeck: moveDeckSchema,
  ReorderDecks: reorderDecksSchema,
  Note: noteSchema,
  DeletedNote: deletedNoteSchema,
  DeletedNoteList: deletedNoteListSchema,
  ListNotes: listNotesSchema,
  CreateNote: createNoteSchema,
  UpdateNote: updateNoteSchema,
  BulkStatus: bulkStatusSchema,
  Card: cardSchema,
  DueCards: dueCardsSchema,
  UnlockDirection: unlockDirectionSchema,
  StudyPreset: studyPresetSchema,
  CreatePreset: createPresetSchema,
  UpdatePreset: updatePresetSchema,
  CreateImport: createImportSchema,
  SubmitReview: submitReviewSchema,
  SubmitReviewBatch: submitReviewBatchSchema,
  ReviewResult: reviewResultSchema,
  ReviewBatchResult: reviewBatchResultSchema,
  PullSync: pullSyncSchema,
  PullSyncResult: pullSyncResultSchema,
  PushSync: pushSyncSchema,
  PushSyncResult: pushSyncResultSchema,
  RestoreNoteResult: restoreNoteResultSchema,
  Me: meSchema,
  UpdatePreferences: updatePreferencesSchema,
  DeleteAccount: deleteAccountSchema,
};

/** A reference to a component, which is how every path below points at a shape. */
function ref(name: string) {
  return { $ref: `#/components/schemas/${name}` };
}

/** A JSON request body. */
function body(name: string) {
  return {
    required: true,
    content: { 'application/json': { schema: ref(name) } },
  };
}

/** A JSON response. */
function answer(description: string, name?: string) {
  return {
    description,
    ...(name === undefined ? {} : { content: { 'application/json': { schema: ref(name) } } }),
  };
}

/** The responses every endpoint can give, so they are not repeated thirty times. */
const commonErrors = {
  400: answer('The request did not match its schema', 'ApiError'),
  401: answer('No session, or one that has expired', 'ApiError'),
  404: answer('Not there, or not yours', 'ApiError'),
  409: answer('The current state prevents this operation', 'ApiError'),
  429: answer('Too many requests. retry-after says how long', 'ApiError'),
  500: answer('Something unexpected. The correlation id is in the server log', 'ApiError'),
};

/**
 * Builds the document.
 *
 * @param baseUrl where the api answers, so the document is usable as it stands
 * @returns the OpenAPI 3.1 document
 */
export function openApiDocument(baseUrl: string) {
  const schemas: Record<string, unknown> = {};

  for (const [name, schema] of Object.entries(registry)) {
    schemas[name] = z.toJSONSchema(schema, { io: 'input', target: 'draft-2020-12' });
  }

  const idParameter = {
    name: 'id',
    in: 'path',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  };

  return {
    openapi: '3.1.0',
    info: {
      title: 'Neuron',
      version: '4.0.0',
      description: [
        'Spaced repetition that schedules time rather than card count.',
        '',
        'Every endpoint below needs a session cookie except /health. Errors all',
        'share one shape: a machine readable code, the status, and a correlation',
        'id that appears in the server log. The code is a translation key, not a',
        'sentence, because the client renders it in English or Russian.',
      ].join('\n'),
    },
    servers: [{ url: baseUrl }],
    components: {
      schemas,
      securitySchemes: {
        session: {
          type: 'apiKey',
          in: 'cookie',
          name: 'better-auth.session_token',
          description: 'httpOnly, Secure, SameSite lax. Set by the sign in endpoints.',
        },
      },
    },
    security: [{ session: [] }],
    paths: {
      '/health': {
        get: {
          summary: 'Whether the server is up. The one endpoint with no session',
          security: [],
          responses: { 200: answer('The server is answering') },
        },
      },
      '/account': {
        get: {
          summary: 'Who is signed in, and what they have chosen',
          responses: { 200: answer('The account', 'Me'), ...commonErrors },
        },
        patch: {
          summary: 'Change a preference',
          requestBody: body('UpdatePreferences'),
          responses: { 200: answer('The preferences as they now stand'), ...commonErrors },
        },
        delete: {
          summary: 'Leave. Anonymises at once, erases after thirty days',
          requestBody: body('DeleteAccount'),
          responses: { 200: answer('When the rows will actually go'), ...commonErrors },
        },
      },
      '/decks': {
        get: {
          summary: 'The whole tree, with due and new counts rolled up',
          responses: { 200: answer('The tree', 'DeckTree'), ...commonErrors },
        },
        post: {
          summary: 'Create a deck',
          requestBody: body('CreateDeck'),
          responses: { 201: answer('The deck'), ...commonErrors },
        },
      },
      '/decks/reorder': {
        post: {
          summary: 'Rewrite the order of one level',
          requestBody: body('ReorderDecks'),
          responses: { 200: answer('The decks in their new order'), ...commonErrors },
        },
      },
      '/decks/deleted': {
        get: {
          summary: 'Soft-deleted decks, with original path and parent dependency',
          responses: { 200: answer('Deleted decks', 'DeletedDeckList'), ...commonErrors },
        },
      },
      '/decks/{id}': {
        parameters: [idParameter],
        get: { summary: 'One deck', responses: { 200: answer('The deck'), ...commonErrors } },
        patch: {
          summary: 'Rename a deck or change its settings',
          requestBody: body('UpdateDeck'),
          responses: { 200: answer('The deck'), ...commonErrors },
        },
        delete: {
          summary: 'Soft delete a deck and everything under it',
          responses: { 200: answer('How many rows were marked'), ...commonErrors },
        },
      },
      '/decks/{id}/move': {
        parameters: [idParameter],
        post: {
          summary: 'Move a deck, taking its subtree with it',
          requestBody: body('MoveDeck'),
          responses: { 200: answer('The deck'), ...commonErrors },
        },
      },
      '/decks/{id}/restore': {
        parameters: [idParameter],
        post: {
          summary: 'Restore one deck after its parent is live',
          responses: { 200: answer('One restored deck, or zero if already live'), ...commonErrors },
        },
      },
      '/notes': {
        get: {
          summary: 'Browse notes, filtered and paged by cursor',
          parameters: queryParameters(listNotesSchema),
          responses: { 200: answer('One page of notes'), ...commonErrors },
        },
        post: {
          summary: 'Create a note and its opening cards',
          requestBody: body('CreateNote'),
          responses: { 201: answer('The note and the cards it produced'), ...commonErrors },
        },
      },
      '/notes/deleted': {
        get: {
          summary: 'Soft-deleted notes, with original deck-chain availability',
          responses: { 200: answer('Deleted notes', 'DeletedNoteList'), ...commonErrors },
        },
      },
      '/notes/status': {
        post: {
          summary: 'Change the status of many notes at once',
          requestBody: body('BulkStatus'),
          responses: { 200: answer('How many changed'), ...commonErrors },
        },
      },
      '/notes/{id}': {
        parameters: [idParameter],
        get: {
          summary: 'One note and its cards',
          responses: { 200: answer('The note'), ...commonErrors },
        },
        patch: {
          summary: 'Edit a note, or move it to another deck',
          requestBody: body('UpdateNote'),
          responses: { 200: answer('The note'), ...commonErrors },
        },
        delete: {
          summary: 'Soft delete a note and its cards',
          responses: { 200: answer('Done'), ...commonErrors },
        },
      },
      '/notes/{id}/restore': {
        parameters: [idParameter],
        post: {
          summary: 'Restore a note and only cards proven deleted with it',
          responses: {
            200: answer('Restoration result and remaining deleted card count', 'RestoreNoteResult'),
            ...commonErrors,
          },
        },
      },
      '/notes/{id}/cards': {
        parameters: [idParameter],
        post: {
          summary: 'Open a direction the ladder has not reached yet',
          requestBody: body('UnlockDirection'),
          responses: { 201: answer('The new card'), ...commonErrors },
        },
      },
      '/cards/due': {
        get: {
          summary: 'What is waiting now',
          parameters: queryParameters(dueCardsSchema),
          responses: { 200: answer('The cards'), ...commonErrors },
        },
      },
      '/cards/{id}': {
        parameters: [idParameter],
        get: { summary: 'One card', responses: { 200: answer('The card'), ...commonErrors } },
      },
      '/cards/{id}/suspend': {
        parameters: [idParameter],
        post: {
          summary: 'Put a card aside',
          responses: { 200: answer('The card'), ...commonErrors },
        },
      },
      '/cards/{id}/unsuspend': {
        parameters: [idParameter],
        post: { summary: 'Take it back', responses: { 200: answer('The card'), ...commonErrors } },
      },
      '/cards/{id}/reset': {
        parameters: [idParameter],
        post: {
          summary: 'Start a card over. The review log keeps every row',
          responses: { 200: answer('The card'), ...commonErrors },
        },
      },
      '/presets': {
        get: {
          summary: 'Saved ways of studying',
          responses: { 200: answer('The presets'), ...commonErrors },
        },
        post: {
          summary: 'Create a preset',
          requestBody: body('CreatePreset'),
          responses: { 201: answer('The preset'), ...commonErrors },
        },
      },
      '/presets/{id}': {
        parameters: [idParameter],
        patch: {
          summary: 'Change a preset',
          requestBody: body('UpdatePreset'),
          responses: { 200: answer('The preset'), ...commonErrors },
        },
        delete: {
          summary: 'Soft delete a preset',
          responses: { 200: answer('Done'), ...commonErrors },
        },
      },
      '/imports': {
        get: {
          summary: 'Every import so far',
          responses: { 200: answer('The batches'), ...commonErrors },
        },
        post: {
          summary: 'Import notes as one batch, in one transaction',
          requestBody: body('CreateImport'),
          responses: { 201: answer('The batch, and what it produced'), ...commonErrors },
        },
      },
      '/imports/{id}/undo': {
        parameters: [idParameter],
        post: {
          summary: 'Take back a whole import',
          responses: { 200: answer('How many notes were withdrawn'), ...commonErrors },
        },
      },
      '/reviews': {
        post: {
          summary: 'Answer a card. Recomputed server side, idempotent by id',
          requestBody: body('SubmitReview'),
          responses: {
            200: answer('The card as the server left it', 'ReviewResult'),
            ...commonErrors,
          },
        },
      },
      '/reviews/batch': {
        post: {
          summary: 'A session that was answered with no network',
          requestBody: body('SubmitReviewBatch'),
          responses: { 200: answer('One result per answer', 'ReviewBatchResult'), ...commonErrors },
        },
      },
      '/sync': {
        get: {
          summary: 'Everything changed above a revision, resumable',
          parameters: queryParameters(pullSyncSchema),
          responses: { 200: answer('One page of the stream', 'PullSyncResult'), ...commonErrors },
        },
        post: {
          summary: 'A batch of client changes, applied as one transaction',
          requestBody: body('PushSync'),
          responses: {
            200: answer('What was applied and what lost a conflict', 'PushSyncResult'),
            ...commonErrors,
          },
        },
      },
    },
  };
}

/**
 * Turns a query schema into the parameter list OpenAPI wants.
 *
 * Derived from the same object the route validates with, so a query parameter
 * cannot exist in the code and be missing from the document.
 *
 * @param schema the query schema
 * @returns the parameters
 */
function queryParameters(schema: z.ZodType) {
  const json = z.toJSONSchema(schema, { io: 'input', target: 'draft-2020-12' }) as {
    properties?: Record<string, unknown>;
    required?: string[];
  };

  return Object.entries(json.properties ?? {}).map(([name, value]) => ({
    name,
    in: 'query',
    required: (json.required ?? []).includes(name),
    schema: value,
  }));
}

export { RATINGS, ratingSchema } from './rating.js';
export type { Rating } from './rating.js';

export { createUuidV7, isUuidV7, uuidV7, uuidV7Time } from './uuid.js';
export type { UuidV7Sources } from './uuid.js';

export {
  NOTE_STATUSES,
  NOTE_TYPES,
  NOTE_TYPE_FIELDS,
  NOTE_TYPE_TEMPLATES,
  noteFieldsSchemas,
  noteStatusSchema,
  noteTypeSchema,
  parseNoteFields,
  templatesFor,
} from './note-types.js';
export type {
  BasicFields,
  CardTemplate,
  ClozeFields,
  NoteFieldDefinition,
  NoteFields,
  NoteStatus,
  NoteTypeName,
  VocabFields,
} from './note-types.js';

export { DEFAULT_DECK_SETTINGS, deckSettingsSchema, resolveDeckSettings } from './deck-settings.js';
export type { DeckSettings, ResolvedDeckSettings } from './deck-settings.js';

export {
  LOCALES,
  PLANS,
  THEMES,
  dayCutoffHourSchema,
  localeSchema,
  planSchema,
  themeSchema,
  timeZoneSchema,
} from './preferences.js';
export type { Locale, Plan, Theme } from './preferences.js';

/**
 * The wire contract.
 *
 * Both ends validate against these same objects, so a request the server would
 * refuse is one the client refuses first, without a round trip to find out.
 * The api's OpenAPI document is generated from them as well, which is what
 * stops the documentation from drifting away from the code.
 */

export {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  cursorSchema,
  idParamSchema,
  idSchema,
  instantSchema,
  limitSchema,
  nameSchema,
  pageOf,
  revisionSchema,
  tagSchema,
} from './api/common.js';

export {
  API_ERROR_CODES,
  API_ERROR_STATUS,
  apiErrorCodeSchema,
  apiErrorDetailsSchema,
  apiErrorSchema,
} from './api/errors.js';
export type { ApiError, ApiErrorCode } from './api/errors.js';

export {
  createDeckSchema,
  deckNodeSchema,
  deckSchema,
  deckTreeSchema,
  moveDeckSchema,
  reorderDecksSchema,
  updateDeckSchema,
} from './api/decks.js';
export type {
  CreateDeckBody,
  Deck,
  DeckNode,
  MoveDeckBody,
  ReorderDecksBody,
  UpdateDeckBody,
} from './api/decks.js';

export {
  bulkStatusSchema,
  createNoteSchema,
  listNotesSchema,
  noteSchema,
  updateNoteSchema,
} from './api/notes.js';
export type {
  BulkStatusBody,
  CreateNoteBody,
  ListNotesQuery,
  Note,
  UpdateNoteBody,
} from './api/notes.js';

export {
  cardDirectionSchema,
  cardSchema,
  cardStateSchema,
  dueCardsSchema,
  unlockDirectionSchema,
} from './api/cards.js';
export type { Card, DueCardsQuery, UnlockDirectionBody } from './api/cards.js';

export {
  createImportSchema,
  createPresetSchema,
  importBatchSchema,
  studyPresetSchema,
  updatePresetSchema,
} from './api/study.js';
export type {
  CreateImportBody,
  CreatePresetBody,
  ImportBatch,
  StudyPreset,
  UpdatePresetBody,
} from './api/study.js';

export {
  reviewBatchResultSchema,
  reviewResultSchema,
  submitReviewBatchSchema,
  submitReviewSchema,
} from './api/reviews.js';
export type {
  ReviewBatchResult,
  ReviewResult,
  SubmitReviewBatchBody,
  SubmitReviewBody,
} from './api/reviews.js';

export {
  SYNC_ENTITIES,
  SYNC_OUTCOMES,
  pullSyncResultSchema,
  pullSyncSchema,
  pushSyncResultSchema,
  pushSyncSchema,
  syncChangeSchema,
  syncEntitySchema,
  syncOutcomeSchema,
  syncRowSchema,
} from './api/sync.js';
export type {
  PullSyncQuery,
  PullSyncResult,
  PushSyncBody,
  PushSyncResult,
  SyncChange,
  SyncEntity,
} from './api/sync.js';

export {
  deleteAccountResultSchema,
  deleteAccountSchema,
  meSchema,
  updatePreferencesSchema,
} from './api/account.js';
export type { DeleteAccountBody, Me, UpdatePreferencesBody } from './api/account.js';

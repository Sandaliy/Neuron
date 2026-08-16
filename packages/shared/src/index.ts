export { RATINGS, ratingSchema } from './rating.js';
export type { Rating } from './rating.js';

export { createUuidV7, isUuidV7, uuidV7, uuidV7Time } from './uuid.js';
export type { UuidV7Sources } from './uuid.js';

export {
  NOTE_STATUSES,
  NOTE_TYPES,
  NOTE_TYPE_TEMPLATES,
  PARTS_OF_SPEECH,
  clozeGaps,
  hasClozeGap,
  noteFieldSummary,
  noteFieldsSchemas,
  noteStatusSchema,
  noteTypeSchema,
  partOfSpeechSchema,
  parseNoteFields,
  templatesFor,
} from './note-types.js';
export type {
  BasicFields,
  CardTemplate,
  ClozeFields,
  ClozeGap,
  NoteFields,
  NoteFieldSummary,
  NoteGrammar,
  NoteStatus,
  NoteTypeName,
  PartOfSpeech,
  VocabFields,
} from './note-types.js';

export { directionsOf, openingCards, possibleCards, reconcileCards } from './card-plan.js';
export type {
  CardFace,
  CardReconciliation,
  ExistingCard,
  LadderStep,
  PlannedCard,
} from './card-plan.js';

export { editorFields, filledPaths, readField, writeField } from './note-fields.js';
export type {
  EditorField,
  EditorSection,
  FieldContext,
  FieldKind,
  FieldOption,
} from './note-fields.js';

export {
  CEFR_LEVELS,
  LANGUAGE_CODES,
  LANGUAGE_NAMES,
  cefrLevelSchema,
  languageCodeSchema,
} from './languages.js';
export type { CefrLevel, LanguageCode } from './languages.js';

export {
  TERM_KEY_LENGTH,
  exampleContainsTerm,
  normaliseTerm,
  noteTermKey,
  termOf,
} from './text.js';

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

export {
  MAXIMUM_PASSWORD_LENGTH,
  MINIMUM_PASSWORD_LENGTH,
  PASSWORD_PROBLEMS,
  PASSWORD_STRENGTHS,
  isAcceptablePassword,
  newPasswordSchema,
  passwordProblem,
  passwordSchema,
  passwordStrength,
} from './password.js';
export type { PasswordProblem, PasswordStrength } from './password.js';

export {
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_GROUP,
  RECOVERY_CODE_GROUPS,
  RECOVERY_CODE_LENGTH,
  RECOVERY_CODE_LOW_WATERMARK,
  formatRecoveryCode,
  looksLikeRecoveryCode,
  normaliseRecoveryCode,
} from './recovery-code.js';

export {
  acknowledgedSchema,
  completeRecoverySchema,
  confirmTotpSchema,
  disableTotpSchema,
  emailSchema,
  recoveryCodeSchema,
  recoveryCodesStatusSchema,
  recoverySignInResultSchema,
  recoverySignInSchema,
  regenerateRecoveryCodesSchema,
  registerResultSchema,
  registerSchema,
  requestPasswordResetSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  signInSchema,
  startTotpResultSchema,
  startTotpSchema,
  totpCodeSchema,
  twoFactorStatusSchema,
  verifyTotpSchema,
} from './api/auth.js';
export type {
  CompleteRecoveryBody,
  ConfirmTotpBody,
  DisableTotpBody,
  RecoveryCodesStatus,
  RecoverySignInBody,
  RecoverySignInResult,
  RegenerateRecoveryCodesBody,
  RegisterBody,
  RegisterResult,
  RequestPasswordResetBody,
  ResendVerificationBody,
  ResetPasswordBody,
  SignInBody,
  StartTotpBody,
  StartTotpResult,
  TwoFactorStatus,
  VerifyTotpBody,
} from './api/auth.js';

export { CATALOGUES, en, ru, translate } from './i18n/index.js';
export type { MessageKey, MessageValues, Messages } from './i18n/index.js';

import {
  IMPORT_FORMATS,
  IMPORT_CHUNK_SIZE,
  NOTE_TYPES,
  createImportSchema,
  importChunkSchema,
  idSchema,
  noteFieldsSchemas,
  uuidV7,
} from '@neuron/shared';
import type { ImportFormat, NoteTypeName } from '@neuron/shared';

import { committed, openCollection, result } from '../../lib/collection-db';
import { accountEpoch, offlineState } from '../../lib/offline';

import type { ImportAttempt, Overrides, Resolution } from './import-plan';
import type { ImportMode } from './import-source';

export interface ImportPreparation {
  deck: string;
  raw: string;
  mode: ImportMode;
  format: ImportFormat | '';
  noteType: NoteTypeName;
  columns: readonly string[];
  left: string;
  right: string;
  resolution: Resolution;
  overrides: Overrides;
  preview: boolean;
}

export interface ImportDraft {
  format: 1;
  id: string;
  accountId: string;
  revision: number;
  preparation: ImportPreparation;
  /** Frozen online delivery, never an entity-sync command. */
  delivery?: {
    attempt: ImportAttempt;
    done: number;
    summary?: { notes: number; cards: number };
  };
}

export const IMPORT_DRAFT_PREFIX = 'import-draft:';
const ACTIVE_DRAFT_KEY = 'import-draft-current';
const resolutions = ['skip', 'merge', 'create'];
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Invalid input is valid preparation; only the storage envelope must be complete. */
export function validateImportDraft(input: unknown, accountId: string): ImportDraft {
  const draft = input as ImportDraft | undefined;
  const p = draft?.preparation;
  if (
    !draft ||
    draft.format !== 1 ||
    draft.accountId !== accountId ||
    !idSchema.safeParse(draft.id).success ||
    !Number.isSafeInteger(draft.revision) ||
    draft.revision < 1 ||
    !p ||
    typeof p.deck !== 'string' ||
    typeof p.raw !== 'string' ||
    !['simple', 'table', 'json', 'file'].includes(p.mode) ||
    (p.format !== '' && !IMPORT_FORMATS.includes(p.format)) ||
    !NOTE_TYPES.includes(p.noteType) ||
    !strings(p.columns) ||
    typeof p.left !== 'string' ||
    typeof p.right !== 'string' ||
    !resolutions.includes(p.resolution) ||
    typeof p.preview !== 'boolean' ||
    !object(p.overrides) ||
    Object.entries(p.overrides).some(
      ([line, action]) => !/^[1-9]\d*$/.test(line) || !resolutions.includes(action as string),
    )
  )
    throw new Error('import_draft_invalid');
  if (draft.delivery) {
    const { attempt, done, summary } = draft.delivery;
    idSchema.parse(attempt.batchId);
    createImportSchema.parse({
      id: attempt.batchId,
      deckId: attempt.deckId,
      source: attempt.source,
      format: attempt.format,
    });
    if (
      typeof attempt.deckId !== 'string' ||
      !attempt.deckId ||
      attempt.deckId !== p.deck ||
      typeof attempt.source !== 'string' ||
      !IMPORT_FORMATS.includes(attempt.format) ||
      !NOTE_TYPES.includes(attempt.noteType) ||
      !Array.isArray(attempt.create) ||
      !Number.isSafeInteger(done) ||
      done < 0 ||
      done > Math.ceil(attempt.create.length / IMPORT_CHUNK_SIZE) ||
      !Array.isArray(attempt.merge) ||
      !Number.isSafeInteger(attempt.skipped) ||
      attempt.skipped < 0
    )
      throw new Error('import_draft_invalid');
    for (let at = 0; at < attempt.create.length; at += IMPORT_CHUNK_SIZE) {
      importChunkSchema.parse({
        notes: attempt.create.slice(at, at + IMPORT_CHUNK_SIZE).map((row) => ({
          id: row.id,
          noteType: attempt.noteType,
          fields: row.fields,
          tags: row.tags,
          ...(row.rank === undefined ? {} : { rank: row.rank }),
        })),
      });
    }
    for (const row of attempt.create) noteFieldsSchemas[attempt.noteType].parse(row.fields);
    for (const merge of attempt.merge) {
      idSchema.parse(merge.noteId);
      noteFieldsSchemas[attempt.noteType].parse(merge.fields);
    }
    if (
      summary !== undefined &&
      (!object(summary) ||
        done !== Math.ceil(attempt.create.length / IMPORT_CHUNK_SIZE) ||
        !Number.isSafeInteger(summary.notes) ||
        summary.notes < 0 ||
        !Number.isSafeInteger(summary.cards) ||
        summary.cards < 0)
    )
      throw new Error('import_draft_invalid');
  }
  return draft;
}

export function newImportDraft(accountId: string, deck = ''): ImportDraft {
  return {
    format: 1,
    id: uuidV7(),
    accountId,
    revision: 0,
    preparation: {
      deck,
      raw: '',
      mode: 'simple',
      format: '',
      noteType: 'vocab',
      columns: [],
      left: '',
      right: '',
      resolution: 'skip',
      overrides: {},
      preview: false,
    },
  };
}

export function importDraftVisit(accountId: string) {
  const epoch = accountEpoch();
  return () => {
    const state = offlineState();
    if (state.accountId !== accountId || state.signedOut || accountEpoch() !== epoch)
      throw new Error('import_draft_account');
  };
}

export async function importDrafts(accountId: string): Promise<ImportDraft[]> {
  const current = importDraftVisit(accountId);
  current();
  const db = await openCollection(accountId);
  try {
    current();
    const tx = db.transaction('meta');
    const [rows, active] = await Promise.all([
      result<unknown[]>(
        tx
          .objectStore('meta')
          .getAll(IDBKeyRange.bound(IMPORT_DRAFT_PREFIX, `${IMPORT_DRAFT_PREFIX}\uffff`)),
      ),
      result<string | undefined>(tx.objectStore('meta').get(ACTIVE_DRAFT_KEY)),
      committed(tx),
    ]);
    current();
    return rows
      .map((row) => validateImportDraft(row, accountId))
      .sort(
        (a, b) => Number(b.id === active) - Number(a.id === active) || b.id.localeCompare(a.id),
      );
  } finally {
    db.close();
  }
}

/** Compare-and-save retains a newer tab's work and an older committed draft on failure. */
export async function saveImportDraft(draft: ImportDraft): Promise<ImportDraft> {
  const current = importDraftVisit(draft.accountId);
  current();
  const next = validateImportDraft({ ...draft, revision: draft.revision + 1 }, draft.accountId);
  const db = await openCollection(draft.accountId);
  try {
    current();
    const tx = db.transaction('meta', 'readwrite');
    const done = committed(tx);
    let conflict = false;
    const store = tx.objectStore('meta');
    const read = store.get(`${IMPORT_DRAFT_PREFIX}${draft.id}`);
    read.onsuccess = () => {
      try {
        current();
        if ((read.result?.revision ?? 0) !== draft.revision) {
          conflict = true;
          tx.abort();
          return;
        }
        if (read.result) validateImportDraft(read.result, draft.accountId);
        store.put(next, `${IMPORT_DRAFT_PREFIX}${draft.id}`);
        store.put(draft.id, ACTIVE_DRAFT_KEY);
      } catch {
        tx.abort();
      }
    };
    try {
      await done;
    } catch (error) {
      if (conflict) throw new Error('import_draft_conflict', { cause: error });
      throw error;
    }
    current();
    return next;
  } finally {
    db.close();
  }
}

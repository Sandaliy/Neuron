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
    merged?: number;
    summary?: { notes: number; cards: number };
  };
}

export const IMPORT_DRAFT_PREFIX = 'import-draft:';
const ACTIVE_DRAFT_KEY = 'import-draft-current';
const preparationKey = (id: string) => `import-preparation:${id}`;
const attemptKey = (id: string) => `import-attempt:${id}`;
type DraftHeader = Omit<ImportDraft, 'format' | 'preparation' | 'delivery'> & {
  format: 2;
  delivery?: Omit<NonNullable<ImportDraft['delivery']>, 'attempt'>;
};
const validatedAttempts = new WeakSet<ImportAttempt>();
const storedPreparations = new WeakMap<ImportPreparation, string>();
const storedAttempts = new WeakMap<ImportAttempt, string>();
const frozen = new WeakSet<object>();
function freeze(value: unknown): void {
  if (!value || typeof value !== 'object' || frozen.has(value)) return;
  frozen.add(value);
  for (const child of Object.values(value)) freeze(child);
  Object.freeze(value);
}
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
    const merged = draft.delivery.merged ?? (summary ? attempt?.merge.length : 0);
    if (
      !attempt ||
      !Array.isArray(attempt.merge) ||
      !Number.isSafeInteger(merged) ||
      merged! < 0 ||
      merged! > attempt.merge.length ||
      attempt.deckId !== p.deck
    )
      throw new Error('import_draft_invalid');
    if (!validatedAttempts.has(attempt)) {
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
        new Set(attempt.create.map((row) => row.id)).size !== attempt.create.length ||
        new Set(attempt.merge.map((row) => row.noteId)).size !== attempt.merge.length
      )
        throw new Error('import_draft_invalid');
      freeze(attempt);
      validatedAttempts.add(attempt);
    }
    // Progress is mutable even though the frozen plan is validated only once per read.
    if (
      !Number.isSafeInteger(done) ||
      done < 0 ||
      done > Math.ceil(attempt.create.length / IMPORT_CHUNK_SIZE)
    )
      throw new Error('import_draft_invalid');
    if (
      summary !== undefined &&
      (!object(summary) ||
        done !== Math.ceil(attempt.create.length / IMPORT_CHUNK_SIZE) ||
        merged !== attempt.merge.length ||
        !Number.isSafeInteger(summary.notes) ||
        summary.notes < 0 ||
        !Number.isSafeInteger(summary.cards) ||
        summary.cards < 0)
    )
      throw new Error('import_draft_invalid');
  }
  freeze(p);
  return draft;
}

function validateHeader(value: unknown, accountId: string): DraftHeader {
  const head = value as DraftHeader;
  if (
    !head ||
    head.format !== 2 ||
    head.accountId !== accountId ||
    !idSchema.safeParse(head.id).success ||
    !Number.isSafeInteger(head.revision) ||
    head.revision < 1 ||
    (head.delivery !== undefined &&
      (!object(head.delivery) ||
        !Number.isSafeInteger(head.delivery.done) ||
        head.delivery.done < 0))
  )
    throw new Error('import_draft_invalid');
  return head;
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
    const store = tx.objectStore('meta');
    const reads = Promise.all([
      result<unknown[]>(
        tx
          .objectStore('meta')
          .getAll(IDBKeyRange.bound(IMPORT_DRAFT_PREFIX, `${IMPORT_DRAFT_PREFIX}\uffff`)),
      ),
      result<string | undefined>(tx.objectStore('meta').get(ACTIVE_DRAFT_KEY)),
    ]).then(async ([rows, active]) => {
      const loaded = await Promise.all(
        rows.map(async (row) => {
          if ((row as ImportDraft)?.format === 1) return row;
          const head = validateHeader(row, accountId);
          const [preparation, attempt] = await Promise.all([
            result<ImportPreparation>(store.get(preparationKey(head.id))),
            head.delivery ? result<ImportAttempt>(store.get(attemptKey(head.id))) : undefined,
          ]);
          return {
            ...head,
            format: 1,
            preparation,
            ...(head.delivery ? { delivery: { ...head.delivery, attempt } } : {}),
          };
        }),
      );
      return { loaded, active };
    });
    const [{ loaded, active }] = await Promise.all([reads, committed(tx)]);
    current();
    return loaded
      .map((row) => validateImportDraft(row, accountId))
      .map((draft) => {
        const key = `${accountId}:${draft.id}`;
        storedPreparations.set(draft.preparation, key);
        if (draft.delivery) storedAttempts.set(draft.delivery.attempt, key);
        return draft;
      })
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
        const previous = read.result;
        if (previous) {
          if (previous.format === 1) validateImportDraft(previous, draft.accountId);
          else validateHeader(previous, draft.accountId);
          if (previous.id !== draft.id) throw new Error('import_draft_invalid');
        }
        const key = `${draft.accountId}:${draft.id}`;
        // The header is the compare-and-save boundary. Large immutable values stay
        // in separate records; every acknowledgement commits only a small header.
        if (previous?.format !== 2 || storedPreparations.get(next.preparation) !== key)
          store.put(next.preparation, preparationKey(draft.id));
        if (
          next.delivery &&
          (previous?.format !== 2 || storedAttempts.get(next.delivery.attempt) !== key)
        )
          store.put(next.delivery.attempt, attemptKey(draft.id));
        if (!next.delivery) store.delete(attemptKey(draft.id));
        const { preparation: _preparation, delivery, ...base } = next;
        const head: DraftHeader = {
          ...base,
          format: 2,
          ...(delivery
            ? {
                delivery: {
                  done: delivery.done,
                  ...(delivery.merged === undefined ? {} : { merged: delivery.merged }),
                  ...(delivery.summary ? { summary: delivery.summary } : {}),
                },
              }
            : {}),
        };
        store.put(head, `${IMPORT_DRAFT_PREFIX}${draft.id}`);
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
    const key = `${draft.accountId}:${draft.id}`;
    storedPreparations.set(next.preparation, key);
    if (next.delivery) storedAttempts.set(next.delivery.attempt, key);
    return next;
  } finally {
    db.close();
  }
}

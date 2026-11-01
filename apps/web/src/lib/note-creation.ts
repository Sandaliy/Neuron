import {
  createOfflineNoteCommandSchema,
  createOfflineNoteResultSchema,
  noteFieldsSchemas,
  noteSchema,
  noteTypeSchema,
  tagSchema,
  uuidV7,
} from '@neuron/shared';
import type {
  CreateOfflineNoteCommand,
  CreateOfflineNoteResult,
  Note,
  NoteTypeName,
} from '@neuron/shared';

import { ApiFailure, request } from './api';
import {
  NOTE_CREATION_PREFIX,
  NOTE_DRAFT_PREFIX,
  committed,
  noteCreationRange,
  openCollection,
  result,
} from './collection-db';
import { changed, nextVersion } from './note-outbox';
import { accountEpoch, offlineState } from './offline';

import type { CollectionMeta, CollectionRow } from './collection-db';
import type { NoteValues, PendingNoteEdit } from './note-outbox';

/**
 * New Notes saved on this device before the server knows them.
 *
 * One record per Note, under `note-create:<noteId>` in the account's `meta`
 * store, so earlier shells that never enumerate `meta` ignore it. The Note id is
 * chosen once, when the learner saves, and is the identity the server writes.
 * The server still creates every Card; until it answers, the Note has none and
 * cannot be studied.
 *
 * `payload` is the command. Before the first delivery attempt it follows the
 * latest valid content; after it the command is frozen so a retry is exact, and
 * later edits wait in `working` until the acknowledgement turns them into an
 * ordinary Note edit against the acknowledged revision.
 */
export interface PendingNoteCreate {
  kind: 'note-create';
  accountId: string;
  entityId: string;
  operationId: string;
  sequence: number;
  createdAt: string;
  updatedAt: string;
  payload: CreateOfflineNoteCommand;
  working: NoteValues;
  started: boolean;
  state: 'draft' | 'pending' | 'conflict' | 'rejected' | 'synchronized' | 'resolved';
  outcome?: CreateOfflineNoteResult;
  failure?: string;
  /** Commands this Note held before the learner chose a Deck again. */
  previous?: { operationId: string; deckId: string; outcome?: CreateOfflineNoteResult }[];
}

const STATES = ['draft', 'pending', 'conflict', 'rejected', 'synchronized', 'resolved'] as const;
const keyOf = (noteId: string) => `${NOTE_CREATION_PREFIX}${noteId}`;

export function deliverableNote(noteType: NoteTypeName, values: NoteValues) {
  return (
    noteFieldsSchemas[noteType].safeParse(values.fields).success &&
    values.tags.length <= 50 &&
    values.tags.every((tag) => tagSchema.safeParse(tag).success)
  );
}

/** Not yet on the server: no Cards, no server actions, no learning. */
export function unsentCreation(entry: PendingNoteCreate | undefined) {
  return !!entry && entry.state !== 'synchronized' && entry.state !== 'resolved';
}

export function validateNoteCreations(input: unknown, accountId: string): PendingNoteCreate[] {
  if (!Array.isArray(input)) throw new Error('collection_invalid_outbox');
  return input
    .map((entry: PendingNoteCreate) => {
      // Raw drafts keep raw tags; identity and destination always validate.
      createOfflineNoteCommandSchema.parse({ ...entry.payload, tags: [] });
      if (entry.started || entry.state === 'pending')
        createOfflineNoteCommandSchema.parse(entry.payload);
      if (
        entry.kind !== 'note-create' ||
        entry.accountId !== accountId ||
        entry.payload.accountId !== accountId ||
        entry.operationId !== entry.payload.operationId ||
        entry.entityId !== entry.payload.noteId ||
        !noteTypeSchema.safeParse(entry.payload.noteType).success ||
        typeof entry.createdAt !== 'string' ||
        typeof entry.updatedAt !== 'string' ||
        !entry.working ||
        !entry.working.fields ||
        typeof entry.working.fields !== 'object' ||
        Array.isArray(entry.working.fields) ||
        !Array.isArray(entry.working.tags) ||
        !entry.working.tags.every((tag) => typeof tag === 'string') ||
        typeof entry.started !== 'boolean' ||
        !Number.isSafeInteger(entry.sequence) ||
        entry.sequence < 1 ||
        !STATES.includes(entry.state) ||
        (entry.started && entry.state === 'draft') ||
        (entry.state === 'synchronized' &&
          (entry.outcome?.status !== 'applied' || entry.outcome.revision < 1))
      )
        throw new Error('collection_invalid_outbox');
      if (entry.outcome) {
        const outcome = createOfflineNoteResultSchema.parse(entry.outcome);
        if (outcome.operationId !== entry.operationId || outcome.noteId !== entry.entityId)
          throw new Error('collection_invalid_outbox');
      }
      return entry;
    })
    .sort((a, b) => a.sequence - b.sequence);
}

/** The Note as this device knows it, before any pulled row replaces it. */
export function creationNote(entry: PendingNoteCreate): Note {
  return noteSchema.parse({
    id: entry.entityId,
    deckId: entry.payload.deckId,
    noteType: entry.payload.noteType,
    fields: entry.working.fields,
    tags: entry.working.tags,
    source: null,
    rank: null,
    status: 'active',
    importBatchId: null,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    rev: entry.state === 'synchronized' ? entry.outcome!.revision : 0,
  });
}

export async function noteCreations(accountId: string): Promise<PendingNoteCreate[]> {
  const db = await openCollection(accountId);
  try {
    return validateNoteCreations(
      await result(db.transaction('meta').objectStore('meta').getAll(noteCreationRange())),
      accountId,
    );
  } finally {
    db.close();
  }
}

export async function noteCreationFor(accountId: string, id: string) {
  const db = await openCollection(accountId);
  try {
    const found = await result(db.transaction('meta').objectStore('meta').get(keyOf(id)));
    return found === undefined ? undefined : validateNoteCreations([found], accountId)[0];
  } finally {
    db.close();
  }
}

function owned(owner: { accountId: string | null; epoch: number }) {
  const accountId = owner.accountId;
  if (
    !accountId ||
    owner.epoch !== accountEpoch() ||
    offlineState().accountId !== accountId ||
    offlineState().signedOut
  )
    throw new Error('collection_no_account');
  return accountId;
}

/** A live leaf Deck under live Folders in the downloaded collection. */
function liveDeck(rows: readonly CollectionRow[], id: string) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const seen = new Set<string>();
  let current: string | null = id;
  while (current !== null) {
    if (seen.has(current) || seen.size > 8) return false;
    seen.add(current);
    const row = byId.get(current);
    if (!row || row.deleted || row.purged || row.row['deletedAt']) return false;
    if (row.row['kind'] !== (current === id ? 'deck' : 'folder')) return false;
    current = typeof row.row['parentId'] === 'string' ? row.row['parentId'] : null;
  }
  return true;
}

/**
 * One read-decide-write transaction over `meta` (and whatever else `stores`
 * names). `decide` returns the record to store, or nothing to leave it as it is.
 */
async function write(
  accountId: string,
  stores: readonly ('decks' | 'notes' | 'outbox')[],
  id: string,
  decide: (input: {
    meta: CollectionMeta | undefined;
    current: PendingNoteCreate | undefined;
    reads: Record<string, unknown>;
    store: IDBObjectStore;
    tx: IDBTransaction;
    version: () => number;
  }) => PendingNoteCreate | undefined,
  extraReads: (tx: IDBTransaction) => Record<string, IDBRequest> = () => ({}),
): Promise<PendingNoteCreate | undefined> {
  const db = await openCollection(accountId);
  try {
    const tx = db.transaction(['meta', ...stores], 'readwrite');
    const done = committed(tx);
    const store = tx.objectStore('meta');
    const metaRead = store.get('sync');
    const extra = extraReads(tx);
    const read = store.get(keyOf(id));
    let failure: unknown;
    let written: PendingNoteCreate | undefined;
    let version = 0;
    read.onsuccess = () => {
      try {
        if (offlineState().accountId !== accountId) throw new Error('collection_account_changed');
        const meta = metaRead.result as CollectionMeta | undefined;
        const current =
          read.result === undefined
            ? undefined
            : validateNoteCreations([read.result], accountId)[0];
        written = decide({
          meta,
          current,
          reads: Object.fromEntries(
            Object.entries(extra).map(([key, value]) => [key, value.result]),
          ),
          store,
          tx,
          version: () => {
            if (!meta) throw new Error('collection_incomplete');
            version ||= nextVersion(meta);
            return version;
          },
        });
        if (written) {
          store.put(written, keyOf(id));
          version ||= nextVersion(meta!);
        }
        if (version) store.put({ ...meta, outboxVersion: version }, 'sync');
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    try {
      await done;
    } catch (error) {
      throw failure ?? error;
    }
    if (version) changed({ accountId, entityId: id, version });
    return written;
  } finally {
    db.close();
  }
}

/**
 * Saves a new Note on the device. The destination must be a live Deck of the
 * complete download; anything else is refused here, before the learner leaves
 * the form, rather than discovered later.
 */
export async function saveNoteCreation(
  owner: { accountId: string | null; epoch: number },
  input: {
    noteId: string;
    deckId: string;
    noteType: NoteTypeName;
    fields: Record<string, unknown>;
    tags: string[];
  },
  draft?: string,
): Promise<PendingNoteCreate> {
  const accountId = owned(owner);
  const values = { fields: input.fields, tags: input.tags };
  if (!deliverableNote(input.noteType, values)) throw new Error('collection_note_invalid');
  const written = await write(
    accountId,
    ['decks', 'notes'],
    input.noteId,
    ({ meta, current, reads, store, version }) => {
      if (owner.epoch !== accountEpoch()) throw new Error('collection_account_changed');
      if (!meta?.complete || meta.format !== 1) throw new Error('collection_incomplete');
      if (!liveDeck(reads['decks'] as CollectionRow[], input.deckId))
        throw new Error('collection_deck_missing');
      if (reads['note'] !== undefined) throw new Error('collection_note_exists');
      if (draft !== undefined) store.delete(`${NOTE_DRAFT_PREFIX}${draft}`);
      const now = new Date().toISOString();
      if (current) {
        // A repeated Save of the same form keeps its one identity.
        if (current.payload.deckId !== input.deckId || current.payload.noteType !== input.noteType)
          throw new Error('collection_note_exists');
        if (!unsentCreation(current)) return undefined;
        return {
          ...current,
          working: values,
          updatedAt: now,
          ...(current.started
            ? {}
            : {
                payload: { ...current.payload, ...values },
                ...(current.state === 'draft' ? { state: 'pending' as const } : {}),
              }),
        };
      }
      const operationId = uuidV7();
      return {
        kind: 'note-create',
        accountId,
        entityId: input.noteId,
        operationId,
        sequence: version(),
        createdAt: now,
        updatedAt: now,
        payload: { accountId, operationId, ...input },
        working: values,
        started: false,
        state: 'pending',
      };
    },
    (tx) => ({
      decks: tx.objectStore('decks').getAll(),
      note: tx.objectStore('notes').get(input.noteId),
    }),
  );
  return written ?? (await noteCreationFor(accountId, input.noteId))!;
}

/**
 * An edit of a Note that has not reached the server. Returns nothing once the
 * server has acknowledged it: from then on the edit is an ordinary Note edit.
 */
export async function updateNoteCreation(
  owner: { accountId: string | null; epoch: number },
  id: string,
  values: NoteValues,
): Promise<PendingNoteCreate | undefined> {
  const accountId = owned(owner);
  return write(accountId, [], id, ({ current }) => {
    if (owner.epoch !== accountEpoch()) throw new Error('collection_account_changed');
    if (!current || !unsentCreation(current)) return undefined;
    const ready = deliverableNote(current.payload.noteType, values);
    return {
      ...current,
      working: values,
      updatedAt: new Date().toISOString(),
      ...(current.started
        ? {}
        : {
            payload: ready ? { ...current.payload, ...values } : current.payload,
            ...(['draft', 'pending'].includes(current.state)
              ? { state: ready ? ('pending' as const) : ('draft' as const) }
              : {}),
          }),
    };
  });
}

/** What the server stored for an acknowledged command, as a pulled row would show it. */
function acknowledgedRow(entry: PendingNoteCreate, revision: number): CollectionRow {
  const note = creationNote({
    ...entry,
    state: 'synchronized',
    outcome: {
      operationId: entry.operationId,
      noteId: entry.entityId,
      status: 'applied',
      revision,
    },
    working: {
      fields: noteFieldsSchemas[entry.payload.noteType].parse(entry.payload.fields),
      tags: [...new Set(entry.payload.tags.map((tag) => tagSchema.parse(tag)))].sort(),
    },
  });
  return {
    entity: 'notes',
    id: entry.entityId,
    rev: revision,
    deleted: false,
    purged: false,
    row: note,
  };
}

let delivering: Promise<void> | undefined;
let controller: AbortController | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let attempt = 0;
const RETRY_SECONDS = [2, 5, 15, 30, 60];
export function cancelNoteCreationDelivery() {
  controller?.abort();
  delivering = undefined;
  clearTimeout(retryTimer);
  retryTimer = undefined;
  attempt = 0;
}
export async function retryNoteCreations() {
  await delivering;
  await deliverNoteCreations();
}

/** Oldest first, one at a time, each with the identity it was first sent with. */
export function deliverNoteCreations(): Promise<void> {
  if (delivering) return delivering;
  const accountId = offlineState().accountId;
  const visit = accountEpoch();
  const active = () =>
    visit === accountEpoch() &&
    offlineState().accountId === accountId &&
    offlineState().validated &&
    !offlineState().offline &&
    !offlineState().signedOut;
  if (!accountId || !active()) return Promise.resolve();
  clearTimeout(retryTimer);
  retryTimer = undefined;
  const deliveryController = new AbortController();
  controller = deliveryController;
  let interrupted = false;
  const own = (async () => {
    for (const found of await noteCreations(accountId)) {
      if (!active()) return;
      if (found.state !== 'pending') continue;
      try {
        const current = await write(accountId, [], found.entityId, ({ current }) => {
          if (!active()) throw new Error('collection_account_changed');
          if (current?.state !== 'pending' || current.operationId !== found.operationId)
            return undefined;
          return current.started ? undefined : { ...current, started: true };
        }).then(async (written) => written ?? (await noteCreationFor(accountId, found.entityId)));
        if (!active()) return;
        if (current?.state !== 'pending' || current.operationId !== found.operationId) continue;
        const outcome = createOfflineNoteResultSchema.parse(
          await request<CreateOfflineNoteResult>('/notes/offline-create', {
            method: 'POST',
            body: current.payload,
            signal: deliveryController.signal,
          }),
        );
        if (!active()) return;
        if (
          outcome.operationId !== current.operationId ||
          outcome.noteId !== current.entityId ||
          (outcome.status === 'applied' && outcome.revision < 1)
        )
          throw new Error('collection_invalid_acknowledgement');
        await write(accountId, ['outbox'], current.entityId, ({ current: latest, tx, version }) => {
          if (!active()) throw new Error('collection_account_changed');
          if (latest?.state !== 'pending' || latest.operationId !== outcome.operationId)
            return undefined;
          const updatedAt = new Date().toISOString();
          if (outcome.status !== 'applied')
            return { ...latest, state: outcome.status, outcome, updatedAt };
          const base = acknowledgedRow(latest, outcome.revision);
          const accepted = noteSchema.parse(base.row);
          if (
            JSON.stringify(latest.working) !==
            JSON.stringify({ fields: latest.payload.fields, tags: latest.payload.tags })
          ) {
            // Edits made while the command was on its way become the next
            // ordinary edit, based on the revision the server just named.
            const operationId = uuidV7();
            const next: PendingNoteEdit = {
              kind: 'note-edit',
              operationId,
              sequence: version(),
              accountId,
              entityId: latest.entityId,
              payload: { accountId, operationId, baseRev: outcome.revision, ...latest.working },
              base,
              working: latest.working,
              started: false,
              state: deliverableNote(latest.payload.noteType, latest.working) ? 'pending' : 'draft',
            };
            tx.objectStore('outbox').add(next);
          }
          return {
            ...latest,
            state: 'synchronized',
            outcome,
            working: { fields: accepted.fields, tags: accepted.tags },
            updatedAt,
          };
        });
        attempt = 0;
      } catch (error) {
        if (!active()) return;
        if (error instanceof ApiFailure && [400, 403, 404, 409, 422].includes(error.status)) {
          await write(accountId, [], found.entityId, ({ current }) =>
            current?.state === 'pending' && current.operationId === found.operationId
              ? { ...current, state: 'rejected', failure: error.code }
              : undefined,
          );
          continue;
        }
        // Lost connection, a lost answer or a server failure: the record stays
        // pending with its frozen command and is sent again, unchanged.
        interrupted = !(error instanceof ApiFailure && error.status === 401);
        return;
      }
    }
  })()
    .catch(() => {
      interrupted = true;
    })
    .finally(() => {
      if (delivering !== own) return;
      delivering = undefined;
      if (interrupted && active()) {
        const seconds = RETRY_SECONDS[Math.min(attempt, RETRY_SECONDS.length - 1)]!;
        attempt++;
        retryTimer = setTimeout(() => void deliverNoteCreations(), seconds * 1000);
      }
    });
  delivering = own;
  return own;
}

/**
 * The learner's explicit choice of a Deck for a Note whose Deck went away, or
 * the same Deck again once it is back. A new command, same Note id.
 */
export async function chooseCreationDeck(id: string, deckId: string) {
  const owner = { accountId: offlineState().accountId, epoch: accountEpoch() };
  const accountId = owned(owner);
  return write(
    accountId,
    ['decks'],
    id,
    ({ meta, current, reads }) => {
      if (owner.epoch !== accountEpoch()) throw new Error('collection_account_changed');
      if (current?.state !== 'conflict') throw new Error('collection_invalid_resolution');
      if (!meta?.complete || !liveDeck(reads['decks'] as CollectionRow[], deckId))
        throw new Error('collection_deck_missing');
      const operationId = uuidV7();
      const ready = deliverableNote(current.payload.noteType, current.working);
      const { outcome: _outcome, failure: _failure, ...rest } = current;
      return {
        ...rest,
        operationId,
        payload: {
          ...current.payload,
          ...(ready ? current.working : {}),
          operationId,
          deckId,
        },
        started: false,
        state: ready ? 'pending' : 'draft',
        updatedAt: new Date().toISOString(),
        previous: [
          ...(current.previous ?? []),
          {
            operationId: current.operationId,
            deckId: current.payload.deckId,
            ...(current.outcome ? { outcome: current.outcome } : {}),
          },
        ],
      };
    },
    (tx) => ({ decks: tx.objectStore('decks').getAll() }),
  );
}

/** Stops trying to deliver a refused Note. The record stays on the device. */
export async function archiveNoteCreation(id: string) {
  const owner = { accountId: offlineState().accountId, epoch: accountEpoch() };
  const accountId = owned(owner);
  return write(accountId, [], id, ({ current }) => {
    if (current?.state !== 'conflict' && current?.state !== 'rejected')
      throw new Error('collection_invalid_resolution');
    return { ...current, state: 'resolved', updatedAt: new Date().toISOString() };
  });
}

/** The unsaved new-Note form, kept so a closed app reopens it. */
export interface NoteDraft {
  version: 1;
  accountId: string;
  noteId: string;
  deckId: string;
  noteType: NoteTypeName;
  fields: Record<string, unknown>;
  tags: string;
  updatedAt: string;
}

export async function readNoteDraft(accountId: string, scope: string) {
  const db = await openCollection(accountId);
  try {
    const found = (await result(
      db.transaction('meta').objectStore('meta').get(`${NOTE_DRAFT_PREFIX}${scope}`),
    )) as NoteDraft | undefined;
    if (
      !found ||
      found.version !== 1 ||
      found.accountId !== accountId ||
      typeof found.noteId !== 'string' ||
      typeof found.deckId !== 'string' ||
      !noteTypeSchema.safeParse(found.noteType).success ||
      !found.fields ||
      typeof found.fields !== 'object' ||
      typeof found.tags !== 'string'
    )
      return undefined;
    return found;
  } finally {
    db.close();
  }
}

/** `draft` undefined removes it, as an explicit discard does. */
export async function writeNoteDraft(
  owner: { accountId: string | null; epoch: number },
  scope: string,
  draft: Omit<NoteDraft, 'version' | 'accountId' | 'updatedAt'> | undefined,
) {
  const accountId = owned(owner);
  const db = await openCollection(accountId);
  try {
    const tx = db.transaction('meta', 'readwrite');
    const done = committed(tx);
    const key = `${NOTE_DRAFT_PREFIX}${scope}`;
    if (draft)
      tx.objectStore('meta').put(
        { ...draft, version: 1, accountId, updatedAt: new Date().toISOString() },
        key,
      );
    else tx.objectStore('meta').delete(key);
    await done;
  } finally {
    db.close();
  }
}

import {
  editOfflineNoteCommandSchema,
  editOfflineNoteResultSchema,
  noteFieldsSchemas,
  noteSchema,
  tagSchema,
  uuidV7,
} from '@neuron/shared';
import type { EditOfflineNoteCommand, EditOfflineNoteResult, Note } from '@neuron/shared';

import { ApiFailure, request } from './api';
import { committed, openCollection, result } from './collection-db';
import { accountEpoch, offlineState } from './offline';

import type { CollectionMeta, CollectionRow } from './collection-db';

type NoteValues = { fields: Record<string, unknown>; tags: string[] };
export interface PendingNoteEdit {
  kind: 'note-edit';
  operationId: string;
  sequence: number;
  accountId: string;
  entityId: string;
  payload: EditOfflineNoteCommand;
  base: CollectionRow;
  working: NoteValues;
  started: boolean;
  state:
    'draft' | 'pending' | 'conflict' | 'unsupported' | 'rejected' | 'synchronized' | 'resolved';
  outcome?: EditOfflineNoteResult;
  failure?: string;
}

type NoteChange = { accountId: string; entityId: string; version: number };
const listeners = new Set<(change: NoteChange) => void>();
const channel =
  typeof BroadcastChannel === 'undefined'
    ? undefined
    : new BroadcastChannel('neuron.notes.changed');
function changed(change: NoteChange) {
  listeners.forEach((listener) => listener(change));
  channel?.postMessage(change);
}
channel?.addEventListener('message', (event: MessageEvent<NoteChange>) => {
  const change = event.data;
  if (
    change &&
    typeof change.accountId === 'string' &&
    typeof change.entityId === 'string' &&
    Number.isSafeInteger(change.version)
  )
    listeners.forEach((listener) => listener(change));
});
export function onNoteOutboxChange(listener: (change: NoteChange) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function deliverable(note: Note, values: NoteValues) {
  return (
    noteFieldsSchemas[note.noteType].safeParse(values.fields).success &&
    values.tags.length <= 50 &&
    values.tags.every((tag) => tagSchema.safeParse(tag).success)
  );
}

export function validateNoteEdits(input: unknown, accountId: string): PendingNoteEdit[] {
  if (!Array.isArray(input)) throw new Error('collection_invalid_outbox');
  return input
    .filter((entry: PendingNoteEdit) => entry.kind === 'note-edit')
    .map((entry: PendingNoteEdit) => {
      const base = noteSchema.parse(entry.base?.row);
      // Incomplete drafts keep raw tags; only a deliverable/frozen command must
      // meet the request limits. The identity and original revision always do.
      editOfflineNoteCommandSchema.parse({ ...entry.payload, tags: [] });
      if (entry.started || entry.state === 'pending')
        editOfflineNoteCommandSchema.parse(entry.payload);
      if (
        entry.accountId !== accountId ||
        entry.payload?.accountId !== accountId ||
        entry.operationId !== entry.payload.operationId ||
        entry.entityId !== base.id ||
        entry.base.id !== base.id ||
        entry.base.entity !== 'notes' ||
        entry.base.rev !== entry.payload.baseRev ||
        entry.base.row['rev'] !== entry.payload.baseRev ||
        entry.base.deleted ||
        entry.base.purged ||
        !entry.working ||
        !Array.isArray(entry.working.tags) ||
        !entry.working.tags.every((tag) => typeof tag === 'string') ||
        !entry.working.fields ||
        typeof entry.working.fields !== 'object' ||
        Array.isArray(entry.working.fields) ||
        typeof entry.started !== 'boolean' ||
        !Number.isSafeInteger(entry.sequence) ||
        entry.sequence < 1 ||
        ![
          'draft',
          'pending',
          'conflict',
          'unsupported',
          'rejected',
          'synchronized',
          'resolved',
        ].includes(entry.state) ||
        (entry.started && entry.state === 'draft') ||
        (entry.state === 'synchronized' &&
          (entry.outcome?.status !== 'applied' || entry.outcome.revision <= entry.payload.baseRev))
      )
        throw new Error('collection_invalid_outbox');
      if (
        entry.outcome &&
        editOfflineNoteResultSchema.parse(entry.outcome).operationId !== entry.operationId
      )
        throw new Error('collection_invalid_outbox');
      return entry;
    })
    .sort((a, b) => a.sequence - b.sequence);
}

function nextVersion(meta: CollectionMeta) {
  const version = (meta.outboxVersion ?? 0) + 1;
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('collection_invalid_outbox');
  return version;
}

function acknowledgedBase(entry: PendingNoteEdit, revision: number): CollectionRow {
  const note = noteSchema.parse(entry.base.row);
  return {
    ...entry.base,
    rev: revision,
    row: {
      ...entry.base.row,
      fields: noteFieldsSchemas[note.noteType].parse(entry.payload.fields),
      tags: [...new Set(entry.payload.tags.map((tag) => tagSchema.parse(tag)))].sort(),
      rev: revision,
    },
  };
}

export async function noteEdits(accountId: string): Promise<PendingNoteEdit[]> {
  const db = await openCollection(accountId);
  try {
    return validateNoteEdits(
      await result(db.transaction('outbox').objectStore('outbox').getAll()),
      accountId,
    );
  } finally {
    db.close();
  }
}

export async function noteEditFor(
  accountId: string,
  id: string,
): Promise<PendingNoteEdit | undefined> {
  const entries = await noteEdits(accountId);
  const latest = entries.filter((entry) => entry.entityId === id).at(-1);
  return latest?.state === 'resolved' ? undefined : latest;
}

export function noteEditOverlay(entry: PendingNoteEdit | undefined, note: Note): Note {
  return entry &&
    entry.state !== 'resolved' &&
    (entry.state !== 'synchronized' || (entry.outcome?.revision ?? 0) > note.rev)
    ? {
        ...note,
        // A draft belongs to its observed type and Deck, even if a newer pull
        // contains a conversion/move which must be recovered explicitly.
        noteType: entry.base.row['noteType'] as Note['noteType'],
        deckId: entry.base.row['deckId'] as string,
        fields: entry.working.fields,
        tags: entry.working.tags,
      }
    : note;
}

/** Keep the latest visible draft and original server base in the same transaction. */
export async function saveNoteEdit(
  owner: { accountId: string | null; epoch: number },
  id: string,
  values: NoteValues,
  observed?: Note,
  unsupported = false,
) {
  const accountId = owner.accountId;
  const visit = owner.epoch;
  if (
    !accountId ||
    visit !== accountEpoch() ||
    offlineState().accountId !== accountId ||
    offlineState().signedOut
  )
    throw new Error('collection_no_account');
  const db = await openCollection(accountId);
  try {
    const tx = db.transaction(['meta', 'notes', 'outbox'], 'readwrite');
    const done = committed(tx);
    const metaRead = tx.objectStore('meta').get('sync');
    const noteRead = tx.objectStore('notes').get(id);
    const outbox = tx.objectStore('outbox');
    const allRead = outbox.getAll();
    let failure: unknown;
    let written: PendingNoteEdit | undefined;
    let version = 0;
    allRead.onsuccess = () => {
      try {
        const meta = metaRead.result as CollectionMeta | undefined;
        const stored = noteRead.result as CollectionRow | undefined;
        const entries = validateNoteEdits(allRead.result, accountId);
        if (visit !== accountEpoch() || offlineState().accountId !== accountId)
          throw new Error('collection_account_changed');
        if (
          !meta?.complete ||
          meta.format !== 1 ||
          (!stored && !observed) ||
          ((!stored || stored.deleted || stored.purged) && !observed)
        )
          throw new Error('collection_incomplete');
        const active = entries
          .filter((entry) => entry.entityId === id && entry.state !== 'resolved')
          .at(-1);
        version = nextVersion(meta);
        if (
          active &&
          ['pending', 'draft', 'conflict', 'unsupported', 'rejected'].includes(active.state)
        ) {
          // Once started, the exact command stays frozen; newer edits remain in working.
          const nextState = active.started
            ? active.state
            : unsupported
              ? 'unsupported'
              : deliverable(noteSchema.parse(active.base.row), values)
                ? 'pending'
                : 'draft';
          written = {
            ...active,
            working: values,
            state: nextState,
            payload: active.started ? active.payload : { ...active.payload, ...values },
          };
          outbox.put(written);
        } else {
          const base =
            active?.state === 'synchronized' &&
            active.outcome?.status === 'applied' &&
            (!observed || observed.rev < active.outcome.revision)
              ? acknowledgedBase(active, active.outcome.revision)
              : observed
                ? {
                    entity: 'notes' as const,
                    id,
                    rev: observed.rev,
                    deleted: false,
                    purged: false,
                    row: noteSchema.parse(observed),
                  }
                : stored!;
          const note = noteSchema.parse(base.row);
          const operationId = uuidV7();
          const payload = { accountId, operationId, baseRev: base.rev, ...values };
          written = {
            kind: 'note-edit',
            operationId,
            sequence: version,
            accountId,
            entityId: id,
            payload,
            base,
            working: values,
            started: false,
            state: unsupported ? 'unsupported' : deliverable(note, values) ? 'pending' : 'draft',
          };
          outbox.add(written);
        }
        tx.objectStore('meta').put({ ...meta, outboxVersion: version }, 'sync');
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
    changed({ accountId, entityId: id, version });
    return written!;
  } finally {
    db.close();
  }
}

async function updateEntry(
  entry: PendingNoteEdit,
  edit: (current: PendingNoteEdit, store: IDBObjectStore, version: number) => void,
) {
  const db = await openCollection(entry.accountId);
  try {
    const tx = db.transaction(['meta', 'outbox'], 'readwrite');
    const done = committed(tx);
    const metaRead = tx.objectStore('meta').get('sync');
    const store = tx.objectStore('outbox');
    const read = store.get(entry.operationId);
    let version = 0;
    read.onsuccess = () => {
      try {
        const current = read.result as PendingNoteEdit | undefined;
        const meta = metaRead.result as CollectionMeta | undefined;
        if (!current || !meta) {
          tx.abort();
          return;
        }
        version = nextVersion(meta);
        edit(current, store, version);
        tx.objectStore('meta').put({ ...meta, outboxVersion: version }, 'sync');
      } catch {
        tx.abort();
      }
    };
    await done;
    changed({ accountId: entry.accountId, entityId: entry.entityId, version });
  } finally {
    db.close();
  }
}

let delivering: Promise<void> | undefined;
let controller: AbortController | undefined;
export function cancelNoteDelivery() {
  controller?.abort();
  delivering = undefined;
}
/** An explicit retry can be pressed while the previous acknowledgement is still in flight. */
export async function retryNoteEdits() {
  await delivering;
  await deliverNoteEdits();
}
export function deliverNoteEdits() {
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
  const deliveryController = new AbortController();
  controller = deliveryController;
  let nextReady = false;
  const own = (async () => {
    for (const found of await noteEdits(accountId)) {
      if (!active()) return;
      if (found.state !== 'pending') continue;
      try {
        await updateEntry(found, (current, store) => {
          if (!active()) throw new Error('collection_account_changed');
          if (current.state === 'pending' && !current.started)
            store.put({ ...current, started: true });
        });
        const current = await noteEditFor(accountId, found.entityId);
        if (!active()) return;
        if (!current || current.operationId !== found.operationId || current.state !== 'pending')
          continue;
        const outcome = await request<EditOfflineNoteResult>(
          `/notes/${current.entityId}/offline-edit`,
          {
            method: 'POST',
            body: current.payload,
            signal: deliveryController.signal,
          },
        );
        const result = editOfflineNoteResultSchema.parse(outcome);
        if (!active()) return;
        if (
          result.operationId !== current.operationId ||
          (result.status === 'applied' && result.revision <= current.payload.baseRev)
        )
          throw new Error('collection_invalid_acknowledgement');
        await updateEntry(current, (latest, store, version) => {
          if (!active()) throw new Error('collection_account_changed');
          if (latest.state !== 'pending') return;
          const settledState =
            result.status === 'applied'
              ? 'synchronized'
              : result.status === 'unsupported'
                ? 'unsupported'
                : 'conflict';
          const base =
            result.status === 'applied' ? acknowledgedBase(latest, result.revision) : undefined;
          const accepted = base ? noteSchema.parse(base.row) : undefined;
          store.put({
            ...latest,
            state: settledState,
            outcome: result,
            // A synchronized archive describes the command actually accepted.
            // Newer working values belong to the successor below.
            working: accepted ? { fields: accepted.fields, tags: accepted.tags } : latest.working,
          });
          if (
            result.status === 'applied' &&
            JSON.stringify(latest.working) !==
              JSON.stringify({
                fields: latest.payload.fields,
                tags: latest.payload.tags,
              })
          ) {
            const operationId = uuidV7();
            const next = {
              ...latest,
              operationId,
              sequence: version,
              payload: { accountId, operationId, baseRev: result.revision, ...latest.working },
              base: base!,
              started: false,
              state: deliverable(accepted!, latest.working) ? 'pending' : 'draft',
              outcome: undefined,
            };
            store.add(next);
            nextReady = next.state === 'pending';
          }
        });
      } catch (error) {
        if (!active()) return;
        if (error instanceof ApiFailure && [400, 403, 404, 409, 422].includes(error.status)) {
          await updateEntry(found, (current, store) => {
            if (!active()) throw new Error('collection_account_changed');
            if (current.state === 'pending')
              store.put({ ...current, state: 'rejected', failure: error.code });
          });
          continue;
        }
        return;
      }
    }
  })()
    .catch(() => undefined)
    .finally(() => {
      if (delivering === own) {
        delivering = undefined;
        if (nextReady && active()) void deliverNoteEdits();
      }
    });
  delivering = own;
  return own;
}

export async function keepServerNote(operationId: string) {
  const accountId = offlineState().accountId;
  if (!accountId) throw new Error('collection_no_account');
  const entry = (await noteEdits(accountId)).find((item) => item.operationId === operationId);
  if (!entry || !['conflict', 'unsupported', 'rejected'].includes(entry.state))
    throw new Error('collection_invalid_resolution');
  const visit = accountEpoch();
  await updateEntry(entry, (current, store) => {
    if (visit !== accountEpoch() || offlineState().accountId !== accountId)
      throw new Error('collection_account_changed');
    store.put({ ...current, state: 'resolved' });
  });
}

/** A remote change needs an explicit new command based on a fresh server row. */
export async function applySavedNote(operationId: string) {
  const accountId = offlineState().accountId;
  const visit = accountEpoch();
  if (!accountId || !offlineState().validated || offlineState().offline)
    throw new Error('collection_no_account');
  const entry = (await noteEdits(accountId)).find((item) => item.operationId === operationId);
  if (!entry || entry.state !== 'conflict' || entry.outcome?.reason !== 'changed_remotely')
    throw new Error('collection_invalid_resolution');
  const remote = await request<{ note: Note }>(`/notes/${entry.entityId}`);
  if (visit !== accountEpoch() || offlineState().accountId !== accountId)
    throw new Error('collection_account_changed');
  if (
    remote.note.noteType !== noteSchema.parse(entry.base.row).noteType ||
    remote.note.deckId !== noteSchema.parse(entry.base.row).deckId
  )
    throw new Error('collection_note_scope_changed');
  const db = await openCollection(accountId);
  try {
    const tx = db.transaction(['meta', 'outbox'], 'readwrite');
    const done = committed(tx);
    const metaRead = tx.objectStore('meta').get('sync');
    const store = tx.objectStore('outbox');
    const read = store.get(operationId);
    let version = 0;
    read.onsuccess = () => {
      try {
        const current = read.result as PendingNoteEdit | undefined;
        const meta = metaRead.result as CollectionMeta | undefined;
        if (
          !meta ||
          !current ||
          current.state !== 'conflict' ||
          visit !== accountEpoch() ||
          offlineState().accountId !== accountId
        )
          throw new Error();
        const operationId = uuidV7();
        const base = {
          entity: 'notes' as const,
          id: entry.entityId,
          rev: remote.note.rev,
          deleted: false,
          purged: false,
          row: noteSchema.parse(remote.note),
        };
        const next: PendingNoteEdit = {
          kind: 'note-edit',
          operationId,
          sequence: nextVersion(meta),
          accountId,
          entityId: entry.entityId,
          base,
          working: current.working,
          payload: { accountId, operationId, baseRev: remote.note.rev, ...current.working },
          started: false,
          state: deliverable(remote.note, current.working) ? 'pending' : 'draft',
        };
        store.put({ ...current, state: 'resolved' });
        store.add(next);
        version = next.sequence;
        tx.objectStore('meta').put({ ...meta, outboxVersion: version }, 'sync');
      } catch {
        tx.abort();
      }
    };
    await done;
    changed({ accountId, entityId: entry.entityId, version });
  } finally {
    db.close();
  }
}

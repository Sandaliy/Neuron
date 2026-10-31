import { describe, expect, it } from 'vitest';

import { uuidV7 } from '@neuron/shared';

import {
  creationNote,
  deliverableNote,
  unsentCreation,
  validateNoteCreations,
} from './note-creation';

import type { PendingNoteCreate } from './note-creation';

const accountId = 'user_1';
function record(overrides: Partial<PendingNoteCreate> = {}): PendingNoteCreate {
  const operationId = uuidV7();
  const noteId = uuidV7();
  const working = { fields: { term: 'Haus', translation: 'house' }, tags: ['a1'] };
  return {
    kind: 'note-create',
    accountId,
    entityId: noteId,
    operationId,
    sequence: 3,
    createdAt: '2026-10-31T10:00:00.000Z',
    updatedAt: '2026-10-31T10:00:00.000Z',
    payload: {
      accountId,
      operationId,
      noteId,
      deckId: uuidV7(),
      noteType: 'vocab',
      ...working,
    },
    working,
    started: false,
    state: 'pending',
    ...overrides,
  };
}

describe('device-created Note records', () => {
  it('sorts by the transaction sequence, not by identity', () => {
    const later = record({ sequence: 9 });
    const earlier = record({ sequence: 2 });
    expect(
      validateNoteCreations([later, earlier], accountId).map((entry) => entry.sequence),
    ).toEqual([2, 9]);
  });

  it('fails closed on another account, a mismatched identity or an impossible state', () => {
    const entry = record();
    for (const broken of [
      { ...entry, accountId: 'user_2' },
      { ...entry, payload: { ...entry.payload, accountId: 'user_2' } },
      { ...entry, entityId: uuidV7() },
      { ...entry, operationId: uuidV7() },
      { ...entry, kind: 'note-edit' },
      { ...entry, state: 'draft', started: true },
      { ...entry, state: 'synchronized' },
      { ...entry, state: 'unknown' },
      { ...entry, sequence: 0 },
      { ...entry, working: { fields: [], tags: [] } },
    ])
      expect(() => validateNoteCreations([broken], accountId)).toThrow();
    expect(() => validateNoteCreations({}, accountId)).toThrow();
  });

  it('keeps raw drafts but requires a deliverable frozen command', () => {
    const raw = record({
      state: 'draft',
      working: { fields: { term: 'Haus' }, tags: ['x'.repeat(200)] },
    });
    expect(validateNoteCreations([raw], accountId)).toHaveLength(1);
    const frozen = record({ started: true, payload: { ...raw.payload, tags: ['x'.repeat(200)] } });
    expect(() => validateNoteCreations([frozen], accountId)).toThrow();
  });

  it('accepts only an acknowledgement for its own command', () => {
    const entry = record();
    const applied = {
      operationId: entry.operationId,
      noteId: entry.entityId,
      status: 'applied' as const,
      revision: 41,
    };
    expect(
      validateNoteCreations([{ ...entry, state: 'synchronized', outcome: applied }], accountId),
    ).toHaveLength(1);
    expect(() =>
      validateNoteCreations(
        [{ ...entry, state: 'synchronized', outcome: { ...applied, noteId: uuidV7() } }],
        accountId,
      ),
    ).toThrow();
    expect(() =>
      validateNoteCreations(
        [{ ...entry, state: 'synchronized', outcome: { ...applied, revision: 0 } }],
        accountId,
      ),
    ).toThrow();
  });

  it('projects a Note with no revision until the server names one', () => {
    const entry = record();
    expect(creationNote(entry)).toMatchObject({
      id: entry.entityId,
      deckId: entry.payload.deckId,
      noteType: 'vocab',
      fields: entry.working.fields,
      tags: ['a1'],
      status: 'active',
      rev: 0,
    });
    const synced = {
      ...entry,
      state: 'synchronized' as const,
      outcome: {
        operationId: entry.operationId,
        noteId: entry.entityId,
        status: 'applied' as const,
        revision: 12,
      },
    };
    expect(creationNote(synced).rev).toBe(12);
    expect(unsentCreation(entry)).toBe(true);
    expect(unsentCreation({ ...entry, state: 'conflict' })).toBe(true);
    expect(unsentCreation(synced)).toBe(false);
    expect(unsentCreation({ ...entry, state: 'resolved' })).toBe(false);
    expect(unsentCreation(undefined)).toBe(false);
  });

  it('judges content with the shared field schemas and tag limits', () => {
    expect(deliverableNote('vocab', { fields: { term: 'a', translation: 'b' }, tags: [] })).toBe(
      true,
    );
    expect(deliverableNote('vocab', { fields: { term: 'a' }, tags: [] })).toBe(false);
    expect(deliverableNote('cloze', { fields: { text: 'no gap' }, tags: [] })).toBe(false);
    expect(deliverableNote('cloze', { fields: { text: '{{c1::gap}}' }, tags: [] })).toBe(true);
    expect(
      deliverableNote('basic', {
        fields: { front: 'a', back: 'b' },
        tags: Array.from({ length: 51 }, (_, index) => `t${index}`),
      }),
    ).toBe(false);
  });
});

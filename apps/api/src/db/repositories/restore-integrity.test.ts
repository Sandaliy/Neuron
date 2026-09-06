import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { RATING } from '@neuron/core';
import { restoreNoteResultSchema, uuidV7 } from '@neuron/shared';

import { testServer } from '../../testing/server.js';
import { createUser, rawOwnerPool, repositoriesFor, testDatabase } from '../testing/database.js';

import type { Repositories } from './index.js';

const database = testDatabase();

describe.skipIf(!database)('restore integrity boundary', () => {
  let repositories: Repositories;

  beforeAll(async () => {
    if (!database) return;
    await createUser(database, 'restore-integrity-boundary');
    repositories = repositoriesFor(database, 'restore-integrity-boundary');
  });

  afterEach(() => vi.useRealTimers());

  async function stored(entity: 'decks' | 'notes' | 'cards', id: string) {
    const page = await repositories.sync.pull(0, 1000);
    const row = page.changes.find((change) => change.entity === entity && change.id === id);
    expect(row).toBeDefined();
    return row!;
  }

  it('gives separate repository deletes distinct revisions even inside one transaction', async () => {
    const parent = await repositories.decks.create({ name: 'Revision parent' });
    const independent = await repositories.decks.create({
      name: 'Earlier child',
      parentId: parent.id,
    });
    const included = await repositories.decks.create({
      name: 'Included child',
      parentId: parent.id,
    });

    await repositories.transaction(async (inner) => {
      await inner.decks.softDelete(independent.id);
      await inner.decks.softDelete(parent.id);
    });

    const parentRow = await stored('decks', parent.id);
    expect((await stored('decks', included.id)).rev).toBe(parentRow.rev);
    expect((await stored('decks', independent.id)).rev).not.toBe(parentRow.rev);
  });

  it('does not conflate independent deck deletions delivered in one sync batch', async () => {
    const parent = await repositories.decks.create({ name: 'Synced parent' });
    const child = await repositories.decks.create({
      name: 'Synced independent child',
      parentId: parent.id,
    });
    const earlier = new Date(child.updatedAt.getTime() + 1000);
    const later = new Date(earlier.getTime() + 1000);
    const result = await repositories.sync.push(
      [
        { entity: 'decks', id: child.id, deleted: true, updatedAt: earlier },
        { entity: 'decks', id: parent.id, deleted: true, updatedAt: later },
      ],
      later,
    );

    expect(result.conflicts).toEqual([]);
    expect(result.applied).toHaveLength(2);
    const parentRow = await stored('decks', parent.id);
    const childRow = await stored('decks', child.id);
    expect(childRow.row['deletedAt']).not.toEqual(parentRow.row['deletedAt']);
    expect(childRow.rev).toBe(parentRow.rev);
    expect(await repositories.decks.restore(parent.id)).toBe(1);
    expect(await repositories.decks.byId(child.id)).toBeUndefined();
  });

  it('keeps earlier card deletion revisions through the ordinary note delete path', async () => {
    const deck = await repositories.decks.create({ name: 'Ordinary note deck' });
    const note = await repositories.notes.create({
      deckId: deck.id,
      noteType: 'basic',
      fields: { front: 'Ordinary question', back: 'Answer' },
    });
    const independent = await repositories.cards.create({
      noteId: note.id,
      direction: 'recognition',
      due: new Date(),
    });
    const included = await repositories.cards.create({
      noteId: note.id,
      direction: 'recall',
      due: new Date(),
    });
    await repositories.cards.softDelete(independent.id);
    const before = await stored('cards', independent.id);
    await repositories.notes.softDelete(note.id);

    const deletedNote = await stored('notes', note.id);
    expect((await stored('cards', included.id)).rev).toBe(deletedNote.rev);
    expect((await stored('cards', independent.id)).rev).toBe(before.rev);
    expect(before.rev).not.toBe(deletedNote.rev);
    expect((await stored('cards', included.id)).row['deletedWithNote']).toBe(true);
    expect((await stored('cards', independent.id)).row['deletedWithNote']).toBe(false);
  });

  it('preserves an independently deleted card provenance when sync deletes its note', async () => {
    const deck = await repositories.decks.create({ name: 'Synced note deck' });
    const note = await repositories.notes.create({
      deckId: deck.id,
      noteType: 'basic',
      fields: { front: 'Question', back: 'Answer' },
    });
    const independent = await repositories.cards.create({
      noteId: note.id,
      direction: 'recognition',
      due: new Date(),
    });
    const included = await repositories.cards.create({
      noteId: note.id,
      direction: 'recall',
      due: new Date(),
    });
    await repositories.cards.softDelete(independent.id);
    const before = await stored('cards', independent.id);
    const later = new Date(Date.now() + 1000);
    const result = await repositories.sync.push(
      [{ entity: 'notes', id: note.id, deleted: true, updatedAt: later }],
      later,
    );
    expect(result.conflicts).toEqual([]);
    expect(result.applied).toHaveLength(1);

    const after = await stored('cards', independent.id);
    const deletedNote = await stored('notes', note.id);
    expect.soft(after.rev).toBe(before.rev);
    expect.soft(after.row['deletedAt']).toEqual(before.row['deletedAt']);
    expect((await stored('cards', included.id)).rev).toBe(deletedNote.rev);

    await repositories.notes.restore(note.id);
    expect(await repositories.cards.byId(included.id)).toBeDefined();
    expect(await repositories.cards.byId(independent.id)).toBeUndefined();
  });

  it('does not restore an independently deleted child when delete timestamps coincide', async () => {
    const parent = await repositories.decks.create({ name: 'Same timestamp parent' });
    const child = await repositories.decks.create({
      name: 'Independently deleted child',
      parentId: parent.id,
    });

    // Distinct operations may share a millisecond. Only Date is fixed; database I/O uses real timers.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-04T10:00:00.000Z'));
    expect(await repositories.decks.softDelete(child.id)).toBe(1);
    expect(await repositories.decks.softDelete(parent.id)).toBe(1);
    await repositories.decks.restore(parent.id);

    expect(await repositories.decks.byId(parent.id)).toBeDefined();
    expect(await repositories.decks.byId(child.id)).toBeUndefined();
    expect(await repositories.decks.restore(parent.id)).toBe(0);
  });

  it('refuses to restore a child while its parent remains deleted', async () => {
    const parent = await repositories.decks.create({ name: 'Deleted dependency parent' });
    const child = await repositories.decks.create({ name: 'Dependent child', parentId: parent.id });
    await repositories.decks.softDelete(parent.id);

    await expect(repositories.decks.restore(child.id)).rejects.toThrow();
    expect(await repositories.decks.byId(child.id)).toBeUndefined();
    expect(await repositories.decks.restore(parent.id)).toBe(1);
    expect(await repositories.decks.byId(child.id)).toBeUndefined();
    expect(await repositories.decks.restore(child.id)).toBe(1);
    const restored = await repositories.decks.byId(child.id);
    expect(restored?.parentId).toBe(parent.id);
    expect(restored?.path).toEqual(child.path);
    expect(await repositories.decks.restore(child.id)).toBe(0);
  });

  async function fixture(name: string) {
    const deck = await repositories.decks.create({ name });
    const note = await repositories.notes.create({
      deckId: deck.id,
      noteType: 'basic',
      fields: { front: name, back: 'Answer' },
      tags: ['kept'],
      source: 'lesson',
      rank: 0,
    });
    const card = await repositories.cards.create({
      noteId: note.id,
      direction: 'recognition',
      due: new Date(),
    });
    return { deck, note, card };
  }

  function persistent(row: Record<string, unknown>) {
    const {
      rev: _rev,
      updatedAt: _updated,
      deletedAt: _deleted,
      deletedWithNote: _cause,
      ...kept
    } = row;
    return kept;
  }

  it('preserves IDs, metadata, reviews, schedules, suspension and reset through repeated lifecycles', async () => {
    const { note, card } = await fixture('Preserved schedule');
    await repositories.reviews.record({
      id: uuidV7(),
      cardId: card.id,
      rating: RATING.good,
      now: new Date(),
      durationMs: 900,
    });
    await repositories.cards.reset(card.id, new Date());
    await repositories.reviews.record({
      id: uuidV7(),
      cardId: card.id,
      rating: RATING.good,
      now: new Date(),
      durationMs: 1100,
    });
    await repositories.cards.suspend(card.id);
    const before = await repositories.cards.byId(card.id);
    const reviewsBefore = (await repositories.sync.pull(0, 1000)).changes.filter(
      (r) => r.entity === 'reviews' && r.row['cardId'] === card.id,
    );
    for (let cycle = 0; cycle < 2; cycle += 1) {
      await repositories.notes.softDelete(note.id);
      expect(await repositories.notes.restore(note.id)).toEqual({
        restored: true,
        cardsRestored: 1,
        cardsRemainingDeleted: 0,
      });
      expect(persistent((await repositories.cards.byId(card.id))!)).toEqual(persistent(before!));
      expect((await repositories.cards.byId(card.id))?.deletedWithNote).toBe(false);
      expect(persistent((await repositories.notes.byId(note.id))!)).toEqual(persistent(note));
    }
    expect(
      (await repositories.sync.pull(0, 1000)).changes.filter(
        (r) => r.entity === 'reviews' && r.row['cardId'] === card.id,
      ),
    ).toEqual(reviewsBefore);
    expect(await repositories.notes.restore(note.id)).toEqual({
      restored: false,
      cardsRestored: 0,
      cardsRemainingDeleted: 0,
    });
  });

  it('keeps same-millisecond independent card deletion unchanged and reports partial restoration', async () => {
    const { note, card } = await fixture('Card timestamp collision');
    const included = await repositories.cards.create({
      noteId: note.id,
      direction: 'recall',
      due: new Date(),
    });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-05T10:00:00Z'));
    await repositories.cards.softDelete(card.id);
    const before = await stored('cards', card.id);
    await repositories.notes.softDelete(note.id);
    expect(await stored('cards', card.id)).toEqual(before);
    expect(await repositories.notes.restore(note.id)).toEqual({
      restored: true,
      cardsRestored: 1,
      cardsRemainingDeleted: 1,
    });
    expect(await stored('cards', card.id)).toEqual(before);
    expect(await repositories.cards.byId(included.id)).toBeDefined();
  });

  it('restores a historical note but leaves cards with unknown provenance deleted, including on retry', async () => {
    const { note, card } = await fixture('Historical deletion');
    const pool = rawOwnerPool(database!);
    try {
      // Reproduce a pre-migration tombstone. The new column retains its default false.
      await pool.query('update notes set deleted_at = now() where id = $1', [note.id]);
      await pool.query('update cards set deleted_at = now() where id = $1', [card.id]);
    } finally {
      await pool.end();
    }
    const before = await stored('cards', card.id);
    const server = testServer(database!, 'restore-integrity-boundary');
    const response = await server.request(`/api/notes/${note.id}/restore`, { method: 'POST' });
    expect(response.status).toBe(200);
    expect(restoreNoteResultSchema.parse(await response.json())).toEqual({
      restored: true,
      cardsRestored: 0,
      cardsRemainingDeleted: 1,
    });
    expect(await repositories.notes.byId(note.id)).toBeDefined();
    expect(await stored('cards', card.id)).toEqual(before);
    expect(await repositories.notes.restore(note.id)).toEqual({
      restored: false,
      cardsRestored: 0,
      cardsRemainingDeleted: 1,
    });
  });

  it('refuses note and card restoration under deleted dependencies with atomic revisions', async () => {
    const { deck, note, card } = await fixture('Note dependency');
    await repositories.notes.softDelete(note.id);
    await repositories.decks.softDelete(deck.id);
    const before = await repositories.sync.revision();
    const deletedNote = await stored('notes', note.id);
    const deletedCard = await stored('cards', card.id);
    const response = await testServer(database!, 'restore-integrity-boundary').request(
      `/api/notes/${note.id}/restore`,
      { method: 'POST' },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'restore_dependency' } });
    await expect(repositories.cards.restore(card.id)).rejects.toThrow();
    expect(await repositories.sync.revision()).toBe(before);
    expect(await stored('notes', note.id)).toEqual(deletedNote);
    expect(await stored('cards', card.id)).toEqual(deletedCard);
    await repositories.decks.restore(deck.id);
    expect((await repositories.notes.restore(note.id)).cardsRestored).toBe(1);
  });

  it('rolls back note and revision when a card restoration fails', async () => {
    const { note, card } = await fixture('Restore rollback');
    await repositories.notes.softDelete(note.id);
    const pool = rawOwnerPool(database!);
    try {
      // A legacy inconsistent row collides with the restored card's unique semantic key.
      await pool.query(
        'insert into cards (id, user_id, note_id, deck_id, direction, due) select $1, user_id, note_id, deck_id, direction, due from cards where id = $2',
        [uuidV7(), card.id],
      );
    } finally {
      await pool.end();
    }
    const before = await repositories.sync.revision();
    const noteBefore = await stored('notes', note.id);
    const cardBefore = await stored('cards', card.id);
    await expect(repositories.notes.restore(note.id)).rejects.toThrow();
    expect(await repositories.sync.revision()).toBe(before);
    expect(await stored('notes', note.id)).toEqual(noteBefore);
    expect(await stored('cards', card.id)).toEqual(cardBefore);
  });

  it('keeps bulk deletion parent provenance separate from account erasure', async () => {
    const { note, card } = await fixture('Bulk provenance');
    await repositories.notes.softDeleteMany([note.id]);
    expect((await stored('cards', card.id)).row['deletedWithNote']).toBe(true);
    expect((await repositories.notes.restore(note.id)).cardsRestored).toBe(1);
    const accountUser = 'restore-account-lifecycle';
    await createUser(database!, accountUser);
    const account = repositoriesFor(database!, accountUser);
    const deck = await account.decks.create({ name: 'Account collection' });
    const accountNote = await account.notes.create({
      deckId: deck.id,
      noteType: 'basic',
      fields: { front: 'Account', back: 'Answer' },
    });
    const accountCard = await account.cards.create({
      noteId: accountNote.id,
      direction: 'recognition',
      due: new Date(),
    });
    await account.account.softDeleteCollection();
    expect(
      (await account.sync.pull(0, 1000)).changes.find((r) => r.id === accountCard.id)?.row[
        'deletedWithNote'
      ],
    ).toBe(false);
  });

  it('does not expose or accept server deletion provenance on the sync wire', async () => {
    const { card } = await fixture('Private provenance');
    const server = testServer(database!, 'restore-integrity-boundary');
    const pull = await server.request('/api/sync?since=0');
    const body = (await pull.json()) as { changes: { row: Record<string, unknown> }[] };
    expect(body.changes.every((r) => !('deletedWithNote' in r.row))).toBe(true);
    const push = await server.request('/api/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        changes: [
          {
            entity: 'cards',
            id: card.id,
            updatedAt: new Date().toISOString(),
            data: { deletedWithNote: true },
          },
        ],
      }),
    });
    expect(push.status).toBe(400);
  });

  async function push(changes: unknown[]) {
    return testServer(database!, 'restore-integrity-boundary').request('/api/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ changes }),
    });
  }

  it('sync restores notes through the proven-card boundary, preserving saved fields and metadata', async () => {
    const { note, card } = await fixture('Sync restoration');
    const independent = await repositories.cards.create({
      noteId: note.id,
      direction: 'recall',
      due: new Date(),
    });
    const at = new Date(Date.now() + 1000).toISOString();
    const deleted = await push([
      { entity: 'notes', id: note.id, deleted: true, updatedAt: at },
      { entity: 'cards', id: independent.id, deleted: true, updatedAt: at },
    ]);
    expect(deleted.status).toBe(200);
    const independentBefore = await stored('cards', independent.id);
    expect(independentBefore.row['deletedWithNote']).toBe(false);
    expect((await stored('cards', card.id)).row['deletedWithNote']).toBe(true);
    expect(independentBefore.rev).toBe((await stored('cards', card.id)).rev);
    const response = await push([
      {
        entity: 'notes',
        id: note.id,
        updatedAt: new Date(Date.now() + 2000).toISOString(),
        data: {
          deckId: uuidV7(),
          noteType: 'basic',
          fields: { front: 'Stale fields', back: 'Changed' },
        },
      },
    ]);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      noteRestorations: [
        { id: note.id, restored: true, cardsRestored: 1, cardsRemainingDeleted: 1 },
      ],
    });
    expect(persistent((await repositories.notes.byId(note.id))!)).toEqual(persistent(note));
    expect(await stored('cards', independent.id)).toEqual(independentBefore);
    expect(persistent((await repositories.cards.byId(card.id))!)).toEqual(persistent(card));
  });

  it('sync refuses restoration under deleted dependencies, including attempts to relocate', async () => {
    const { deck, note, card } = await fixture('Sync dependencies');
    const child = await repositories.decks.create({ name: 'Sync child', parentId: deck.id });
    await repositories.notes.softDelete(note.id);
    await repositories.decks.softDelete(deck.id);
    const rev = await repositories.sync.revision();
    for (const change of [
      { entity: 'decks', id: child.id, data: { name: 'Moved to root', parentId: null } },
      {
        entity: 'notes',
        id: note.id,
        data: { deckId: uuidV7(), noteType: 'basic', fields: { front: 'Moved', back: 'Answer' } },
      },
    ]) {
      const response = await push([
        { ...change, updatedAt: new Date(Date.now() + 1000).toISOString() },
      ]);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: 'restore_dependency' } });
      expect(await repositories.sync.revision()).toBe(rev);
    }
    const cardResponse = await push([
      {
        entity: 'cards',
        id: card.id,
        updatedAt: new Date(Date.now() + 1000).toISOString(),
        data: { suspendedAt: null },
      },
    ]);
    expect(cardResponse.status).toBe(200);
    expect(await cardResponse.json()).toMatchObject({
      applied: [],
      conflicts: [{ id: card.id, reason: 'deleted_remotely' }],
    });
    expect(await repositories.cards.byId(card.id)).toBeUndefined();
    const restored = await push([
      { entity: 'decks', id: deck.id, updatedAt: new Date(Date.now() + 2000).toISOString() },
    ]);
    expect(restored.status).toBe(200);
    expect(await repositories.decks.byId(child.id)).toBeUndefined();
    const childRestore = await push([
      { entity: 'decks', id: child.id, updatedAt: new Date(Date.now() + 3000).toISOString() },
    ]);
    expect(childRestore.status).toBe(200);
    expect((await repositories.decks.byId(child.id))?.path).toEqual(child.path);
    expect((await repositories.decks.byId(child.id))?.parentId).toBe(deck.id);
  });

  it('sync cannot create or move a live entity under a deleted deck', async () => {
    const { deck, note } = await fixture('Sync creation dependencies');
    await repositories.decks.softDelete(deck.id);
    for (const change of [
      { entity: 'decks', id: uuidV7(), data: { name: 'New child', parentId: deck.id } },
      {
        entity: 'notes',
        id: uuidV7(),
        data: { deckId: deck.id, noteType: 'basic', fields: { front: 'New', back: 'Answer' } },
      },
      {
        entity: 'notes',
        id: note.id,
        data: { deckId: deck.id, noteType: 'basic', fields: { front: 'Edit', back: 'Answer' } },
      },
    ]) {
      const response = await push([
        { ...change, updatedAt: new Date(Date.now() + 1000).toISOString() },
      ]);
      expect(response.status).toBe(409);
    }
  });

  it('sync builds child paths so deleting their parent also deletes those live descendants', async () => {
    const parentId = uuidV7();
    const childId = uuidV7();
    const at = new Date().toISOString();
    expect(
      (
        await push([
          { entity: 'decks', id: parentId, updatedAt: at, data: { name: 'Sync path parent' } },
          {
            entity: 'decks',
            id: childId,
            updatedAt: at,
            data: { name: 'Sync path child', parentId },
          },
        ])
      ).status,
    ).toBe(200);
    expect((await repositories.decks.byId(childId))?.path).toEqual([parentId]);
    expect(
      (
        await push([
          {
            entity: 'decks',
            id: parentId,
            deleted: true,
            updatedAt: new Date(Date.now() + 1000).toISOString(),
          },
        ])
      ).status,
    ).toBe(200);
    expect(await repositories.decks.byId(childId)).toBeUndefined();
    expect(await repositories.decks.restore(parentId)).toBe(1);
    expect(await repositories.decks.byId(childId)).toBeUndefined();
  });

  it('import undo marks only live cards belonging to the notes it deletes', async () => {
    const deck = await repositories.decks.create({ name: 'Undo provenance' });
    const batch = await repositories.importBatches.create({ deckId: deck.id, source: 'fixture' });
    const note = await repositories.notes.create({
      deckId: deck.id,
      noteType: 'basic',
      fields: { front: 'Imported', back: 'Answer' },
      importBatchId: batch.id,
    });
    const independent = await repositories.cards.create({
      noteId: note.id,
      direction: 'recognition',
      due: new Date(),
    });
    const included = await repositories.cards.create({
      noteId: note.id,
      direction: 'recall',
      due: new Date(),
    });
    await repositories.cards.softDelete(independent.id);
    const before = await stored('cards', independent.id);
    expect(await repositories.importBatches.undo(batch.id)).toBe(1);
    expect(await stored('cards', independent.id)).toEqual(before);
    expect((await stored('cards', included.id)).row['deletedWithNote']).toBe(true);
    expect(await repositories.notes.restore(note.id)).toEqual({
      restored: true,
      cardsRestored: 1,
      cardsRemainingDeleted: 1,
    });
  });

  it('cloze reconciliation deletions stay independent after later note deletion and restoration', async () => {
    const deck = await repositories.decks.create({ name: 'Cloze provenance' });
    const server = testServer(database!, 'restore-integrity-boundary');
    const created = await server.request('/api/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deckId: deck.id,
        noteType: 'cloze',
        fields: { text: '{{first}} and {{second}}' },
      }),
    });
    expect(created.status).toBe(201);
    const original = (await created.json()) as {
      note: { id: string };
      cards: { id: string; slot: number }[];
    };
    const removed = original.cards.find((card) => card.slot === 2)!;
    const edited = await server.request(`/api/notes/${original.note.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fields: { text: '{{first}}' } }),
    });
    expect(edited.status).toBe(200);
    const before = await stored('cards', removed.id);
    expect(before.deleted).toBe(true);
    expect(before.row['deletedWithNote']).toBe(false);
    await repositories.notes.softDelete(original.note.id);
    expect(await repositories.notes.restore(original.note.id)).toEqual({
      restored: true,
      cardsRestored: 1,
      cardsRemainingDeleted: 1,
    });
    expect(await stored('cards', removed.id)).toEqual(before);
  });

  it('restore remains user-bound for notes, decks and card provenance', async () => {
    const { deck, note, card } = await fixture('Isolation boundary');
    await repositories.notes.softDelete(note.id);
    await repositories.decks.softDelete(deck.id);
    await createUser(database!, 'restore-other-owner');
    const other = repositoriesFor(database!, 'restore-other-owner');
    expect(await other.notes.restore(note.id)).toEqual({
      restored: false,
      cardsRestored: 0,
      cardsRemainingDeleted: 0,
    });
    await expect(other.decks.restore(deck.id)).rejects.toThrow();
    expect(await other.cards.restore(card.id)).toBe(false);
    expect(await repositories.notes.byId(note.id)).toBeUndefined();
    expect((await stored('cards', card.id)).row['deletedWithNote']).toBe(true);
  });

  it('deletion follows legacy parent links even when their materialized paths are incomplete', async () => {
    const parent = await repositories.decks.create({ name: 'Legacy tree parent' });
    const child = await repositories.decks.create({
      name: 'Legacy tree child',
      parentId: parent.id,
    });
    const pool = rawOwnerPool(database!);
    try {
      await pool.query('update decks set path = array[]::uuid[] where id = $1', [child.id]);
    } finally {
      await pool.end();
    }
    expect(await repositories.decks.softDelete(parent.id)).toBe(2);
    const server = testServer(database!, 'restore-integrity-boundary');
    const refused = await server.request(`/api/decks/${child.id}/restore`, { method: 'POST' });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: 'restore_dependency' } });
    const restored = await server.request(`/api/decks/${parent.id}/restore`, { method: 'POST' });
    expect(await restored.json()).toEqual({ restored: 1 });
    expect(await repositories.decks.byId(child.id)).toBeUndefined();
  });

  it('sync updates hierarchy paths on moves and refuses cycles without partial writes', async () => {
    const parent = await repositories.decks.create({ name: 'Moving sync parent' });
    const destination = await repositories.decks.create({ name: 'Moving sync destination' });
    const child = await repositories.decks.create({
      name: 'Moving sync child',
      parentId: parent.id,
    });
    const at = new Date(Date.now() + 1000).toISOString();
    const moved = await push([
      {
        entity: 'decks',
        id: parent.id,
        updatedAt: at,
        data: { name: parent.name, parentId: destination.id },
      },
    ]);
    expect(moved.status).toBe(200);
    expect((await repositories.decks.byId(child.id))?.path).toEqual([destination.id, parent.id]);
    const before = await repositories.sync.revision();
    const cycle = await push([
      {
        entity: 'decks',
        id: destination.id,
        updatedAt: new Date(Date.now() + 2000).toISOString(),
        data: { name: destination.name, parentId: child.id },
      },
    ]);
    expect(cycle.status).toBe(409);
    expect(await repositories.sync.revision()).toBe(before);
    await repositories.decks.softDelete(destination.id);
    expect(await repositories.decks.byId(child.id)).toBeUndefined();
  });

  it('explicit card removal cancels parent restoration eligibility in repositories and sync', async () => {
    for (const mode of ['single', 'bulk', 'sync'] as const) {
      const { note, card } = await fixture(`Cancel card restoration ${mode}`);
      await repositories.notes.softDelete(note.id);
      const before = await stored('cards', card.id);
      if (mode === 'single') await repositories.cards.softDelete(card.id);
      if (mode === 'bulk') await repositories.cards.softDeleteMany([card.id]);
      if (mode === 'sync') {
        const at = new Date(Date.now() + 1000).toISOString();
        const result = await push([
          { entity: 'notes', id: note.id, updatedAt: at },
          { entity: 'cards', id: card.id, deleted: true, updatedAt: at },
        ]);
        expect(result.status).toBe(200);
        expect(await result.json()).toMatchObject({
          noteRestorations: [
            { id: note.id, restored: true, cardsRestored: 0, cardsRemainingDeleted: 1 },
          ],
        });
      } else {
        expect(await repositories.notes.restore(note.id)).toEqual({
          restored: true,
          cardsRestored: 0,
          cardsRemainingDeleted: 1,
        });
      }
      const after = await stored('cards', card.id);
      expect(after.deleted).toBe(true);
      expect(after.row['deletedWithNote']).toBe(false);
      expect(after.row['deletedAt']).toEqual(before.row['deletedAt']);
      expect(persistent(after.row)).toEqual(persistent(before.row));
      expect(await repositories.notes.byId(note.id)).toBeDefined();
    }
  });
});

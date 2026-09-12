import { beforeAll, describe, expect, it } from 'vitest';

import { RATING } from '@neuron/core';
import { uuidV7 } from '@neuron/shared';

import { testServer } from '../../testing/server.js';
import { createUser, repositoriesFor, testDatabase } from '../testing/database.js';

import type { Repositories } from './index.js';

const database = testDatabase();
describe.skipIf(!database)('collection kinds and irreversible recovery boundary', () => {
  let repo: Repositories;
  const userId = 'collection-integrity';
  beforeAll(async () => {
    await createUser(database!, userId);
    repo = repositoriesFor(database!, userId);
  });

  async function fixture() {
    const folder = await repo.decks.create({ name: uuidV7(), kind: 'folder' });
    const deck = await repo.decks.create({ name: 'Leaf', parentId: folder.id, kind: 'deck' });
    const note = await repo.notes.create({
      deckId: deck.id,
      noteType: 'basic',
      fields: { front: 'Question', back: 'Answer' },
    });
    const card = await repo.cards.create({
      noteId: note.id,
      direction: 'recognition',
      due: new Date(),
    });
    await repo.reviews.record({
      id: uuidV7(),
      cardId: card.id,
      rating: RATING.good,
      now: new Date(),
      durationMs: 1200,
    });
    return { folder, deck, note, card };
  }

  async function stored() {
    return (await repo.sync.pull(0, 1000)).changes;
  }

  it('permits mixed root kinds and rejects deck parents and folder-owned notes', async () => {
    const { folder, deck, note } = await fixture();
    const revision = await repo.sync.revision();
    await expect(repo.decks.create({ name: 'Invalid', parentId: deck.id })).rejects.toThrow();
    await expect(repo.decks.move(folder.id, deck.id)).rejects.toThrow();
    await expect(
      repo.notes.create({
        deckId: folder.id,
        noteType: 'basic',
        fields: { front: 'No', back: 'No' },
      }),
    ).rejects.toThrow();
    await expect(repo.notes.moveToDeck(note.id, folder.id)).rejects.toThrow();
    await expect(repo.notes.moveMany([note.id], folder.id)).rejects.toThrow();
    await expect(
      repo.importBatches.create({ deckId: folder.id, source: 'invalid-folder-target' }),
    ).rejects.toThrow();
    expect(await repo.sync.revision()).toBe(revision);
    expect((await repo.decks.create({ name: uuidV7() })).kind).toBe('deck');
  });

  it('moves full folder paths, including tombstones, without changing note ownership', async () => {
    const { folder, deck, note } = await fixture();
    const target = await repo.decks.create({ name: uuidV7(), kind: 'folder' });
    await repo.decks.softDelete(deck.id);
    await repo.decks.move(folder.id, target.id);
    expect((await stored()).find((row) => row.id === deck.id)?.row['path']).toEqual([
      target.id,
      folder.id,
    ]);
    expect((await repo.notes.byId(note.id))?.deckId).toBe(deck.id);
    await expect(repo.decks.move(target.id, folder.id)).rejects.toThrow();
  });

  it('restores the full attributed subtree and leaves an independent descendant deleted', async () => {
    const { folder, deck } = await fixture();
    const child = await repo.decks.create({ name: 'Independent', parentId: folder.id });
    await repo.decks.softDelete(child.id);
    await repo.decks.softDelete(folder.id);
    const rows = await stored();
    expect(rows.find((row) => row.id === folder.id)?.row['deletionId']).toBe(
      rows.find((row) => row.id === deck.id)?.row['deletionId'],
    );
    expect(rows.find((row) => row.id === child.id)?.row['deletionId']).not.toBe(
      rows.find((row) => row.id === folder.id)?.row['deletionId'],
    );
    expect(await repo.decks.restore(folder.id)).toBe(2);
    expect(await repo.decks.byId(child.id)).toBeUndefined();
    expect(await repo.decks.restore(folder.id)).toBe(0);
  });

  it('preserves independent deletion with identical timestamps and sync revisions', async () => {
    const { folder, deck } = await fixture();
    const independent = await repo.decks.create({ name: 'Independent', parentId: folder.id });
    const at = new Date(Date.now() + 1000);
    await repo.sync.push(
      [
        { entity: 'decks', id: independent.id, updatedAt: at, deleted: true },
        { entity: 'decks', id: folder.id, updatedAt: at, deleted: true },
      ],
      at,
    );
    const rows = await stored();
    expect(rows.find((row) => row.id === independent.id)?.rev).toBe(
      rows.find((row) => row.id === folder.id)?.rev,
    );
    await repo.sync.push(
      [
        {
          entity: 'decks',
          id: folder.id,
          updatedAt: new Date(at.getTime() + 1000),
          deleted: false,
        },
      ],
      new Date(at.getTime() + 1000),
    );
    expect(await repo.decks.byId(deck.id)).toBeDefined();
    expect(await repo.decks.byId(independent.id)).toBeUndefined();
  });

  it('returns live ancestors as context for a nested deleted deck', async () => {
    const { folder, deck } = await fixture();
    await repo.decks.softDelete(deck.id);
    const response = await testServer(database!, userId).request('/api/decks/deleted');
    const body = (await response.json()) as { decks: { id: string; context: boolean }[] };
    expect(body.decks.find((row) => row.id === folder.id)?.context).toBe(true);
    expect(body.decks.find((row) => row.id === deck.id)?.context).toBe(false);
  });

  it('keeps later independent child deletion separate and makes its retries harmless', async () => {
    const { folder, deck } = await fixture();
    await repo.decks.softDelete(folder.id);
    expect(await repo.decks.softDelete(deck.id)).toBe(1);
    const operation = (await stored()).find((row) => row.id === deck.id)?.row['deletionId'];
    expect(await repo.decks.softDelete(deck.id)).toBe(0);
    expect((await stored()).find((row) => row.id === deck.id)?.row['deletionId']).toBe(operation);
    expect(await repo.decks.restore(folder.id)).toBe(1);
    expect(await repo.decks.byId(deck.id)).toBeUndefined();
  });

  for (const target of ['folder', 'deck', 'note'] as const) {
    it(`permanently removes a ${target}, preserves reviews, rejects sync resurrection and supports retry`, async () => {
      const { folder, deck, note, card } = await fixture();
      const kind = target === 'note' ? 'notes' : 'decks';
      const id = target === 'folder' ? folder.id : target === 'deck' ? deck.id : note.id;
      if (target === 'note') await repo.notes.softDelete(id);
      else await repo.decks.softDelete(id);
      const before = (await stored()).filter((row) => row.entity === 'reviews');
      const impact = await repo.purge.impact(kind, id);
      expect(impact).toMatchObject({
        folders: target === 'folder' ? 1 : 0,
        decks: target === 'note' ? 0 : 1,
        notes: 1,
        cards: 1,
      });
      await repo.purge.remove(kind, id);
      expect((await stored()).filter((row) => row.entity === 'reviews')).toEqual(before);
      const rows = await stored();
      expect(rows.find((row) => row.id === note.id)?.row['fields']).toEqual({});
      expect(rows.find((row) => row.id === card.id)?.row['deletedWithNote']).toBe(false);
      expect(rows.find((row) => row.id === card.id)?.row['purgedAt']).toBeInstanceOf(Date);
      await expect(repo.notes.restore(note.id)).rejects.toThrow();
      const push = await repo.sync.push(
        [
          {
            entity: 'notes',
            id: note.id,
            deleted: false,
            updatedAt: new Date(Date.now() + 1000),
            data: { fields: { front: 'Resurrect' } },
          },
        ],
        new Date(),
      );
      expect(push.conflicts[0]?.reason).toBe('deleted_remotely');
      expect((await repo.notes.listDeleted()).some((row) => row.id === note.id)).toBe(false);
      expect((await repo.purge.remove(kind, id)).notes).toBe(0);
    });
  }

  it('includes independently deleted descendants in permanent folder deletion', async () => {
    const { folder, deck, note } = await fixture();
    await repo.notes.softDelete(note.id);
    await repo.decks.softDelete(deck.id);
    await repo.decks.softDelete(folder.id);
    expect(await repo.purge.remove('decks', folder.id)).toMatchObject({
      notes: 1,
      cards: 1,
      decks: 1,
      folders: 1,
    });
    await expect(repo.decks.restore(deck.id)).rejects.toThrow();
  });

  it('publishes an irreversible sync tombstone without exposing its provenance', async () => {
    const since = await repo.sync.revision();
    const { note } = await fixture();
    await repo.notes.softDelete(note.id);
    await repo.purge.remove('notes', note.id);

    const response = await testServer(database!, userId).request(
      `/api/sync?since=${since}&limit=200`,
    );
    const body = (await response.json()) as {
      changes: { id: string; deleted: boolean; purged: boolean; row: Record<string, unknown> }[];
    };
    const tombstone = body.changes.find((change) => change.id === note.id);

    expect(tombstone).toMatchObject({ deleted: true, purged: true });
    expect(tombstone?.row).not.toHaveProperty('purgedAt');
    expect(tombstone?.row).not.toHaveProperty('deletionId');
  });

  it('delivers a complete deletion revision even when it exceeds the sync page size', async () => {
    const { folder, deck, note, card } = await fixture();
    await repo.decks.softDelete(folder.id);
    const since = await repo.sync.revision();
    await repo.purge.remove('decks', folder.id);
    const page = await repo.sync.pull(since, 1);
    expect(page.changes.map((row) => row.id).sort()).toEqual(
      [folder.id, deck.id, note.id, card.id].sort(),
    );
    expect(page.changes.every((row) => row.deleted && row.row['purgedAt'] instanceof Date)).toBe(
      true,
    );
    expect((await repo.sync.pull(page.revision, 1)).changes).toEqual([]);
  });

  it('rejects another user permanent deletion without affecting the original owner', async () => {
    const { folder, note } = await fixture();
    await repo.decks.softDelete(folder.id);
    const otherId = uuidV7();
    await createUser(database!, otherId);
    const other = repositoriesFor(database!, otherId);
    await expect(other.purge.impact('decks', folder.id)).rejects.toThrow();
    await expect(other.purge.remove('decks', folder.id)).rejects.toThrow();
    expect((await repo.notes.byId(note.id))?.fields).toEqual({ front: 'Question', back: 'Answer' });
    expect(await repo.decks.restore(folder.id)).toBe(2);
  });

  it('requires explicit confirmation and rejects forged sync kinds and provenance', async () => {
    const { folder, deck } = await fixture();
    await repo.decks.softDelete(deck.id);
    const server = testServer(database!, userId);
    const response = await server.request(`/api/decks/${deck.id}/purge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmed: false }),
    });
    expect(response.status).toBe(400);
    await expect(
      repo.sync.push(
        [
          {
            entity: 'decks',
            id: folder.id,
            updatedAt: new Date(Date.now() + 1000),
            deleted: false,
            data: { name: folder.name, kind: 'deck' },
          },
        ],
        new Date(),
      ),
    ).rejects.toThrow();
  });
});

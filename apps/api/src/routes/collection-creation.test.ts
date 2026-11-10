import { createHash } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createOfflineDeckResultSchema, uuidV7 } from '@neuron/shared';
import type { CreateOfflineDeckCommand } from '@neuron/shared';

import {
  asUser,
  createUser,
  rawAppPool,
  rawOwnerPool,
  repositoriesFor,
  testDatabase,
} from '../db/testing/database.js';
import { testServer } from '../testing/server.js';

const database = testDatabase();
const ownerId = 'collection-create-owner';
const otherId = 'collection-create-other';
describe.skipIf(!database)('durable Folder and Deck creation with PostgreSQL and RLS', () => {
  const pool = database ? rawAppPool(database) : undefined;
  const ownerPool = database ? rawOwnerPool(database) : undefined;
  afterAll(async () => {
    await pool?.end();
    await ownerPool?.end();
  });
  const repo = () => repositoriesFor(database!, ownerId);
  beforeAll(async () => {
    await createUser(database!, ownerId);
    await createUser(database!, otherId);
  });
  const command = (extra: Partial<CreateOfflineDeckCommand> = {}): CreateOfflineDeckCommand => ({
    accountId: ownerId,
    operationId: uuidV7(),
    entityId: uuidV7(),
    kind: 'deck',
    name: uuidV7(),
    parentId: null,
    ancestors: [],
    ...extra,
  });
  const deliver = (body: CreateOfflineDeckCommand, account = ownerId) =>
    testServer(database!, account).request('/api/decks/offline-create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  async function outcome(body: CreateOfflineDeckCommand, account = ownerId) {
    const response = await deliver(body, account);
    expect(response.status).toBe(200);
    return createOfflineDeckResultSchema.parse(await response.json());
  }
  it('creates both kinds with device identities, normal inheritance, canonical paths and sibling ordering', async () => {
    const folder = await repo().decks.create({
      kind: 'folder',
      name: uuidV7(),
      settings: { targetLanguage: 'de' },
    });
    const nested = await repo().decks.create({
      kind: 'folder',
      name: uuidV7(),
      parentId: folder.id,
    });
    const inputs = ['folder', 'deck'].map((kind) =>
      command({
        kind: kind as 'folder' | 'deck',
        parentId: nested.id,
        ancestors: [
          { id: folder.id, rev: folder.rev },
          { id: nested.id, rev: nested.rev },
        ],
      }),
    );
    const results = await Promise.all(inputs.map((input) => outcome(input)));
    expect(results.every((row) => row.status === 'applied')).toBe(true);
    const created = await Promise.all(inputs.map((input) => repo().decks.byId(input.entityId)));
    expect(created.map((row) => row!.position).sort()).toEqual([0, 1]);
    for (const row of created)
      expect(row).toMatchObject({
        parentId: nested.id,
        path: [folder.id, nested.id],
        settings: null,
      });
    expect((await repo().decks.chain(inputs[1]!.entityId))[0]!.settings?.targetLanguage).toBe('de');
  });
  it('concurrent exact retries, lost acknowledgements, later writes and purge return the original receipt', async () => {
    const input = command();
    const first = await outcome(input);
    expect(first.status).toBe('applied');
    await repo().decks.rename(input.entityId, uuidV7());
    const revision = await repo().sync.revision();
    const retries = await Promise.all(Array.from({ length: 4 }, () => outcome(input)));
    expect(retries).toEqual(Array(4).fill(first));
    expect(await repo().sync.revision()).toBe(revision);
    await repo().decks.softDelete(input.entityId);
    await repo().purge.remove('decks', input.entityId);
    const purged = await repo().sync.revision();
    expect(await outcome(input)).toEqual(first);
    expect(await repo().sync.revision()).toBe(purged);
    expect((await deliver({ ...input, name: uuidV7() })).status).toBe(409);
    expect((await deliver({ ...input, entityId: uuidV7() })).status).toBe(409);
    expect((await deliver({ ...input, kind: 'folder' })).status).toBe(409);
    expect((await deliver({ ...input, accountId: otherId })).status).toBe(409);
  });
  it('retains unavailable-parent outcomes for deleted, purged, missing, foreign and leaf parents', async () => {
    const removed = await repo().decks.create({ kind: 'folder', name: uuidV7() });
    const purged = await repo().decks.create({ kind: 'folder', name: uuidV7() });
    const leaf = await repo().decks.create({ name: uuidV7() });
    const foreign = await repositoriesFor(database!, otherId).decks.create({
      kind: 'folder',
      name: uuidV7(),
    });
    await repo().decks.softDelete(removed.id);
    await repo().decks.softDelete(purged.id);
    await repo().purge.remove('decks', purged.id);
    for (const parent of [removed, purged, leaf, foreign, { id: uuidV7(), rev: 1 }]) {
      const input = command({
        parentId: parent.id,
        ancestors: [{ id: parent.id, rev: parent.rev }],
      });
      const first = await outcome(input);
      expect(first).toMatchObject({ status: 'conflict', reason: 'parent_unavailable' });
      expect(await repo().decks.byId(input.entityId)).toBeUndefined();
      expect(await outcome(input)).toEqual(first);
    }
  });
  it('changed names, inherited settings, ancestry and stale paths require a new explicit choice', async () => {
    for (const change of ['rename', 'settings', 'move']) {
      const parent = await repo().decks.create({ kind: 'folder', name: uuidV7() });
      const input = command({
        parentId: parent.id,
        ancestors: [{ id: parent.id, rev: parent.rev }],
      });
      if (change === 'rename') await repo().decks.rename(parent.id, uuidV7());
      if (change === 'settings')
        await repo().decks.updateSettings(parent.id, { targetLanguage: 'fr' });
      if (change === 'move') {
        const target = await repo().decks.create({ kind: 'folder', name: uuidV7() });
        await repo().decks.move(parent.id, target.id);
      }
      const refused = await outcome(input);
      expect(refused).toMatchObject({ status: 'conflict', reason: 'parent_changed' });
      const chain = await repo().decks.chain(parent.id);
      const next = {
        ...input,
        operationId: uuidV7(),
        ancestors: chain.map(({ id, rev }) => ({ id, rev })),
      };
      expect(await outcome(next)).toMatchObject({ status: 'applied' });
      expect(await outcome(input)).toEqual(refused);
      expect((await repo().decks.byId(input.entityId))?.path).toEqual(chain.map((row) => row.id));
    }
  });
  it('refuses duplicate identities in either account and case-insensitive sibling names without overwriting', async () => {
    for (const account of [ownerId, otherId]) {
      const existing = await repositoriesFor(database!, account).decks.create({ name: uuidV7() });
      const input = command({ entityId: existing.id });
      expect(await outcome(input)).toMatchObject({ status: 'conflict', reason: 'identity_exists' });
      expect(await repositoriesFor(database!, account).decks.byId(existing.id)).toEqual(existing);
    }
    const name = `Sibling ${uuidV7()}`;
    const inputs = [command({ name }), command({ name: name.toUpperCase() })];
    const results = await Promise.all(inputs.map((input) => outcome(input)));
    expect(results.filter((row) => row.status === 'applied')).toHaveLength(1);
    expect(results.filter((row) => row.status === 'conflict')).toMatchObject([
      { reason: 'name_exists' },
    ]);
  });
  it('validates names, self/cyclic and inconsistent ancestry before writing; legacy broken parents stay unavailable', async () => {
    for (const input of [
      command({ name: ' ' }),
      command({ name: 'x'.repeat(201) }),
      command({ ancestors: [{ id: uuidV7(), rev: 1 }] }),
      (() => {
        const id = uuidV7();
        return command({ entityId: id, parentId: id, ancestors: [{ id, rev: 1 }] });
      })(),
    ])
      expect((await deliver(input)).status).toBe(400);
    const parent = await repo().decks.create({ kind: 'folder', name: uuidV7() });
    // Simulate legacy inconsistent rows; the endpoint must not trust cached paths.
    await ownerPool!.query('update decks set parent_id=id where id=$1', [parent.id]);
    expect(
      await outcome(
        command({ parentId: parent.id, ancestors: [{ id: parent.id, rev: parent.rev }] }),
      ),
    ).toMatchObject({ status: 'conflict', reason: 'parent_unavailable' });
  });
  it('stores the own languages of a new deck and keeps them part of its exact retry', async () => {
    // The folder says German and Russian; the deck chose French and English,
    // and keeps its own choice rather than following the folder.
    const folder = await repo().decks.create({
      kind: 'folder',
      name: uuidV7(),
      settings: { targetLanguage: 'de', nativeLanguage: 'ru' },
    });
    const input = command({
      parentId: folder.id,
      ancestors: [{ id: folder.id, rev: folder.rev }],
      settings: { targetLanguage: 'fr', nativeLanguage: 'en' },
    });
    const since = await repo().sync.revision();
    const first = await outcome(input);
    expect(first.status).toBe('applied');
    expect((await repo().decks.byId(input.entityId))?.settings).toEqual({
      targetLanguage: 'fr',
      nativeLanguage: 'en',
    });
    // Another device's download carries the languages with the deck.
    const pulled = (await (
      await testServer(database!, ownerId).request(`/api/sync?since=${since}&limit=200`)
    ).json()) as { changes: { entity: string; id: string; row: Record<string, unknown> }[] };
    expect(
      pulled.changes.find((change) => change.entity === 'decks' && change.id === input.entityId)
        ?.row['settings'],
    ).toEqual({ targetLanguage: 'fr', nativeLanguage: 'en' });
    expect(await outcome(input)).toEqual(first);
    // The same operation with other languages is a different command.
    expect(
      (await deliver({ ...input, settings: { targetLanguage: 'fr', nativeLanguage: 'ru' } }))
        .status,
    ).toBe(409);
    expect((await deliver({ ...input, settings: undefined })).status).toBe(409);
  });
  it('delivers a creation an older app saved without languages, and matches its old receipt', async () => {
    // Saved before languages existed: delivered now, it makes a deck that says
    // its languages are missing rather than being refused.
    const legacy = command();
    expect(legacy.settings).toBeUndefined();
    expect(await outcome(legacy)).toMatchObject({ status: 'applied' });
    expect((await repo().decks.byId(legacy.entityId))?.settings).toBeNull();

    // Delivered by the previous api, acknowledgement lost, retried after this
    // release: the receipt written then must still match the same command.
    const retried = command();
    const result = {
      operationId: retried.operationId,
      entityId: retried.entityId,
      status: 'applied',
      revision: 1,
    };
    const previousDigest = createHash('sha256')
      .update(
        JSON.stringify([
          retried.accountId,
          retried.entityId,
          retried.kind,
          retried.name,
          retried.parentId,
          retried.ancestors,
        ]),
      )
      .digest('hex');
    await ownerPool!.query(
      'insert into sync_receipts (user_id, fingerprint, outcome) values ($1, $2, $3)',
      [
        ownerId,
        `deck-create:${retried.operationId}`,
        JSON.stringify({ clamped: false, deckCreation: { digest: previousDigest, result } }),
      ],
    );
    expect(await outcome(retried)).toEqual(result);
  });
  it('refuses a folder with languages and a deck with only one', async () => {
    const folder = command({
      kind: 'folder',
      settings: { targetLanguage: 'de', nativeLanguage: 'ru' },
    });
    expect((await deliver(folder)).status).toBe(400);
    const half = { ...command(), settings: { targetLanguage: 'de' } };
    expect((await deliver(half as CreateOfflineDeckCommand)).status).toBe(400);
    for (const input of [folder, half])
      expect(await repo().decks.byId(input.entityId)).toBeUndefined();
  });
  it('online creation stores both languages, accepts a deck without any and refuses one', async () => {
    const create = (body: Record<string, unknown>) =>
      testServer(database!, ownerId).request('/api/decks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const both = await create({
      id: uuidV7(),
      kind: 'deck',
      name: uuidV7(),
      parentId: null,
      settings: { targetLanguage: 'de', nativeLanguage: 'ru' },
    });
    expect(both.status).toBe(201);
    expect(((await both.json()) as { deck: { settings: unknown } }).deck.settings).toEqual({
      targetLanguage: 'de',
      nativeLanguage: 'ru',
    });
    const older = await create({ id: uuidV7(), kind: 'deck', name: uuidV7(), parentId: null });
    expect(older.status).toBe(201);
    expect(((await older.json()) as { deck: { settings: unknown } }).deck.settings).toBeNull();
    const oneId = uuidV7();
    const one = await create({
      id: oneId,
      name: uuidV7(),
      settings: { nativeLanguage: 'ru', level: 'A2' },
    });
    expect(one.status).toBe(400);
    expect(((await one.json()) as { error: { code: string } }).error.code).toBe('invalid_request');
    expect(await repo().decks.byId(oneId)).toBeUndefined();
    // A folder's languages are defaults for what it holds; one alone is fine.
    expect(
      (
        await create({
          id: uuidV7(),
          kind: 'folder',
          name: uuidV7(),
          settings: { targetLanguage: 'de' },
        })
      ).status,
    ).toBe(201);
  });
  it('keeps receipts account-isolated and immutable, and leaves Notes, Cards and Reviews unchanged', async () => {
    const deck = await repo().decks.create({ name: uuidV7() });
    const response = await testServer(database!, ownerId).request('/api/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deckId: deck.id,
        noteType: 'vocab',
        fields: { term: 'Baum', translation: 'tree' },
      }),
    });
    const { note } = (await response.json()) as { note: { id: string } };
    const [card] = await repo().cards.forNote(note.id);
    await repo().reviews.record({ cardId: card!.id, rating: 3, now: new Date() });
    const notes = await repo().notes.inDeck(deck.id);
    const cards = await repo().cards.forNote(note.id);
    const history = await repo().reviews.forCard(card!.id);
    const input = command();
    await outcome(input);
    expect(await repo().notes.inDeck(deck.id)).toEqual(notes);
    expect(await repo().cards.forNote(note.id)).toEqual(cards);
    expect(await repo().reviews.forCard(card!.id)).toEqual(history);
    await asUser(pool!, otherId, async (tx) => {
      expect(
        (await tx.query('select * from sync_receipts where user_id=$1', [ownerId])).rowCount,
      ).toBe(0);
      await expect(tx.query('update sync_receipts set outcome=outcome')).rejects.toThrow();
    });
  });
});

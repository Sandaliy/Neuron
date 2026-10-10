import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { renameDeckResultSchema, uuidV7 } from '@neuron/shared';
import type { RenameDeckCommand } from '@neuron/shared';

import {
  asUser,
  createUser,
  rawAppPool,
  repositoriesFor,
  testDatabase,
} from '../db/testing/database.js';
import { testServer } from '../testing/server.js';

const database = testDatabase();
const ownerId = 'collection-rename-owner';
const otherId = 'collection-rename-other';
describe.skipIf(!database)('revision-checked durable collection renames', () => {
  const pool = database ? rawAppPool(database) : undefined;
  afterAll(async () => {
    await pool?.end();
  });
  const repo = () => repositoriesFor(database!, ownerId);
  beforeAll(async () => {
    await createUser(database!, ownerId);
    await createUser(database!, otherId);
  });
  async function deliver(id: string, command: RenameDeckCommand, account = ownerId) {
    return testServer(database!, account).request(`/api/decks/${id}/rename`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(command),
    });
  }
  const command = (baseRev: number): RenameDeckCommand => ({
    accountId: ownerId,
    operationId: uuidV7(),
    baseRev,
    name: `Saved ${uuidV7()}`,
  });
  it('ignores unrelated account advances; exact retries after later edits and purge do not write again', async () => {
    const deck = await repo().decks.create({ name: 'Original' });
    const input = command(deck.rev);
    await repo().decks.create({ name: 'Unrelated' });
    const first = renameDeckResultSchema.parse(await (await deliver(deck.id, input)).json());
    expect(first.status).toBe('applied');
    await repo().decks.rename(deck.id, 'Later name');
    const head = await repo().sync.revision();
    const retries = await Promise.all(Array.from({ length: 4 }, () => deliver(deck.id, input)));
    for (const response of retries) expect(await response.json()).toEqual(first);
    expect(await repo().sync.revision()).toBe(head);
    expect((await repo().decks.byId(deck.id))?.name).toBe('Later name');
    await repo().decks.softDelete(deck.id);
    await repo().purge.remove('decks', deck.id);
    const purgedHead = await repo().sync.revision();
    expect(await (await deliver(deck.id, input)).json()).toEqual(first);
    expect(await repo().sync.revision()).toBe(purgedHead);
  });
  it('rejects changing payload, target or account under an existing operation identity', async () => {
    const deck = await repo().decks.create({ name: 'Original' });
    const input = command(deck.rev);
    expect((await deliver(deck.id, input)).status).toBe(200);
    expect((await deliver(deck.id, { ...input, name: 'Changed delivery' })).status).toBe(409);
    expect((await deliver(uuidV7(), input)).status).toBe(409);
    expect((await deliver(deck.id, { ...input, accountId: otherId })).status).toBe(409);
  });
  it('same-entity edits and deletions conflict; rejected retries retain the original outcome', async () => {
    for (const deleted of [false, true]) {
      const deck = await repo().decks.create({ name: 'Original' });
      const input = command(deck.rev);
      if (deleted) await repo().decks.softDelete(deck.id);
      else await repo().decks.rename(deck.id, 'Other device');
      const head = await repo().sync.revision();
      const response = renameDeckResultSchema.parse(await (await deliver(deck.id, input)).json());
      expect(response).toMatchObject({
        status: 'conflict',
        reason: deleted ? 'deleted_remotely' : 'changed_remotely',
      });
      expect(await (await deliver(deck.id, input)).json()).toEqual(response);
      expect(await repo().sync.revision()).toBe(head);
    }
  });
  it('parent deletion and purge never resurrect a collection', async () => {
    const folder = await repo().decks.create({ kind: 'folder', name: 'Parent' });
    const deck = await repo().decks.create({ name: 'Child', parentId: folder.id });
    await repo().decks.softDelete(folder.id);
    expect(await (await deliver(deck.id, command(deck.rev))).json()).toMatchObject({
      status: 'conflict',
      reason: 'deleted_remotely',
    });
    await repo().purge.remove('decks', folder.id);
    expect(await (await deliver(deck.id, command(deck.rev))).json()).toMatchObject({
      status: 'conflict',
      reason: 'deleted_remotely',
    });
  });
  it('concurrent deliveries apply one operation; competing edits conflict; receipts obey RLS and immutability', async () => {
    const deck = await repo().decks.create({ kind: 'folder', name: 'Folder' });
    const input = command(deck.rev);
    const responses = await Promise.all([
      deliver(deck.id, input),
      deliver(deck.id, input),
      deliver(deck.id, { ...input, operationId: uuidV7(), name: 'Competitor' }),
    ]);
    const outcomes = await Promise.all(responses.map((response) => response.json()));
    expect(outcomes[0]).toEqual(outcomes[1]);
    expect(
      outcomes.filter((outcome) => outcome.status === 'conflict').length,
    ).toBeGreaterThanOrEqual(1);
    const otherCommand = { ...input, accountId: otherId };
    expect(await (await deliver(deck.id, otherCommand, otherId)).json()).toMatchObject({
      status: 'conflict',
      reason: 'deleted_remotely',
    });
    await asUser(pool!, otherId, async (tx) => {
      const rows = await tx.query('select * from sync_receipts where user_id=$1', [ownerId]);
      expect(rows.rowCount).toBe(0);
      await expect(tx.query('update sync_receipts set outcome=outcome')).rejects.toThrow();
    });
  });
});

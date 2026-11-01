import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createOfflineNoteResultSchema, uuidV7 } from '@neuron/shared';
import type { CreateOfflineNoteCommand } from '@neuron/shared';

import { createRepositories } from '../db/repositories/index.js';
import { asUser, appClient, createUser, rawAppPool, testDatabase } from '../db/testing/database.js';
import { testServer } from '../testing/server.js';

const database = testDatabase();
const ownerId = 'offline-create-owner';
const otherId = 'offline-create-other';
describe.skipIf(!database)('Notes created on the device first', () => {
  const pool = database ? rawAppPool(database) : undefined;
  const db = database ? appClient(database) : undefined;
  afterAll(async () => {
    await pool?.end();
    await db?.$client.end();
  });
  beforeAll(async () => {
    await createUser(database!, ownerId);
    await createUser(database!, otherId);
  });
  const repo = (account = ownerId) => createRepositories(db!, account);
  const deck = async (account = ownerId) =>
    repo(account).decks.create({ name: `Offline creation ${uuidV7()}` });
  const command = (
    deckId: string,
    overrides: Partial<CreateOfflineNoteCommand> = {},
  ): CreateOfflineNoteCommand => ({
    accountId: ownerId,
    operationId: uuidV7(),
    noteId: uuidV7(),
    deckId,
    noteType: 'vocab',
    fields: { term: 'Haus', translation: 'house' },
    tags: ['offline', 'a1', 'offline'],
    ...overrides,
  });
  async function deliver(body: CreateOfflineNoteCommand, account = ownerId) {
    return testServer(database!, account, db).request('/api/notes/offline-create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
  const outcome = async (body: CreateOfflineNoteCommand, account = ownerId) =>
    createOfflineNoteResultSchema.parse(await (await deliver(body, account)).json());
  async function onlineCreate(deckId: string, fields: Record<string, unknown>, id?: string) {
    const response = await testServer(database!, ownerId, db).request('/api/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...(id ? { id } : {}), deckId, noteType: 'vocab', fields }),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as {
      note: { id: string; rev: number };
      cards: { direction: string; slot: number }[];
    };
  }
  const shape = (cards: readonly { direction: string; slot: number }[]) =>
    cards.map((card) => `${card.direction}:${card.slot}`).sort();

  it('writes the device id with server-made opening Cards, once, across lost answers', async () => {
    const target = await deck();
    const reference = await onlineCreate(target.id, { term: 'Baum', translation: 'tree' });
    const input = command(target.id);
    const first = await outcome(input);
    expect(first).toEqual({
      operationId: input.operationId,
      noteId: input.noteId,
      status: 'applied',
      revision: expect.any(Number),
    });
    const written = await repo().notes.byId(input.noteId);
    expect(written).toMatchObject({
      id: input.noteId,
      deckId: target.id,
      fields: { term: 'Haus', translation: 'house' },
      tags: ['a1', 'offline'],
      status: 'active',
      rev: first.revision,
    });
    const cards = await repo().cards.forNote(input.noteId);
    expect(shape(cards)).toEqual(shape(reference.cards));
    expect(cards.every((card) => card.reps === 0 && card.state === 'new')).toBe(true);
    const head = await repo().sync.revision();
    // The answer was lost: the same command arrives again, three times at once.
    const retries = await Promise.all(Array.from({ length: 3 }, () => outcome(input)));
    for (const retry of retries) expect(retry).toEqual(first);
    expect(await repo().sync.revision()).toBe(head);
    expect(await repo().cards.forNote(input.noteId)).toEqual(cards);
    expect((await repo().notes.inDeck(target.id)).map((note) => note.id).sort()).toEqual(
      [reference.note.id, input.noteId].sort(),
    );
    expect((await deliver({ ...input, tags: ['altered'] })).status).toBe(409);
  });

  it('creates one Note when the first delivery races itself', async () => {
    const target = await deck();
    const input = command(target.id);
    const outcomes = await Promise.all(Array.from({ length: 4 }, () => outcome(input)));
    expect(new Set(outcomes.map((value) => JSON.stringify(value))).size).toBe(1);
    expect(outcomes[0]?.status).toBe('applied');
    expect(await repo().notes.inDeck(target.id)).toHaveLength(1);
    const reference = command(target.id);
    await outcome(reference);
    expect((await repo().cards.forNote(input.noteId)).length).toBe(
      (await repo().cards.forNote(reference.noteId)).length,
    );
  });

  it('accepts the next edit against the acknowledged revision and keeps its Cards', async () => {
    const target = await deck();
    const input = command(target.id);
    const created = await outcome(input);
    const cards = await repo().cards.forNote(input.noteId);
    const edit = await testServer(database!, ownerId, db).request(
      `/api/notes/${input.noteId}/offline-edit`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          accountId: ownerId,
          operationId: uuidV7(),
          baseRev: created.revision,
          fields: { term: 'Haus', translation: 'house, home' },
          tags: ['a1', 'offline'],
        }),
      },
    );
    expect(await edit.json()).toMatchObject({ status: 'applied' });
    expect(await repo().cards.forNote(input.noteId)).toEqual(cards);
  });

  it('creates every cloze gap and leaves existing schedules and Reviews alone', async () => {
    const target = await deck();
    const existing = await onlineCreate(target.id, { term: 'Weg', translation: 'way' });
    const [answered] = await repo().cards.forNote(existing.note.id);
    await repo().reviews.record({ cardId: answered!.id, rating: 3, now: new Date() });
    const scheduled = await repo().cards.forNote(existing.note.id);
    const history = await repo().reviews.forCard(answered!.id);
    const input = command(target.id, {
      noteType: 'cloze',
      fields: { text: '{{c1::Eins}}, {{c2::zwei}} und {{c3::drei}}' },
      tags: [],
    });
    expect(await outcome(input)).toMatchObject({ status: 'applied' });
    const cards = await repo().cards.forNote(input.noteId);
    expect(cards.map((card) => card.slot).sort()).toEqual([1, 2, 3]);
    expect(new Set(cards.map((card) => card.id)).size).toBe(3);
    expect(await repo().cards.forNote(existing.note.id)).toEqual(scheduled);
    expect(await repo().reviews.forCard(answered!.id)).toEqual(history);
  });

  it('keeps an unavailable destination as a remembered conflict without writing', async () => {
    const deleted = await deck();
    await repo().decks.softDelete(deleted.id);
    const folder = await repo().decks.create({ name: `Folder ${uuidV7()}`, kind: 'folder' });
    const insideFolder = await repo().decks.create({
      name: `Leaf ${uuidV7()}`,
      parentId: folder.id,
    });
    await repo().decks.softDelete(folder.id);
    const purged = await deck();
    await repo().decks.softDelete(purged.id);
    await repo().purge.remove('decks', purged.id);
    const liveFolder = await repo().decks.create({ name: `Folder ${uuidV7()}`, kind: 'folder' });
    const foreign = await deck(otherId);
    const head = await repo().sync.revision();
    for (const deckId of [
      deleted.id,
      insideFolder.id,
      purged.id,
      liveFolder.id,
      foreign.id,
      uuidV7(),
    ]) {
      const input = command(deckId);
      expect(await outcome(input)).toEqual({
        operationId: input.operationId,
        noteId: input.noteId,
        status: 'conflict',
        reason: 'deck_unavailable',
        revision: 0,
      });
      expect(await repo().notes.byId(input.noteId)).toBeUndefined();
    }
    expect(await repo().sync.revision()).toBe(head);
    expect(await repo(otherId).notes.inDeck(foreign.id)).toHaveLength(0);

    // Restoration does not rewrite the remembered outcome; a new command can
    // deliver the same Note id once the learner asks.
    const input = command(deleted.id);
    const conflict = await outcome(input);
    await repo().decks.restore(deleted.id);
    expect(await outcome(input)).toEqual(conflict);
    const again = await outcome({ ...input, operationId: uuidV7() });
    expect(again).toMatchObject({ status: 'applied', noteId: input.noteId });
    expect((await repo().notes.byId(input.noteId))?.deckId).toBe(deleted.id);
  });

  it('refuses an id another row already holds, in this or another account', async () => {
    const target = await deck();
    const taken = uuidV7();
    const online = await onlineCreate(target.id, { term: 'Tür', translation: 'door' }, taken);
    const before = await repo().notes.byId(taken);
    const cards = await repo().cards.forNote(taken);
    const input = command(target.id, { noteId: taken });
    expect(await outcome(input)).toMatchObject({ status: 'rejected', reason: 'note_exists' });
    expect(await repo().notes.byId(taken)).toEqual(before);
    expect(await repo().cards.forNote(taken)).toEqual(cards);
    expect(online.note.id).toBe(taken);

    const foreignDeck = await deck(otherId);
    const foreignId = uuidV7();
    expect(
      await outcome(
        { ...command(foreignDeck.id, { noteId: foreignId }), accountId: otherId },
        otherId,
      ),
    ).toMatchObject({ status: 'applied' });
    const collision = command(target.id, { noteId: foreignId });
    expect(await outcome(collision)).toMatchObject({ status: 'rejected', reason: 'note_exists' });
    expect(await repo().notes.byId(foreignId)).toBeUndefined();
    expect((await repo(otherId).notes.byId(foreignId))?.deckId).toBe(foreignDeck.id);
  });

  it('rejects invalid content and another account before any receipt', async () => {
    const target = await deck();
    const head = await repo().sync.revision();
    const invalid = command(target.id, { fields: { term: 'Allein' } });
    expect((await deliver(invalid)).status).toBe(400);
    expect((await deliver({ ...command(target.id), accountId: otherId })).status).toBe(409);
    expect((await deliver({ ...command(target.id), extra: true } as never)).status).toBe(400);
    expect(await repo().sync.revision()).toBe(head);
    expect(await repo().notes.inDeck(target.id)).toHaveLength(0);
    // Nothing remembered the refusal, so corrected content under that identity can land.
    expect(
      await outcome({ ...invalid, fields: { term: 'Allein', translation: 'alone' } }),
    ).toMatchObject({ status: 'applied' });
  });

  it('keeps receipts and created rows isolated under RLS', async () => {
    const target = await deck();
    const input = command(target.id);
    await outcome(input);
    await asUser(pool!, otherId, async (tx) => {
      expect((await tx.query('select * from notes where id=$1', [input.noteId])).rowCount).toBe(0);
      expect(
        (
          await tx.query('select * from sync_receipts where fingerprint=$1', [
            `note-create:${input.operationId}`,
          ])
        ).rowCount,
      ).toBe(0);
    });
    await asUser(pool!, ownerId, async (tx) => {
      const receipts = await tx.query('select outcome from sync_receipts where fingerprint=$1', [
        `note-create:${input.operationId}`,
      ]);
      expect(JSON.stringify(receipts.rows)).not.toContain('Haus');
      await expect(tx.query('update sync_receipts set outcome=outcome')).rejects.toThrow();
    });
  });
});

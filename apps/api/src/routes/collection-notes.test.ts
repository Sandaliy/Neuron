import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { editOfflineNoteResultSchema, uuidV7 } from '@neuron/shared';
import type { EditOfflineNoteCommand } from '@neuron/shared';

import { createRepositories } from '../db/repositories/index.js';
import { asUser, appClient, createUser, rawAppPool, testDatabase } from '../db/testing/database.js';
import { testServer } from '../testing/server.js';

const database = testDatabase();
const ownerId = 'offline-note-owner';
const otherId = 'offline-note-other';
describe.skipIf(!database)('revision-checked existing Note edits', () => {
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
  const repo = () => createRepositories(db!, ownerId);
  async function note() {
    const deck = await repo().decks.create({ name: `Note deck ${uuidV7()}` });
    const response = await testServer(database!, ownerId, db).request('/api/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deckId: deck.id,
        noteType: 'vocab',
        fields: { term: 'Original', translation: 'Original meaning' },
      }),
    });
    expect(response.status).toBe(201);
    return (await response.json()).note as { id: string; rev: number };
  }
  const command = (baseRev: number, translation = 'Local meaning'): EditOfflineNoteCommand => ({
    accountId: ownerId,
    operationId: uuidV7(),
    baseRev,
    fields: { term: 'Original', translation },
    tags: ['offline'],
  });
  async function deliver(id: string, body: EditOfflineNoteCommand, account = ownerId) {
    return testServer(database!, account, db).request(`/api/notes/${id}/offline-edit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
  it('retains answered Card identity, schedule and Reviews; retries exactly after a lost response', async () => {
    const created = await note();
    const before = await repo().cards.forNote(created.id);
    await repo().reviews.record({ cardId: before[0]!.id, rating: 4, now: new Date() });
    const answered = await repo().cards.forNote(created.id);
    const reviews = await repo().reviews.forCard(before[0]!.id);
    const current = await repo().notes.byId(created.id);
    const input = command(current!.rev);
    await repo().decks.create({ name: 'Unrelated revision' });
    const first = editOfflineNoteResultSchema.parse(
      await (await deliver(created.id, input)).json(),
    );
    expect(first.status).toBe('applied');
    const written = await repo().notes.byId(created.id);
    expect(written?.fields).toMatchObject({ translation: 'Local meaning' });
    expect(written?.tags).toEqual(['offline']);
    expect(await repo().cards.forNote(created.id)).toEqual(answered);
    expect(await repo().reviews.forCard(before[0]!.id)).toEqual(reviews);
    await repo().notes.updateFields(created.id, { term: 'Original', translation: 'Later edit' });
    const head = await repo().sync.revision();
    for (const response of await Promise.all(
      Array.from({ length: 3 }, () => deliver(created.id, input)),
    ))
      expect(await response.json()).toEqual(first);
    expect(await repo().sync.revision()).toBe(head);
    expect((await repo().notes.byId(created.id))?.fields).toMatchObject({
      translation: 'Later edit',
    });
    expect((await deliver(created.id, { ...input, tags: ['altered'] })).status).toBe(409);
  });
  it('preserves competing edits, deletion and purge as immutable conflicts', async () => {
    const changed = await note();
    const changedInput = command(changed.rev);
    await repo().notes.updateFields(changed.id, {
      term: 'Original',
      translation: 'Remote meaning',
    });
    const conflict = editOfflineNoteResultSchema.parse(
      await (await deliver(changed.id, changedInput)).json(),
    );
    expect(conflict).toMatchObject({ status: 'conflict', reason: 'changed_remotely' });
    expect(await (await deliver(changed.id, changedInput)).json()).toEqual(conflict);
    expect((await repo().notes.byId(changed.id))?.fields).toMatchObject({
      translation: 'Remote meaning',
    });
    const deleted = await note();
    await repo().notes.softDelete(deleted.id);
    expect(await (await deliver(deleted.id, command(deleted.rev))).json()).toMatchObject({
      status: 'conflict',
      reason: 'deleted_remotely',
    });
    const purged = await note();
    await repo().notes.softDelete(purged.id);
    await repo().purge.remove('notes', purged.id);
    expect(await (await deliver(purged.id, command(purged.rev))).json()).toMatchObject({
      status: 'conflict',
      reason: 'deleted_remotely',
    });
  });
  it('refuses Card removal and cross-account delivery without writing', async () => {
    const created = await note();
    const before = await repo().notes.byId(created.id);
    const cards = await repo().cards.forNote(created.id);
    const input = command(created.rev);
    expect((await deliver(created.id, { ...input, accountId: otherId }, otherId)).status).toBe(200);
    expect(
      await (await deliver(created.id, { ...input, accountId: otherId }, otherId)).json(),
    ).toMatchObject({ status: 'conflict', reason: 'deleted_remotely' });
    const cloze = await testServer(database!, ownerId, db).request('/api/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deckId: before!.deckId,
        noteType: 'cloze',
        fields: { text: '{{c1::One}} {{c2::Two}}' },
      }),
    });
    const clozeNote = (await cloze.json()).note as { id: string; rev: number };
    const clozeCards = await repo().cards.forNote(clozeNote.id);
    const result = await deliver(clozeNote.id, {
      ...command(clozeNote.rev),
      fields: { text: '{{c1::One}} Two' },
    });
    expect(await result.json()).toMatchObject({
      status: 'unsupported',
      reason: 'cards_would_be_lost',
    });
    expect(await repo().cards.forNote(clozeNote.id)).toEqual(clozeCards);
    expect(await repo().cards.forNote(created.id)).toEqual(cards);
  });
  it('receipts remain isolated and immutable under RLS', async () => {
    await asUser(pool!, otherId, async (tx) => {
      const rows = await tx.query('select * from sync_receipts where user_id=$1', [ownerId]);
      expect(rows.rowCount).toBe(0);
      await expect(tx.query('update sync_receipts set outcome=outcome')).rejects.toThrow();
    });
  });
  it('serializes competing operations against the same observed revision', async () => {
    const created = await note();
    const first = command(created.rev, 'First device');
    const second = command(created.rev, 'Second device');
    const results = await Promise.all([deliver(created.id, first), deliver(created.id, second)]);
    const outcomes = await Promise.all(results.map((response) => response.json()));
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['applied', 'conflict']);
    const winner = outcomes.findIndex((outcome) => outcome.status === 'applied');
    expect((await repo().notes.byId(created.id))?.fields).toMatchObject({
      translation: winner === 0 ? 'First device' : 'Second device',
    });
    for (const [index, input] of [first, second].entries())
      expect(await (await deliver(created.id, input)).json()).toEqual(outcomes[index]);
  });
  it('adds compatible cloze slots without replacing answered Cards and protects reset history', async () => {
    const deck = await repo().decks.create({ name: 'Cloze consistency' });
    const response = await testServer(database!, ownerId, db).request('/api/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deckId: deck.id, noteType: 'cloze', fields: { text: '{{c1::One}}' } }),
    });
    const created = (await response.json()).note as { id: string; rev: number };
    const initial = (await repo().cards.forNote(created.id))[0]!;
    await repo().reviews.record({ cardId: initial.id, rating: 4, now: new Date() });
    const answered = (await repo().cards.forNote(created.id))[0]!;
    const history = await repo().reviews.forCard(initial.id);
    const result = await deliver(created.id, {
      ...command(created.rev),
      fields: { text: '{{c1::First}} {{c2::Second}}', note: 'Additional context' },
    });
    expect(await result.json()).toMatchObject({ status: 'applied' });
    const after = await repo().cards.forNote(created.id);
    expect(after).toHaveLength(2);
    expect(after.find((card) => card.id === initial.id)).toEqual(answered);
    expect(await repo().reviews.forCard(initial.id)).toEqual(history);
    await repo().cards.reset(initial.id, new Date());
    const immutable = await asUser(
      pool!,
      ownerId,
      async (tx) => (await tx.query('select * from reviews where card_id=$1', [initial.id])).rows,
    );
    const reset = await repo().cards.forNote(created.id);
    const current = await repo().notes.byId(created.id);
    expect(
      await (
        await deliver(created.id, {
          ...command(current!.rev),
          fields: { text: 'First {{c2::Second}}' },
        })
      ).json(),
    ).toMatchObject({ status: 'unsupported', reason: 'cards_would_be_lost' });
    expect(await repo().cards.forNote(created.id)).toEqual(reset);
    expect(
      await asUser(
        pool!,
        ownerId,
        async (tx) => (await tx.query('select * from reviews where card_id=$1', [initial.id])).rows,
      ),
    ).toEqual(immutable);
  });
  it('rejects malformed content and excluded transitions atomically', async () => {
    const created = await note();
    const input = command(created.rev);
    const before = await repo().notes.byId(created.id);
    const head = await repo().sync.revision();
    expect((await deliver(created.id, { ...input, fields: { term: 'Incomplete' } })).status).toBe(
      400,
    );
    const response = await testServer(database!, ownerId, db).request(
      `/api/notes/${created.id}/offline-edit`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, discardCards: true, noteType: 'basic', deckId: uuidV7() }),
      },
    );
    expect(response.status).toBe(400);
    expect(await repo().notes.byId(created.id)).toEqual(before);
    expect(await repo().sync.revision()).toBe(head);
    expect((await deliver(created.id, { ...input, accountId: otherId })).status).toBe(409);
  });
  it('rejects a Note in deleted ancestry and remembers the conflict after restoration', async () => {
    const created = await note();
    const current = await repo().notes.byId(created.id);
    await repo().decks.softDelete(current!.deckId);
    const input = command(created.rev);
    const outcome = await (await deliver(created.id, input)).json();
    expect(outcome).toMatchObject({ status: 'conflict', reason: 'deleted_remotely' });
    await repo().decks.restore(current!.deckId);
    expect(await (await deliver(created.id, input)).json()).toEqual(outcome);
  });
});

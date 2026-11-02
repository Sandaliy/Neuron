import { beforeAll, describe, expect, it } from 'vitest';

import { RATING } from '@neuron/core';
import { IMPORT_CHUNK_SIZE, normaliseTerm, openingCards, uuidV7 } from '@neuron/shared';
import type { DailyStudySession, NoteFields, NoteTypeName, ImportBatch } from '@neuron/shared';

import {
  countingRepositories,
  createUser,
  rawOwnerPool,
  repositoriesFor,
  testDatabase,
} from '../db/testing/database.js';
import { json, testServer } from '../testing/server.js';

import type { Repositories } from '../db/repositories/index.js';
import type { Hono } from 'hono';

/**
 * Importing a word list, and taking one back.
 *
 * The three things that decide whether a real five thousand row import works:
 * a chunk that arrives twice does not double anything, the duplicate check
 * does not become one query per row, and the undo removes exactly the batch.
 */

const database = testDatabase();
const OWNER = 'import-owner';

/** A note as the importer sends it: a client id, because that is the idempotency. */
function note(term: string) {
  return {
    id: uuidV7(),
    noteType: 'vocab' as const,
    fields: { term, translation: `${term} translated` },
  };
}

describe.skipIf(!database)('importing', () => {
  let repositories: Repositories;
  let server: Hono;
  let deckId: string;

  beforeAll(async () => {
    if (!database) {
      return;
    }

    await createUser(database, OWNER);

    repositories = repositoriesFor(database, OWNER);
    server = testServer(database, OWNER);
    deckId = (await repositories.decks.create({ name: 'Importing' })).id;
  });

  async function startBatch(source: string, id = uuidV7()) {
    return json<{ import: ImportBatch }>(
      await server.request('/api/imports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, deckId, source, format: 'json' }),
      }),
      201,
    );
  }

  async function sendChunk(batchId: string, notes: readonly ReturnType<typeof note>[]) {
    return json<{ notes: number; cards: number; skipped: number }>(
      await server.request(`/api/imports/${batchId}/notes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ notes }),
      }),
      200,
    );
  }

  it('creates the batch before any note arrives, so an undo always exists', async () => {
    if (!database) {
      return;
    }

    const started = await startBatch('Empty first');

    expect(started.import.noteCount).toBe(0);
  });

  it('answers with the same batch when the opening request is sent twice', async () => {
    if (!database) {
      return;
    }

    const id = uuidV7();
    const first = await startBatch('Sent twice', id);
    const second = await startBatch('Sent twice', id);

    expect(second.import.id).toBe(first.import.id);
    expect((await repositories.importBatches.list()).filter((row) => row.id === id)).toHaveLength(
      1,
    );
  });

  it('writes nothing the second time a chunk arrives', async () => {
    if (!database) {
      return;
    }

    const started = await startBatch('Chunk twice');
    const chunk = [note('Wiederholung'), note('Verbindung')];

    const first = await sendChunk(started.import.id, chunk);
    const second = await sendChunk(started.import.id, chunk);

    expect(first).toEqual({ notes: 2, cards: 2, skipped: 0 });
    expect(second).toEqual({ notes: 0, cards: 0, skipped: 2 });

    const summary = await json<{ notes: number; cards: number }>(
      await server.request(`/api/imports/${started.import.id}`),
      200,
    );

    expect(summary.notes).toBe(2);
    expect(summary.cards).toBe(2);
  });

  it('keeps the running count as chunks land', async () => {
    if (!database) {
      return;
    }

    const started = await startBatch('Counting');

    await sendChunk(started.import.id, [note('Eins'), note('Zwei')]);
    await sendChunk(started.import.id, [note('Drei')]);

    const batch = await repositories.importBatches.byId(started.import.id);

    expect(batch?.noteCount).toBe(3);
  });

  it('counts live Notes without Cards independently of Card and reviewed-Card totals', async () => {
    const batch = await startBatch('Sparse legacy Cards');
    const empty = await repositories.notes.create({
      deckId,
      importBatchId: batch.import.id,
      noteType: 'vocab',
      fields: { term: 'No Card yet', translation: 'Still a Note' },
    });
    const row = note('With a Card');
    await sendChunk(batch.import.id, [row]);
    expect(await repositories.importBatches.contents(batch.import.id)).toEqual({
      notes: 2,
      cards: 1,
      reviewedCards: 0,
    });
    const card = (await repositories.cards.forNote(row.id))[0]!;
    await repositories.reviews.record({ cardId: card.id, rating: RATING.good, now: new Date() });
    expect(await repositories.importBatches.contents(batch.import.id)).toEqual({
      notes: 2,
      cards: 1,
      reviewedCards: 1,
    });
    await repositories.notes.softDelete(empty.id);
    expect(await repositories.importBatches.contents(batch.import.id)).toEqual({
      notes: 1,
      cards: 1,
      reviewedCards: 1,
    });
  });

  it('refuses further chunks after another tab has undone the batch', async () => {
    const started = await startBatch('Already undone');
    await sendChunk(started.import.id, [note('Before Undo')]);
    await json(
      await server.request(`/api/imports/${started.import.id}/undo`, { method: 'POST' }),
      200,
    );
    const response = await server.request(`/api/imports/${started.import.id}/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ notes: [note('After Undo')] }),
    });
    expect(response.status).toBe(409);
    expect((await repositories.importBatches.contents(started.import.id)).notes).toBe(0);
  });

  it('refuses IDs from a different batch instead of acknowledging missing additions', async () => {
    const first = await startBatch('ID owner');
    const second = await startBatch('ID collision');
    const row = note('Same ID');
    await sendChunk(first.import.id, [row]);
    const response = await server.request(`/api/imports/${second.import.id}/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ notes: [row] }),
    });
    expect(response.status).toBe(409);
    expect((await repositories.importBatches.contents(second.import.id)).notes).toBe(0);
  });

  it('retains exact mixed Note/Card identities, ranks and Review history across concurrent retries, merge and Undo', async () => {
    if (!database) return;
    const ladder = [
      { direction: 'recognition' as const, opensAtStability: 0 },
      { direction: 'recall' as const, opensAtStability: 0 },
      { direction: 'listening' as const, opensAtStability: 0 },
    ];
    const folder = await repositories.decks.create({
      name: 'Inherited Import settings',
      kind: 'folder',
      settings: { ladder },
    });
    const target = await repositories.decks.create({ name: 'Mixed import', parentId: folder.id });
    const batchId = uuidV7();
    await json(
      await server.request('/api/imports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: batchId,
          deckId: target.id,
          source: 'Mixed source',
          format: 'json',
        }),
      }),
      201,
    );
    const rows: {
      id: string;
      noteType: NoteTypeName;
      fields: NoteFields;
      rank: number;
      tags: string[];
    }[] = [];
    for (let index = 0; index < 500; index++) {
      for (const [noteType, fields] of [
        [
          'vocab',
          { term: `Mixed ${index}`, translation: `Meaning ${index}`, grammar: { article: 'das' } },
        ],
        ['basic', { front: `Question ${index}`, back: `Answer ${index}` }],
        ['cloze', { text: `Row ${index}: {{c1::one}} {{c3::three}} {{c7::seven}} {{c1::again}}` }],
      ] as [NoteTypeName, NoteFields][])
        rows.push({ id: uuidV7(), noteType, fields, rank: rows.length + 1, tags: ['mixed'] });
    }
    const send = (notes: typeof rows) =>
      server.request(`/api/imports/${batchId}/notes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ notes }),
      });
    const first = rows.slice(0, 500);
    const since = (await repositories.importBatches.byId(batchId))!.rev;
    const concurrent = await Promise.all([send(first), send(first)]);
    const replies = await Promise.all(
      concurrent.map((reply) => json<{ notes: number }>(reply, 200)),
    );
    expect(replies.map((reply) => reply.notes).sort((a, b) => a - b)).toEqual([0, 500]);
    const pulled: { entity: string; id: string; rev: number; row: { noteCount?: number } }[] = [];
    let cursor = since;
    for (;;) {
      const pull = await json<{ revision: number; hasMore: boolean; changes: typeof pulled }>(
        await server.request(`/api/sync?since=${cursor}&limit=1`),
        200,
      );
      expect(pull.changes.length).toBeLessThanOrEqual(201);
      if (pull.changes.length)
        expect(new Set(pull.changes.map((change) => change.rev)).size).toBe(1);
      else expect(pull.hasMore).toBe(false);
      pulled.push(...pull.changes);
      if (!pull.hasMore) break;
      expect(pull.revision).toBeGreaterThan(cursor);
      cursor = pull.revision;
    }
    expect(
      pulled
        .filter((change) => change.entity === 'notes')
        .map((change) => change.id)
        .sort(),
    ).toEqual(first.map((note) => note.id).sort());
    expect(pulled.filter((change) => change.entity === 'cards')).toHaveLength(
      first.reduce(
        (count, note) => count + openingCards(note.noteType, note.fields, ladder).length,
        0,
      ),
    );
    expect(pulled.find((change) => change.entity === 'importBatches')?.row.noteCount).toBe(500);
    for (let at = 500; at < rows.length; at += 500)
      await json(await send(rows.slice(at, at + 500)), 200);
    const pool = rawOwnerPool(database);
    try {
      const stored = await pool.query(
        'select id, fields, rank, tags, source, deck_id, import_batch_id, rev from notes where import_batch_id=$1 order by rank',
        [batchId],
      );
      expect(stored.rows.map((row) => row.id)).toEqual(rows.map((row) => row.id));
      for (const [index, row] of stored.rows.entries())
        expect(row).toMatchObject({
          fields: rows[index]!.fields,
          rank: index + 1,
          tags: ['mixed'],
          source: 'Mixed source',
          deck_id: target.id,
          import_batch_id: batchId,
        });
      const cards = (
        await pool.query(
          'select c.* from cards c join notes n on n.id=c.note_id where n.import_batch_id=$1 order by c.id',
          [batchId],
        )
      ).rows;
      expect(cards).toHaveLength(4000);
      const session = await json<DailyStudySession>(
        await server.request('/api/study/session', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ deckId: target.id }),
        }),
        200,
      );
      expect(session.waves.find((wave) => wave.deckId === target.id)).toMatchObject({
        number: 1,
        count: 30,
        size: 50,
        later: 1450,
      });
      const firstWave = new Set(rows.slice(0, 50).map((note) => note.id));
      expect(session.newCount).toBeGreaterThan(0);
      expect(
        session.cards
          .filter((card) => card.state === 'new')
          .every((card) => firstWave.has(card.noteId)),
      ).toBe(true);
      const byNote = new Map<string, typeof cards>();
      for (const card of cards)
        byNote.set(card.note_id, [...(byNote.get(card.note_id) ?? []), card]);
      for (const row of rows) {
        const expected = openingCards(row.noteType, row.fields, ladder)
          .map(({ direction, slot }) => `${direction}:${slot}`)
          .sort();
        expect(
          byNote
            .get(row.id)!
            .map((card) => `${card.direction}:${card.slot}`)
            .sort(),
        ).toEqual(expected);
        expect(
          byNote
            .get(row.id)!
            .every(
              (card) =>
                card.deck_id === target.id &&
                Number(card.rev) > Number(stored.rows.find((note) => note.id === row.id)!.rev),
            ),
        ).toBe(true);
      }
      const cardId = byNote.get(rows[0]!.id)![0]!.id as string;
      await repositories.reviews.record({ cardId, rating: RATING.good, now: new Date() });
      const reviewsBefore = (
        await pool.query('select * from reviews where card_id=$1 order by id', [cardId])
      ).rows;
      const cardsBefore = (
        await pool.query('select * from cards where note_id=$1 order by id', [rows[0]!.id])
      ).rows;
      await json(await send(first.map((row) => ({ ...row, id: row.id.toUpperCase() }))), 200);
      await json(
        await server.request(`/api/notes/${rows[0]!.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            merge: true,
            noteType: 'vocab',
            fields: {
              term: 'Mixed 0',
              translation: 'Never overwrite',
              note: 'Added',
              grammar: { article: 'der', plural: 'Added plural' },
            },
          }),
        }),
        200,
      );
      expect((await repositories.notes.byId(rows[0]!.id))?.fields).toMatchObject({
        term: 'Mixed 0',
        translation: 'Meaning 0',
        note: 'Added',
        grammar: { article: 'das', plural: 'Added plural' },
      });
      expect(
        (await pool.query('select * from cards where note_id=$1 order by id', [rows[0]!.id])).rows,
      ).toEqual(cardsBefore);
      expect((await repositories.importBatches.byId(batchId))?.noteCount).toBe(1500);
      expect(await repositories.importBatches.contents(batchId)).toMatchObject({
        notes: 1500,
        cards: 4000,
        reviewedCards: 1,
      });
      await json(await server.request(`/api/imports/${batchId}/undo`, { method: 'POST' }), 200);
      expect(
        (await pool.query('select * from reviews where card_id=$1 order by id', [cardId])).rows,
      ).toEqual(reviewsBefore);
      expect(
        (
          await pool.query(
            'select count(*) from cards c join notes n on n.id=c.note_id where n.import_batch_id=$1 and c.deleted_at is null',
            [batchId],
          )
        ).rows[0]!.count,
      ).toBe('0');
    } finally {
      await pool.end();
    }
  }, 180_000);

  it('rejects malformed chunks atomically, unavailable destinations and changed batch metadata', async () => {
    const batch = await startBatch('Validation boundary');
    const request = (body: unknown, path = `/api/imports/${batch.import.id}/notes`) =>
      server.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const good = note('Valid first row');
    expect(
      (
        await request({
          notes: [good, { ...note('Bad last row'), fields: { term: 'Missing meaning' } }],
        })
      ).status,
    ).toBe(400);
    expect((await repositories.importBatches.contents(batch.import.id)).notes).toBe(0);
    expect((await request({ notes: [good, good] })).status).toBe(409);
    expect(
      (
        await request(
          { id: batch.import.id, deckId, source: 'Changed metadata', format: 'json' },
          '/api/imports',
        )
      ).status,
    ).toBe(409);
    const missing = await repositories.decks.create({ name: 'Deleted import target' });
    const deletedBatch = await repositories.importBatches.create({
      deckId: missing.id,
      source: 'Unavailable',
    });
    await repositories.decks.softDelete(missing.id);
    expect((await request({ notes: [good] }, `/api/imports/${deletedBatch.id}/notes`)).status).toBe(
      409,
    );
    expect((await repositories.importBatches.contents(deletedBatch.id)).notes).toBe(0);
  });

  it('isolates batch ownership and rolls back a chunk containing a foreign Note ID', async () => {
    if (!database) return;
    const ownerBatch = await startBatch('Private IDs');
    const privateRow = note('Private row');
    await sendChunk(ownerBatch.import.id, [privateRow]);
    const otherId = `${OWNER}-foreign`;
    await createUser(database, otherId);
    const other = repositoriesFor(database, otherId);
    const otherServer = testServer(database, otherId);
    const target = await other.decks.create({ name: 'Other import' });
    const otherBatch = await other.importBatches.create({ deckId: target.id, source: 'Other' });
    const send = (id: string, rows: unknown[]) =>
      otherServer.request(`/api/imports/${id}/notes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ notes: rows }),
      });
    expect((await send(ownerBatch.import.id, [note('Cannot cross accounts')])).status).toBe(404);
    expect((await send(otherBatch.id, [note('Must roll back'), privateRow])).status).toBe(409);
    expect((await other.importBatches.contents(otherBatch.id)).notes).toBe(0);
    expect((await repositories.importBatches.contents(ownerBatch.import.id)).notes).toBe(1);
  });

  it('finds a word only when it is live in the destination deck', async () => {
    if (!database) {
      return;
    }

    const elsewhere = await repositories.decks.create({ name: 'Another deck' });

    await repositories.notes.create({
      deckId: elsewhere.id,
      noteType: 'vocab',
      fields: { term: 'Der  Schlüssel ', translation: 'key' },
    });

    const deletedDeck = await repositories.decks.create({ name: 'Deleted deck' });
    await repositories.notes.create({
      deckId: deletedDeck.id,
      noteType: 'vocab',
      fields: { term: 'Gelöschtes Wort', translation: 'deleted deck' },
    });
    await repositories.decks.softDelete(deletedDeck.id);

    const body = await json<{ matches: { term: string; deckId: string; written: string }[] }>(
      await server.request('/api/notes/duplicates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          deckId,
          terms: ['der schlüssel', 'gelöschtes wort', 'Nichts davon'],
        }),
      }),
      200,
    );

    expect(body.matches).toHaveLength(0);

    await repositories.notes.create({
      deckId,
      noteType: 'vocab',
      fields: { term: 'Der  Schlüssel ', translation: 'key here' },
    });
    const deletedNote = await repositories.notes.create({
      deckId,
      noteType: 'vocab',
      fields: { term: 'Gelöschte Notiz', translation: 'deleted note' },
    });
    await repositories.notes.softDelete(deletedNote.id);

    const destination = await json<{
      matches: { term: string; deckId: string; written: string }[];
    }>(
      await server.request('/api/notes/duplicates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          deckId,
          terms: ['der schlüssel', 'gelöschtes wort', 'gelöschte notiz'],
        }),
      }),
      200,
    );
    expect(destination.matches).toHaveLength(1);
    expect(destination.matches[0]?.term).toBe(normaliseTerm('Der  Schlüssel '));
    expect(destination.matches[0]?.deckId).toBe(deckId);
    expect(destination.matches[0]?.written).toBe('Der  Schlüssel');
  });

  it('does not treat two different words as the same one', async () => {
    if (!database) {
      return;
    }

    await repositories.notes.create({
      deckId,
      noteType: 'vocab',
      fields: { term: 'schön', translation: 'beautiful' },
    });

    const body = await json<{ matches: unknown[] }>(
      await server.request('/api/notes/duplicates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deckId, terms: ['schon'] }),
      }),
      200,
    );

    expect(body.matches).toHaveLength(0);
  });

  it('commits live destination decisions while ignoring other and deleted matches', async () => {
    if (!database) {
      return;
    }

    const elsewhere = await repositories.decks.create({ name: 'Commit elsewhere' });
    await repositories.notes.create({
      deckId: elsewhere.id,
      noteType: 'vocab',
      fields: { term: 'Other deck commit', translation: 'elsewhere' },
    });
    const deletedDeck = await repositories.decks.create({ name: 'Commit deleted deck' });
    await repositories.notes.create({
      deckId: deletedDeck.id,
      noteType: 'vocab',
      fields: { term: 'Deleted deck commit', translation: 'deleted deck' },
    });
    await repositories.decks.softDelete(deletedDeck.id);
    const deletedNote = await repositories.notes.create({
      deckId,
      noteType: 'vocab',
      fields: { term: 'Deleted note commit', translation: 'deleted note' },
    });
    await repositories.notes.softDelete(deletedNote.id);
    const destination = await repositories.notes.create({
      deckId,
      noteType: 'vocab',
      fields: { term: 'Destination commit', translation: 'keep this' },
    });

    const lookup = await json<{
      matches: { term: string; noteId: string; deckId: string }[];
    }>(
      await server.request('/api/notes/duplicates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          deckId,
          terms: [
            'Other deck commit',
            'Deleted deck commit',
            'Deleted note commit',
            'Destination commit',
          ],
        }),
      }),
      200,
    );

    expect(lookup.matches).toHaveLength(1);
    expect(lookup.matches[0]).toMatchObject({
      term: normaliseTerm('Destination commit'),
      noteId: destination.id,
      deckId,
    });

    const batch = await startBatch('Destination decisions');
    const created = [
      note('Other deck commit'),
      note('Deleted deck commit'),
      note('Deleted note commit'),
      note('Ordinary unique commit'),
    ];
    expect(await sendChunk(batch.import.id, created)).toEqual({
      notes: created.length,
      cards: created.length,
      skipped: 0,
    });
    expect(await sendChunk(batch.import.id, created)).toEqual({
      notes: 0,
      cards: 0,
      skipped: created.length,
    });

    await json(
      await server.request(`/api/notes/${destination.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          merge: true,
          noteType: 'vocab',
          fields: { term: 'Destination commit', translation: 'do not overwrite', note: 'added' },
        }),
      }),
      200,
    );
    expect((await repositories.notes.byId(destination.id))?.fields).toMatchObject({
      term: 'Destination commit',
      translation: 'keep this',
      note: 'added',
    });
    expect(
      await json<{ notes: number; cards: number; reviewedCards: number }>(
        await server.request(`/api/imports/${batch.import.id}`),
        200,
      ),
    ).toMatchObject({ notes: created.length, cards: created.length, reviewedCards: 0 });
  });
});

describe.skipIf(!database)('taking an import back', () => {
  let repositories: Repositories;
  let server: Hono;
  let deckId: string;

  beforeAll(async () => {
    if (!database) {
      return;
    }

    await createUser(database, `${OWNER}-undo`);

    repositories = repositoriesFor(database, `${OWNER}-undo`);
    server = testServer(database, `${OWNER}-undo`);
    deckId = (await repositories.decks.create({ name: 'Undoing' })).id;
  });

  it('removes exactly the batch, its cards, and nothing else', async () => {
    if (!database) {
      return;
    }

    const keeper = await repositories.notes.create({
      deckId,
      noteType: 'vocab',
      fields: { term: 'Bleibt', translation: 'stays' },
    });

    const batchId = uuidV7();

    await json(
      await server.request('/api/imports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: batchId,
          deckId,
          source: 'Undo me',
          notes: [note('Verschwindet'), note('Auch weg')],
        }),
      }),
      201,
    );

    const imported = (await repositories.notes.list({ source: 'Undo me' })).items;

    expect(imported).toHaveLength(2);

    const body = await json<{ undone: number }>(
      await server.request(`/api/imports/${batchId}/undo`, { method: 'POST' }),
      200,
    );

    expect(body.undone).toBe(2);
    expect((await repositories.notes.list({ source: 'Undo me' })).items).toHaveLength(0);
    expect(await repositories.notes.byId(keeper.id)).toBeDefined();

    // The cards go with their notes rather than at the next cleanup. A card
    // whose note is gone is a question with no answer, and it would keep coming
    // up due.
    for (const row of imported) {
      expect(await repositories.cards.forNote(row.id)).toHaveLength(0);
    }
  });

  it('says how much of the import has been answered before it is taken back', async () => {
    if (!database) {
      return;
    }

    const batchId = uuidV7();

    await json(
      await server.request('/api/imports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: batchId,
          deckId,
          source: 'Answered',
          notes: [note('Geantwortet'), note('Unberührt')],
        }),
      }),
      201,
    );

    const [first] = (await repositories.notes.list({ source: 'Answered' })).items;
    const [card] = await repositories.cards.forNote(first?.id ?? '');

    await repositories.reviews.record({
      cardId: card?.id ?? '',
      rating: RATING.good,
      now: new Date(),
    });

    const summary = await json<{ notes: number; cards: number; reviewedCards: number }>(
      await server.request(`/api/imports/${batchId}`),
      200,
    );

    expect(summary.notes).toBe(2);
    expect(summary.cards).toBe(2);
    expect(summary.reviewedCards).toBe(1);
  });
});

describe.skipIf(!database)('five thousand rows', () => {
  const SIZE = 5000;

  let repositories: Repositories;
  let server: Hono;
  let deckId: string;

  beforeAll(async () => {
    if (!database) {
      return;
    }

    await createUser(database, `${OWNER}-large`);

    repositories = repositoriesFor(database, `${OWNER}-large`);
    server = testServer(database, `${OWNER}-large`);
    deckId = (await repositories.decks.create({ name: 'Five thousand' })).id;
  });

  it('arrives in chunks and lands whole', async () => {
    if (!database) {
      return;
    }

    const words = Array.from({ length: SIZE }, (_, index) => note(`Wort${index}`));
    const batchId = uuidV7();

    await json(
      await server.request('/api/imports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: batchId, deckId, source: 'Frequency list' }),
      }),
      201,
    );

    const started = Date.now();

    for (let index = 0; index < words.length; index += IMPORT_CHUNK_SIZE) {
      await json(
        await server.request(`/api/imports/${batchId}/notes`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ notes: words.slice(index, index + IMPORT_CHUNK_SIZE) }),
        }),
        200,
      );
    }

    const seconds = Math.round((Date.now() - started) / 100) / 10;
    const summary = await json<{ notes: number; cards: number }>(
      await server.request(`/api/imports/${batchId}`),
      200,
    );

    console.log(`five thousand rows in ${SIZE / IMPORT_CHUNK_SIZE} chunks: ${seconds}s`);

    expect(summary.notes).toBe(SIZE);
    expect(summary.cards).toBe(SIZE);
  }, 600_000);

  it('checks five thousand words for duplicates in a bounded number of queries', async () => {
    if (!database) {
      return;
    }

    const counted = countingRepositories(database, `${OWNER}-large`);
    const terms = Array.from({ length: SIZE }, (_, index) => normaliseTerm(`Wort${index}`));

    counted.reset();

    let found = 0;

    // The client sends the words a chunk at a time, the same way it sends the
    // notes. What is being proved is that each chunk is one statement rather
    // than one per row.
    for (let index = 0; index < terms.length; index += 1000) {
      found += (
        await counted.repositories.notes.duplicatesOf(deckId, terms.slice(index, index + 1000))
      ).length;
    }

    const queries = counted.count();

    console.log(`duplicate check over ${SIZE} words: ${queries} queries, ${found} found`);

    expect(found).toBe(SIZE);
    // Five queries plus whatever the connection does to set itself up. The
    // number that matters is that it does not grow with the number of words.
    expect(queries).toBeLessThan(30);
  }, 300_000);

  it('resumes a five thousand row import after a committed chunk response is lost', async () => {
    if (!database) {
      return;
    }

    const words = Array.from({ length: SIZE }, (_, index) => note(`Interrupted${index}`));
    const batchId = uuidV7();

    await json(
      await server.request('/api/imports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: batchId, deckId, source: 'Interrupted frequency list' }),
      }),
      201,
    );

    const firstChunk = words.slice(0, IMPORT_CHUNK_SIZE);
    const sendLargeChunk = async (chunk: readonly ReturnType<typeof note>[]) =>
      json<{ notes: number; cards: number; skipped: number }>(
        await server.request(`/api/imports/${batchId}/notes`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ notes: chunk }),
        }),
        200,
      );

    await sendLargeChunk(firstChunk);

    // Model the transport failure after the server committed the chunk: the
    // client retries the same request with the same generated row IDs.
    await sendLargeChunk(firstChunk);

    for (let index = IMPORT_CHUNK_SIZE; index < words.length; index += IMPORT_CHUNK_SIZE) {
      await sendLargeChunk(words.slice(index, index + IMPORT_CHUNK_SIZE));
    }

    const summary = await json<{
      notes: number;
      cards: number;
      reviewedCards: number;
      import: { id: string };
    }>(await server.request(`/api/imports/${batchId}`), 200);
    const batches = await repositories.importBatches.list();
    const pool = rawOwnerPool(database);

    try {
      const counts = await pool.query(
        `select
           (select count(*) from notes where import_batch_id = $1 and deleted_at is null) as notes,
           (select count(*) from cards c join notes n on n.id = c.note_id
             where n.import_batch_id = $1 and c.deleted_at is null) as cards`,
        [batchId],
      );

      expect(summary).toMatchObject({ notes: SIZE, cards: SIZE, reviewedCards: 0 });
      expect(summary.import.id).toBe(batchId);
      expect(batches.filter((batch) => batch.id === batchId)).toHaveLength(1);
      expect(Number(counts.rows[0]?.notes)).toBe(SIZE);
      expect(Number(counts.rows[0]?.cards)).toBe(SIZE);
      expect(await repositories.decks.byId(deckId)).toBeDefined();
      expect(await repositories.cards.due({ deckId, now: new Date(), limit: 1 })).toHaveLength(1);
      expect((await repositories.importBatches.contents(batchId)).reviewedCards).toBe(0);
    } finally {
      await pool.end();
    }
  }, 600_000);
});

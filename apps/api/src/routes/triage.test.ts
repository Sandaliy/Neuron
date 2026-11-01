import { beforeAll, describe, expect, it } from 'vitest';

import {
  IMPORT_CHUNK_SIZE,
  TRIAGE_BATCH_LIMIT,
  triageListSchema,
  triageResultSchema,
  uuidV7,
} from '@neuron/shared';
import type { Note, TriageChoice, TriageList, TriageResult } from '@neuron/shared';

import { createUser, repositoriesFor, testDatabase } from '../db/testing/database.js';
import { json, testServer } from '../testing/server.js';

import type { Repositories } from '../db/repositories/index.js';
import type { Hono } from 'hono';

/**
 * Triage against the real database.
 *
 * What has to hold: a decision changes a Note's status and mark and nothing
 * else, Study admission follows the status exactly as before, a Note with
 * learning history is never classified, and a sweep over five thousand Notes
 * stays a handful of requests.
 */

const database = testDatabase();
const OWNER = 'triage-owner';
const STRANGER = 'triage-stranger';

const post = (server: Hono, path: string, body: unknown) =>
  server.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

async function list(server: Hono, deckId: string): Promise<TriageList> {
  return triageListSchema.parse(
    await json(await server.request(`/api/notes/triage?deckId=${deckId}`), 200),
  );
}

async function decide(
  server: Hono,
  decisions: { id: string; choice: TriageChoice }[],
): Promise<TriageResult> {
  return triageResultSchema.parse(
    await json(await post(server, '/api/notes/triage', { decisions }), 200),
  );
}

/** Everything about a Card the scheduler owns, plus its revision. Triage must leave all of it. */
async function cardState(repositories: Repositories) {
  const changes = (await repositories.sync.pull(0, 100_000)).changes;
  return {
    cards: changes
      .filter((change) => change.entity === 'cards')
      .map(({ id, rev, row }) => ({
        id,
        rev,
        state: row['state'],
        due: String(row['due']),
        stability: row['stability'],
        difficulty: row['difficulty'],
        reps: row['reps'],
        lapses: row['lapses'],
        suspendedAt: row['suspendedAt'],
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    reviews: changes.filter((change) => change.entity === 'reviews').length,
  };
}

describe.skipIf(!database)('triage', () => {
  let repositories: Repositories;
  let server: Hono;
  let stranger: Hono;
  let folderId: string;
  let wordsId: string;
  let otherId: string;
  const ids: Record<string, string> = {};

  async function note(deckId: string, name: string, body: Record<string, unknown>) {
    const written = await json<{ note: Note }>(
      await post(server, '/api/notes', { deckId, source: 'Triage list', ...body }),
      201,
    );
    ids[name] = written.note.id;
    return written.note;
  }

  beforeAll(async () => {
    if (!database) return;
    await createUser(database, OWNER);
    await createUser(database, STRANGER);
    repositories = repositoriesFor(database, OWNER);
    server = testServer(database, OWNER);
    stranger = testServer(database, STRANGER);

    folderId = (await repositories.decks.create({ name: 'Lists', kind: 'folder' })).id;
    wordsId = (await repositories.decks.create({ name: 'Words', parentId: folderId })).id;
    otherId = (await repositories.decks.create({ name: 'Facts', parentId: folderId })).id;

    // Source order is creation order. Ranks deliberately disagree with it.
    await note(wordsId, 'see', {
      noteType: 'vocab',
      fields: { term: 'See', translation: 'lake', grammar: { article: 'der' }, reading: 'zeː' },
      rank: 900,
    });
    await note(wordsId, 'haus', {
      noteType: 'vocab',
      fields: { term: 'Haus', translation: 'house' },
      rank: 120,
    });
    await note(wordsId, 'studied', {
      noteType: 'vocab',
      fields: { term: 'Baum', translation: 'tree' },
      rank: 300,
    });
    await note(wordsId, 'aside', {
      noteType: 'vocab',
      fields: { term: 'Zaun', translation: 'fence' },
    });
    await note(wordsId, 'draft', {
      noteType: 'vocab',
      fields: { term: 'Tür', translation: 'door' },
      status: 'draft',
    });
    await note(wordsId, 'gone', {
      noteType: 'vocab',
      fields: { term: 'Dach', translation: 'roof' },
    });
    await note(otherId, 'basic', {
      noteType: 'basic',
      fields: { front: 'Capital of Peru', back: 'Lima' },
    });
    await note(otherId, 'cloze', {
      noteType: 'cloze',
      fields: { text: 'Water boils at {{100}} degrees and freezes at {{c2::0::cold}}.' },
    });

    const [card] = await repositories.cards.forNote(ids['studied']!);
    await json(
      await post(server, '/api/reviews', {
        id: uuidV7(),
        cardId: card!.id,
        rating: 'good',
        reviewedAt: new Date().toISOString(),
        durationMs: 3000,
      }),
      200,
    );
    await json(
      await post(server, '/api/notes/status', { ids: [ids['aside']], status: 'suspended' }),
      200,
    );
    await json(await server.request(`/api/notes/${ids['gone']}`, { method: 'DELETE' }), 200);
  });

  it('lists Notes without learning history under a Folder, in source order, with their faces', async () => {
    const triage = await list(server, folderId);

    expect(triage.items.map((item) => item.id)).toEqual([
      ids['see'],
      ids['haus'],
      ids['basic'],
      ids['cloze'],
    ]);
    expect(triage.studied).toBe(1);
    // Set aside and Draft are the learner's own choices, not material to sort.
    expect(triage.setAside).toBe(2);
    expect(triage.items[0]).toMatchObject({
      deckId: wordsId,
      noteType: 'vocab',
      rank: 900,
      choice: 'unsorted',
      term: 'der See',
      detail: 'zeː',
      meaning: 'lake',
    });
    expect(triage.items[2]).toMatchObject({ term: 'Capital of Peru', meaning: 'Lima' });
    expect(triage.items[3]).toMatchObject({
      term: 'Water boils at […] degrees and freezes at [cold].',
      meaning: 'Water boils at 100 degrees and freezes at 0.',
    });
    expect((await list(server, wordsId)).items.map((item) => item.id)).toEqual([
      ids['see'],
      ids['haus'],
    ]);
  });

  it('records Known as the status and Unsure or New beside it, without touching a Card or a Review', async () => {
    const before = await cardState(repositories);
    const { currentRev } = await repositories.account.read();

    const result = await decide(server, [
      { id: ids['see']!, choice: 'known' },
      { id: ids['haus']!, choice: 'unsure' },
      { id: ids['basic']!, choice: 'new' },
    ]);

    expect(result.skipped).toEqual([]);
    expect(result.applied).toHaveLength(3);
    const notes = new Map(
      (await repositories.notes.byIds([ids['see']!, ids['haus']!, ids['basic']!])).map((row) => [
        row.id,
        row,
      ]),
    );
    expect(notes.get(ids['see']!)).toMatchObject({ status: 'known', triage: null });
    expect(notes.get(ids['haus']!)).toMatchObject({ status: 'active', triage: 'unsure' });
    expect(notes.get(ids['basic']!)).toMatchObject({ status: 'active', triage: 'new' });
    // One batch is one revision, so another device receives it as one change.
    expect(new Set([...notes.values()].map((row) => row.rev))).toEqual(new Set([currentRev + 1]));
    expect(await cardState(repositories)).toEqual(before);

    expect((await list(server, folderId)).items.map((item) => item.choice)).toEqual([
      'known',
      'unsure',
      'new',
      'unsorted',
    ]);
  });

  it('leaves Study admission as it was: a Known Note sits out, Unsure and New stay in', async () => {
    const cards = await repositories.cards.forSession({ deckIds: [wordsId, otherId] });
    const notesInStudy = new Set(cards.map((card) => card.noteId));

    expect(notesInStudy.has(ids['see']!)).toBe(false);
    expect(notesInStudy.has(ids['haus']!)).toBe(true);
    expect(notesInStudy.has(ids['basic']!)).toBe(true);
    expect(notesInStudy.has(ids['cloze']!)).toBe(true);
    // Unrelated to triage, and unchanged by it.
    expect(notesInStudy.has(ids['studied']!)).toBe(true);
    expect(notesInStudy.has(ids['aside']!)).toBe(false);

    // The same through the Daily Study planner the learner meets.
    const available = async () =>
      (
        await json<{ availableCount: number }>(
          await post(server, '/api/study/session', { deckId: folderId }),
          200,
        )
      ).availableCount;
    const before = await available();
    const clozeCards = (await repositories.cards.forNote(ids['cloze']!)).length;
    expect(clozeCards).toBe(2);
    await decide(server, [{ id: ids['cloze']!, choice: 'known' }]);
    expect(await available()).toBe(before - clozeCards);
    await decide(server, [{ id: ids['cloze']!, choice: 'unsure' }]);
    expect(await available()).toBe(before);
    await decide(server, [{ id: ids['cloze']!, choice: 'unsorted' }]);
  });

  it('returns a Note to unsorted, from Known as well', async () => {
    await decide(server, [
      { id: ids['see']!, choice: 'unsorted' },
      { id: ids['haus']!, choice: 'unsorted' },
    ]);
    const [see, haus] = await repositories.notes.byIds([ids['see']!, ids['haus']!]);

    for (const row of [see, haus]) expect(row).toMatchObject({ status: 'active', triage: null });
    const inStudy = (await repositories.cards.forSession({ deckIds: [wordsId] })).map(
      (card) => card.noteId,
    );
    expect(inStudy).toContain(ids['see']);
  });

  it('writes nothing when the same decisions arrive again', async () => {
    const decisions = [
      { id: ids['see']!, choice: 'known' as const },
      { id: ids['cloze']!, choice: 'new' as const },
    ];
    await decide(server, decisions);
    const { currentRev } = await repositories.account.read();
    const again = await decide(server, decisions);

    expect(again.applied).toEqual(decisions);
    expect((await repositories.account.read()).currentRev).toBe(currentRev);
  });

  it('carries the mark to other devices through the revision stream', async () => {
    await decide(server, [{ id: ids['haus']!, choice: 'unsure' }]);
    const row = (await repositories.sync.pull(0, 100_000)).changes.find(
      (change) => change.entity === 'notes' && change.id === ids['haus'],
    );

    expect(row?.row).toMatchObject({ status: 'active', triage: 'unsure' });
  });

  it('never classifies a Note that has learning history, is set aside, or is gone', async () => {
    const before = await cardState(repositories);
    const result = await decide(server, [
      { id: ids['studied']!, choice: 'known' },
      { id: ids['aside']!, choice: 'new' },
      { id: ids['draft']!, choice: 'known' },
      { id: ids['gone']!, choice: 'known' },
      { id: uuidV7(), choice: 'known' },
    ]);

    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual([
      { id: ids['studied'], reason: 'studied' },
      { id: ids['aside'], reason: 'set_aside' },
      { id: ids['draft'], reason: 'set_aside' },
      { id: ids['gone'], reason: 'missing' },
      { id: expect.any(String), reason: 'missing' },
    ]);
    const rows = await repositories.notes.byIds([ids['studied']!, ids['aside']!, ids['draft']!]);
    expect(Object.fromEntries(rows.map((row) => [row.id, row.status]))).toEqual({
      [ids['studied']!]: 'active',
      [ids['aside']!]: 'suspended',
      [ids['draft']!]: 'draft',
    });
    expect(await cardState(repositories)).toEqual(before);
  });

  it('treats a Note whose learning was restarted as unstudied again', async () => {
    await json(
      await post(server, `/api/notes/${ids['studied']}/study-again`, { id: uuidV7() }),
      200,
    );
    const result = await decide(server, [{ id: ids['studied']!, choice: 'unsure' }]);

    expect(result.applied).toEqual([{ id: ids['studied'], choice: 'unsure' }]);
    // The answer given before the restart is still in the log.
    expect((await cardState(repositories)).reviews).toBeGreaterThan(0);
  });

  it('neither shows nor changes another account’s Notes', async () => {
    await json(await stranger.request(`/api/notes/triage?deckId=${folderId}`), 404);
    const result = triageResultSchema.parse(
      await json(
        await post(stranger, '/api/notes/triage', {
          decisions: [{ id: ids['cloze'], choice: 'known' }],
        }),
        200,
      ),
    );

    expect(result.skipped).toEqual([{ id: ids['cloze'], reason: 'missing' }]);
    const [cloze] = await repositories.notes.byIds([ids['cloze']!]);
    expect(cloze).toMatchObject({ status: 'active', triage: 'new' });
  });

  it('refuses a malformed batch before it reaches the database', async () => {
    const id = ids['see']!;
    const tooMany = Array.from({ length: TRIAGE_BATCH_LIMIT + 1 }, () => ({
      id: uuidV7(),
      choice: 'known',
    }));

    for (const decisions of [
      [],
      tooMany,
      [{ id, choice: 'forgotten' }],
      [
        { id, choice: 'known' },
        { id, choice: 'new' },
      ],
    ])
      await json(await post(server, '/api/notes/triage', { decisions }), 400);
    await json(await server.request('/api/notes/triage?deckId=lists'), 400);
    await json(await server.request(`/api/notes/triage?deckId=${uuidV7()}`), 404);
  });
});

describe.skipIf(!database)('triage over five thousand Notes', () => {
  const SIZE = 5000;
  let repositories: Repositories;
  let server: Hono;
  let deckId: string;

  beforeAll(async () => {
    if (!database) return;
    await createUser(database, `${OWNER}-large`);
    repositories = repositoriesFor(database, `${OWNER}-large`);
    server = testServer(database, `${OWNER}-large`);
    deckId = (await repositories.decks.create({ name: 'Frequency list' })).id;

    const batchId = uuidV7();
    await json(
      await post(server, '/api/imports', { id: batchId, deckId, source: 'Oxford 5000' }),
      201,
    );
    const words = Array.from({ length: SIZE }, (_, index) => ({
      id: uuidV7(),
      noteType: 'vocab' as const,
      rank: SIZE - index,
      fields: { term: `word${index}`, translation: `meaning ${index}` },
    }));
    for (let index = 0; index < SIZE; index += IMPORT_CHUNK_SIZE)
      await json(
        await post(server, `/api/imports/${batchId}/notes`, {
          notes: words.slice(index, index + IMPORT_CHUNK_SIZE),
        }),
        200,
      );
  }, 600_000);

  it('lists, decides and lists again in a few requests, without one Card write', async () => {
    const before = await cardState(repositories);

    let started = performance.now();
    const first = await list(server, deckId);
    const coldMs = performance.now() - started;
    expect(first.items).toHaveLength(SIZE);
    const bytes = JSON.stringify(first).length;
    started = performance.now();
    await list(server, deckId);
    const listMs = performance.now() - started;

    const choices: TriageChoice[] = ['known', 'unsure', 'new', 'known'];
    const decisions = first.items.map((item, index) => ({
      id: item.id,
      choice: choices[index % choices.length]!,
    }));
    started = performance.now();
    for (let index = 0; index < SIZE; index += TRIAGE_BATCH_LIMIT) {
      const result = await decide(server, decisions.slice(index, index + TRIAGE_BATCH_LIMIT));
      expect(result.skipped).toEqual([]);
    }
    const decideMs = performance.now() - started;

    started = performance.now();
    const second = await list(server, deckId);
    const relistMs = performance.now() - started;

    console.log(
      `triage over ${SIZE} Notes: first list ${Math.round(coldMs)} ms, list ${Math.round(listMs)} ms` +
        ` (${Math.round(bytes / 1024)} KiB),` +
        ` ${SIZE / TRIAGE_BATCH_LIMIT} decision batches ${Math.round(decideMs)} ms,` +
        ` list again ${Math.round(relistMs)} ms`,
    );
    expect(second.items.map((item) => item.choice)).toEqual(decisions.map((entry) => entry.choice));
    expect(await cardState(repositories)).toEqual(before);

    const inStudy = new Set(
      (await repositories.cards.forSession({ deckIds: [deckId] })).map((card) => card.noteId),
    );
    expect(inStudy.size).toBe(SIZE / 2);
  }, 600_000);
});

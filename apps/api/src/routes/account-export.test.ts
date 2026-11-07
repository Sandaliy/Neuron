import { getTableColumns, getTableName } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RATING } from '@neuron/core';
import { ExportValidator, uuidV7 } from '@neuron/shared';

import { harnessFor, registerFresh } from '../auth/testing/harness.js';
import { mountCollection } from '../create-app.js';
import { EXPORT_TABLES, exportVersion, ExportLimit } from '../db/repositories/account-export.js';
import { AUTH_TABLES, schema } from '../db/schema/index.js';
import {
  asUser,
  appClient,
  createUser,
  rawAppPool,
  rawOwnerPool,
  repositoriesFor,
  testDatabase,
} from '../db/testing/database.js';
import { createPermissiveRateLimiter } from '../rate-limit.js';
import { signedOutServer, testServer } from '../testing/server.js';

import type { Auth } from '../auth.js';
import type { AuthDatabase } from '../db/client.js';
import type { Repositories } from '../db/repositories/index.js';

const database = testDatabase();
const OWNER = 'account-export-owner';
const OTHER = 'account-export-other';
type Data = Record<string, unknown>;
type Line = { type: string; entity?: string; data?: Data; [key: string]: unknown };

describe('export allowlists', () => {
  it('requires a coverage decision for every learning column and table', () => {
    const excluded = ['userId', 'termKey'];
    for (const definition of EXPORT_TABLES) {
      const table = Object.values(schema).find(
        (table) => getTableName(table) === definition.table,
      )!;
      const keys = Object.keys(getTableColumns(table));
      if (definition.entity === 'preferences') continue; // Authentication columns are deliberately unreachable.
      expect(keys.filter((key) => !excluded.includes(key)).sort()).toEqual(
        [...definition.columns].sort(),
      );
    }
    const excludedTables: readonly string[] = [...AUTH_TABLES, 'rate_limits', 'sync_receipts'];
    expect(
      Object.values(schema)
        .map(getTableName)
        .filter((name) => !excludedTables.includes(name))
        .sort(),
    ).toEqual(
      EXPORT_TABLES.filter((table) => table.entity !== 'preferences')
        .map((table) => table.table)
        .sort(),
    );
  });
  it('keeps supported fields and false values without exporting injected row keys', () => {
    expect(
      exportVersion('notes', {
        userId: OTHER,
        fields: {
          term: 'Wort',
          translation: 'word',
          token: 'private',
          grammar: { separable: false, secret: 'private' },
        },
        password: 'private',
      }),
    ).toEqual({ fields: { term: 'Wort', translation: 'word', grammar: { separable: false } } });
    expect(
      exportVersion('notes', {
        purgedAt: '2026-01-01',
        fields: { term: 'redacted' },
        tags: ['redacted'],
      }),
    ).toMatchObject({ fields: {}, tags: [], source: null, rank: null });
  });
});

describe.skipIf(!database)('private synchronized account export on PostgreSQL', () => {
  const db = database!;
  let repo: Repositories;
  const owner = database ? rawOwnerPool(database) : undefined;
  const app = database ? rawAppPool(database) : undefined;
  beforeAll(async () => {
    await createUser(db, OWNER);
    await createUser(db, OTHER);
    repo = repositoriesFor(db, OWNER);
  });
  afterAll(async () => {
    await owner?.end();
    await app?.end();
  });
  async function archive(account = OWNER) {
    const response = await testServer(db, account).request('/api/account/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: account }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('vercel-cdn-cache-control')).toBe('no-store');
    const text = await response.text();
    const validator = new ExportValidator(account);
    const lines = text.trimEnd().split('\n');
    for (const line of lines) validator.line(`${line}\n`);
    validator.finish();
    return { text, validator, lines: lines.map((line) => JSON.parse(line) as Line) };
  }
  const rows = (lines: Line[], entity: string) =>
    lines.filter((line) => line.entity === entity).map((line) => line.data!);

  it('exports an empty account with schema context and synchronized preferences', async () => {
    const { lines, validator } = await archive(OTHER);
    expect(validator.records).toBe(4);
    expect(rows(lines, 'preferences')).toEqual([
      expect.objectContaining({
        id: OTHER,
        timezone: 'Europe/Moscow',
        currentRev: 0,
        settings: {},
      }),
    ]);
    expect(
      rows(lines, 'noteTypes')
        .map((row) => row['name'])
        .sort(),
    ).toEqual(['basic', 'cloze', 'vocab']);
    expect(rows(lines, 'reviews')).toEqual([]);
  });

  it('matches stored collection, history, deleted/purged data, Practice versions, imports and preferences', async () => {
    const folder = await repo.decks.create({
      name: 'Languages',
      kind: 'folder',
      settings: { targetLanguage: 'de' },
    });
    const deck = await repo.decks.create({
      name: 'German',
      parentId: folder.id,
      settings: { targetLanguage: 'de' },
    });
    const batch = await repo.importBatches.create({
      deckId: deck.id,
      source: 'lexicon.tsv',
      format: 'tsv',
      noteCount: 3,
    });
    const vocab = await repo.notes.create({
      deckId: deck.id,
      noteType: 'vocab',
      importBatchId: batch.id,
      fields: {
        term: 'gehen',
        translation: 'to go',
        acceptedAnswers: ['laufen'],
        grammar: { separable: false, irregular: 'ging / gegangen', pattern: 'zu + Dativ' },
      },
      tags: ['verbs'],
      source: 'lexicon',
      rank: 7,
    });
    const basic = await repo.notes.create({
      deckId: deck.id,
      noteType: 'basic',
      fields: { front: 'Q', back: 'A' },
    });
    const cloze = await repo.notes.create({
      deckId: deck.id,
      noteType: 'cloze',
      fields: { text: '{{c1::one}} and {{c3::three}}', note: 'context' },
    });
    const card = await repo.cards.create({
      noteId: vocab.id,
      direction: 'recognition',
      due: new Date('2026-01-01'),
    });
    for (const direction of ['recall', 'production', 'listening'] as const)
      await repo.cards.create({ noteId: vocab.id, direction, due: new Date('2026-01-01') });
    for (const slot of [1, 3])
      await repo.cards.create({
        noteId: cloze.id,
        direction: 'cloze',
        slot,
        due: new Date('2026-01-01'),
      });
    const answer = await repo.reviews.record({
      id: uuidV7(),
      cardId: card.id,
      rating: RATING.good,
      now: new Date('2026-10-01T10:00:00Z'),
      durationMs: 1234,
    });
    const cancellationId = uuidV7();
    await repo.reviews.undo(answer.review.id, cancellationId);
    const restartId = uuidV7();
    await repo.reviews.restartDeck(deck.id, restartId);
    await repo.triage.decide([
      { id: vocab.id, choice: 'unsure' },
      { id: cloze.id, choice: 'new' },
    ]);
    await repo.presets.create({
      deckId: deck.id,
      name: 'Recall',
      config: { directions: ['recall'], audio: false },
      isDefault: true,
    });
    await repo.account.updatePreferences({
      timezone: 'Europe/Minsk',
      dayCutoffHour: 5,
      locale: 'ru',
      settings: { targetLanguage: 'de' },
    });
    const start = await repo.practice.apply(deck.id, {
      kind: 'start',
      id: uuidV7(),
      runId: uuidV7(),
      expectedVersion: 0,
      front: 'front',
      back: 'back',
    });
    await repo.practice.apply(deck.id, {
      kind: 'replace',
      id: uuidV7(),
      expectedVersion: start.version,
      runId: start.run!.id,
      run: { ...start.run!, round: 2 },
    });
    // A normal losing edit, then a permanently purged Note with deliberately stale conflict content.
    await repo.sync.push(
      [
        {
          entity: 'notes',
          id: vocab.id,
          updatedAt: new Date('2020-01-01'),
          deleted: false,
          data: {
            deckId: deck.id,
            noteType: 'vocab',
            fields: { term: 'old', translation: 'earlier' },
          },
        },
      ],
      new Date(),
    );
    await repo.notes.softDelete(basic.id);
    await repo.purge.remove('notes', basic.id);
    await owner!.query(
      `insert into sync_conflicts (id,user_id,entity,entity_id,reason,losing,kept) values ($1,$2,'notes',$3,'older_update',$4,$4)`,
      [uuidV7(), OWNER, basic.id, JSON.stringify({ fields: { front: 'purged-secret' } })],
    );
    await repo.notes.softDelete(cloze.id);
    const before = await repo.sync.revision();
    const unchangedTables = [
      ...EXPORT_TABLES.filter((entry) => !['preferences', 'noteTypes'].includes(entry.entity)).map(
        (entry) => entry.table,
      ),
      'sync_receipts',
    ];
    const digestSql = unchangedTables
      .map(
        (table) =>
          `select '${table}' as name, md5(coalesce(string_agg(to_jsonb(t)::text, '' order by to_jsonb(t)::text), '')) as digest from "${table}" t where user_id=$1`,
      )
      .join(' union all ');
    const digests = (await owner!.query(digestSql, [OWNER])).rows;
    const preferences = await repo.account.read();
    const raw = await owner!.query('select * from reviews where user_id=$1 order by id', [OWNER]);
    const { lines, text } = await archive();
    expect((await owner!.query(digestSql, [OWNER])).rows).toEqual(digests);
    expect(await repo.account.read()).toEqual(preferences);
    expect(await repo.sync.revision()).toBe(before);
    expect(
      (await owner!.query('select * from reviews where user_id=$1 order by id', [OWNER])).rows,
    ).toEqual(raw.rows);
    const exportedNotes = rows(lines, 'notes');
    expect(exportedNotes.find((row) => row['id'] === vocab.id)).toMatchObject({
      fields: vocab.fields,
      tags: ['verbs'],
      rank: 7,
      importBatchId: batch.id,
      triage: 'unsure',
    });
    expect(exportedNotes.find((row) => row['id'] === basic.id)).toMatchObject({
      fields: {},
      purgedAt: expect.any(String),
    });
    expect(exportedNotes.find((row) => row['id'] === cloze.id)).toMatchObject({
      fields: cloze.fields,
      deletedAt: expect.any(String),
      triage: 'new',
    });
    const exportedReviews = rows(lines, 'reviews');
    expect(exportedReviews).toHaveLength(raw.rowCount!);
    expect(exportedReviews.find((row) => row['id'] === answer.review.id)).toMatchObject({
      durationMs: 1234,
      priorState: expect.objectContaining({ state: 'new' }),
      submittedAt: expect.any(String),
    });
    expect(exportedReviews.find((row) => row['id'] === cancellationId)).toMatchObject({
      cancelsReviewId: answer.review.id,
    });
    expect(exportedReviews.filter((row) => row['restartId'] === restartId)).toHaveLength(6);
    expect(rows(lines, 'practiceRuns')[0]).toMatchObject({ version: 2, run: { round: 2 } });
    expect(rows(lines, 'conflicts').find((row) => row['entity'] === 'practiceRuns')).toMatchObject({
      losing: { version: 1, run: { round: 1 } },
    });
    expect(rows(lines, 'importBatches')[0]).toMatchObject({ source: 'lexicon.tsv', noteCount: 3 });
    expect(rows(lines, 'studyPresets')[0]).toMatchObject({
      config: { directions: ['recall'], audio: false },
    });
    expect(rows(lines, 'preferences')[0]).toMatchObject({
      timezone: 'Europe/Minsk',
      dayCutoffHour: 5,
      locale: 'ru',
    });
    expect(text).not.toContain('purged-secret');
    expect(text).not.toContain('"userId"');
    expect(text).not.toContain('"fingerprint"');
    // Every current relationship resolves, including soft-deleted and purged tombstones.
    const ids = (entity: string) => new Set(rows(lines, entity).map((row) => row['id']));
    for (const note of exportedNotes) {
      expect(ids('decks').has(note['deckId'])).toBe(true);
      expect(ids('noteTypes').has(note['noteTypeId'])).toBe(true);
    }
    for (const card of rows(lines, 'cards')) {
      expect(ids('notes').has(card['noteId'])).toBe(true);
      expect(ids('decks').has(card['deckId'])).toBe(true);
    }
    for (const review of exportedReviews) {
      expect(ids('cards').has(review['cardId'])).toBe(true);
      if (review['cancelsReviewId'])
        expect(ids('reviews').has(review['cancelsReviewId'])).toBe(true);
    }
    expect(
      rows(lines, 'cards')
        .filter((row) => row['direction'] === 'cloze')
        .map((row) => row['slot'])
        .sort(),
    ).toEqual([1, 3]);
  });

  it('refuses expired sessions, altered account IDs and fabricated pagination', async () => {
    const send = (body: unknown) => ({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const expired = await signedOutServer(db).request(
      '/api/account/export',
      send({ accountId: OWNER }),
    );
    expect(expired.status).toBe(401);
    expect(expired.headers.get('cache-control')).toContain('no-store');
    const server = testServer(db, OTHER);
    expect((await server.request('/api/account/export', send({ accountId: OWNER }))).status).toBe(
      401,
    );
    expect(
      (await server.request('/api/account/export', send({ accountId: OTHER, cursor: OWNER })))
        .status,
    ).toBe(400);
    const response = await server.request(
      `/api/account/export?userId=${OWNER}&cursor=${OWNER}`,
      send({ accountId: OTHER }),
    );
    expect(await response.text()).not.toContain('gehen');
    await asUser(app!, OTHER, async (connection) => {
      expect(
        (await connection.query('select id from notes where user_id=$1', [OWNER])).rows,
      ).toEqual([]);
      expect((await connection.query('select current_user')).rows[0]?.current_user).toBe(
        'neuron_app',
      );
    });
    await expect(
      asUser(app!, OWNER, (connection) => connection.query('select password from account')),
    ).rejects.toThrow();
  });

  it('exports the recorded opening Review and suspension history without altering either', async () => {
    const deck = await repo.decks.create({ name: 'Direction provenance' });
    const note = await repo.notes.create({
      deckId: deck.id,
      noteType: 'vocab',
      fields: { term: 'prüfen', translation: 'check' },
    });
    const opening = await repo.cards.create({
      noteId: note.id,
      direction: 'recognition',
      unlockReason: 'opening',
      due: new Date(),
    });
    const answer = await repo.reviews.record({
      cardId: opening.id,
      rating: RATING.good,
      now: new Date(),
    });
    const unlocked = await repo.cards.create({
      noteId: note.id,
      direction: 'recall',
      unlockReason: 'ladder',
      unlockedByReviewId: answer.review.id,
      due: new Date(),
    });
    await repo.cards.suspend(unlocked.id);
    await repo.cards.unsuspend(unlocked.id);
    const before = await repo.sync.revision();
    const { lines } = await archive();
    expect(rows(lines, 'cards').find((row) => row['id'] === opening.id)).toMatchObject({
      unlockReason: 'opening',
      unlockedByReviewId: null,
      wasSuspended: false,
    });
    expect(rows(lines, 'cards').find((row) => row['id'] === unlocked.id)).toMatchObject({
      unlockReason: 'ladder',
      unlockedByReviewId: answer.review.id,
      wasSuspended: true,
      suspendedAt: null,
    });
    expect(rows(lines, 'reviews').find((row) => row['id'] === answer.review.id)).toMatchObject({
      cardId: opening.id,
      cancelsReviewId: null,
    });
    expect(await repo.sync.revision()).toBe(before);
  });

  it('keeps one snapshot while a concurrent transaction renames a Deck and edits its Note', async () => {
    const deck = await repo.decks.create({ name: 'Before snapshot' });
    const note = await repo.notes.create({
      deckId: deck.id,
      noteType: 'basic',
      fields: { front: 'Before', back: 'A' },
    });
    const lines: Line[] = [];
    await repo.accountExport.write(async (line) => {
      const value = JSON.parse(line) as Line;
      lines.push(value);
      if (value.type === 'manifest')
        await repo.transaction(async (tx) => {
          await tx.decks.rename(deck.id, 'After snapshot');
          await tx.notes.updateFields(note.id, { front: 'After', back: 'B' });
        });
    }, new AbortController().signal);
    expect(rows(lines, 'decks').find((row) => row['id'] === deck.id)?.['name']).toBe(
      'Before snapshot',
    );
    expect(rows(lines, 'notes').find((row) => row['id'] === note.id)?.['fields']).toEqual({
      front: 'Before',
      back: 'A',
    });
    expect((await repo.notes.byId(note.id))?.fields).toEqual({ front: 'After', back: 'B' });
  });

  it('aborts delivery without completion or writes and can export again', async () => {
    const controller = new AbortController();
    const before = await repo.sync.revision();
    const seen: string[] = [];
    await expect(
      repo.accountExport.write(async (line) => {
        seen.push(line);
        controller.abort();
      }, controller.signal),
    ).rejects.toThrow('export_aborted');
    expect(seen.join('')).not.toContain('"type":"complete"');
    expect(await repo.sync.revision()).toBe(before);
    expect((await archive()).validator.complete).toBe(true);
  });

  it('closes a streamed response when the client aborts after the manifest', async () => {
    const controller = new AbortController();
    const before = await repo.sync.revision();
    const response = await testServer(db, OWNER).request('/api/account/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: OWNER }),
      signal: controller.signal,
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const first = await reader.read();
    expect(decoder.decode(first.value)).toContain('"type":"manifest"');
    controller.abort();
    let rest = '';
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        rest += decoder.decode(next.value, { stream: true });
      }
      expect(rest).not.toContain('"type":"complete"');
      expect(await repo.sync.revision()).toBe(before);
      expect((await archive()).validator.complete).toBe(true);
    } finally {
      await reader.cancel();
    }
  });

  it.skipIf(!database?.authUrl)(
    'rejects completion after the real session expires mid-stream',
    async () => {
      const harness = harnessFor(db);
      const registered = await registerFresh(harness, 'export-expiry');
      const origin = harness.env.APP_ORIGIN.canonical;
      const response = await harness.app.request(new URL('/api/account/export', origin), {
        method: 'POST',
        headers: { origin, cookie: registered.jar.header(), 'content-type': 'application/json' },
        body: JSON.stringify({ accountId: registered.userId }),
      });
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      try {
        const first = await reader.read();
        expect(decoder.decode(first.value)).toContain('"type":"manifest"');
        await owner!.query(
          'update "session" set expires_at = now() - interval \'1 minute\' where user_id = $1',
          [registered.userId],
        );
        let remainder = '';
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          remainder += decoder.decode(next.value, { stream: true });
        }
        expect(remainder).toContain('"type":"error"');
        expect(remainder).not.toContain('"type":"complete"');
      } finally {
        await reader.cancel();
      }
    },
  );

  it.each(['expired', 'changed'])(
    'does not complete after the authenticated session has %s',
    async (state) => {
      let calls = 0;
      const client = appClient(db);
      const auth = {
        api: {
          getSession: async () => {
            calls++;
            if (calls > 1 && state === 'expired') return null;
            return {
              user: {
                id: calls > 1 ? OTHER : OWNER,
                name: 'Synthetic learner',
                email: 'learner@neuron.test',
                emailVerified: true,
              },
              session: { passwordChangeRequired: false },
            };
          },
        },
      } as unknown as Auth;
      const server = mountCollection(
        new Hono(),
        {
          db: client,
          authDb: client as unknown as AuthDatabase,
          auth,
          limiter: createPermissiveRateLimiter(),
          requireVerifiedEmail: false,
        },
        'http://localhost:8787',
      );
      const response = await server.request('/api/account/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountId: OWNER }),
      });
      const text = await response.text();
      expect(text).toContain('"type":"manifest"');
      expect(text).toContain('"type":"error"');
      expect(text).not.toContain('"type":"complete"');
      expect(calls).toBe(2);
      await client.$client.end();
    },
  );

  it('bounds unexpectedly large individual records instead of completing a partial archive', async () => {
    const user = 'account-export-oversized';
    await createUser(db, user);
    const large = repositoriesFor(db, user);
    const deck = await large.decks.create({ name: 'Large record' });
    await large.notes.create({
      deckId: deck.id,
      noteType: 'basic',
      fields: { front: 'x'.repeat(4 * 1024 * 1024), back: 'A' },
    });
    const seen: string[] = [];
    await expect(
      large.accountExport.write(async (line) => {
        seen.push(line);
      }, new AbortController().signal),
    ).rejects.toBeInstanceOf(ExportLimit);
    expect(seen.join('')).not.toContain('"type":"complete"');
  });

  it('streams 5,000 Notes, 20,000 Cards and 100,000 Reviews with bounded server memory', async () => {
    const user = 'account-export-benchmark';
    await createUser(db, user);
    const large = repositoriesFor(db, user);
    const deck = await large.decks.create({ name: 'Large collection' });
    await owner!.query(
      `insert into notes (id,user_id,deck_id,note_type_id,fields,rev)
      select md5('export-note-'||g)::uuid,$1,$2,(select id from note_types where name='vocab' and is_system),
        jsonb_build_object('term','Wort '||g,'translation','Слово '||g,'example',repeat('Example sentence. ',12)),1
      from generate_series(1,5000) g`,
      [user, deck.id],
    );
    await owner!.query(
      `insert into cards (id,user_id,note_id,deck_id,direction,state,stability,difficulty,due,last_review,reps,rev)
      select md5('export-card-'||g)::uuid,$1,md5('export-note-'||((g-1)/4+1))::uuid,$2,
        (array['recognition','recall','production','listening'])[(g-1)%4+1],
        case when (g-1)%4=0 then 'review' else 'new' end,
        case when (g-1)%4=0 then 10 else null end,case when (g-1)%4=0 then 5 else null end,
        '2026-02-01'::timestamptz,case when (g-1)%4=0 then '2026-01-20'::timestamptz else null end,
        case when (g-1)%4=0 then 20 else 0 end,1 from generate_series(1,20000) g`,
      [user, deck.id],
    );
    await owner!.query(
      `insert into reviews (id,user_id,card_id,reviewed_at,rating,duration_ms,elapsed_days,scheduled_days,placed_due,state_before,stability_before,difficulty_before,rev)
      select md5('export-review-'||g)::uuid,$1,md5('export-card-'||(((g-1)%5000)*4+1))::uuid,
        '2026-01-01'::timestamptz+((g-1)/5000)*interval '1 day','good',1500,
        case when g<=5000 then 0 else 1 end,1,'2026-01-02'::timestamptz+((g-1)/5000)*interval '1 day',
        case when g<=5000 then 'new' else 'review' end,case when g<=5000 then null else 10 end,
        case when g<=5000 then null else 5 end,g from generate_series(1,100000) g`,
      [user],
    );
    await owner!.query('update "user" set current_rev=100001 where id=$1', [user]);
    const validator = new ExportValidator(user);
    let completion: Line | undefined;
    let peak = process.memoryUsage().rss;
    const baseline = peak;
    const started = performance.now();
    await large.accountExport.write(async (line) => {
      validator.line(line);
      if (validator.records % 512 === 0) peak = Math.max(peak, process.memoryUsage().rss);
      if (validator.complete) completion = JSON.parse(line) as Line;
    }, new AbortController().signal);
    validator.finish();
    const milliseconds = performance.now() - started;
    expect(completion?.['counts']).toMatchObject({ notes: 5000, cards: 20000, reviews: 100000 });
    expect(validator.records).toBe(125005);
    expect(peak - baseline).toBeLessThan(192 * 1024 * 1024);
    const actual = await owner!.query(
      'select count(*)::int as count from reviews where user_id=$1',
      [user],
    );
    expect(actual.rows[0]?.count).toBe(100000);
    console.info(
      JSON.stringify({
        exportBenchmark: {
          notes: 5000,
          cards: 20000,
          reviews: 100000,
          bytes: validator.bytes,
          milliseconds: Math.round(milliseconds),
          rssBaselineMiB: Math.round(baseline / 1048576),
          rssPeakMiB: Math.round(peak / 1048576),
          rssGrowthMiB: Math.round((peak - baseline) / 1048576),
        },
      }),
    );
  });
});

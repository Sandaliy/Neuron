import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSchedulerConfig, createSeededRandom, newCard, review } from '@neuron/core';
import type { SchedulingState } from '@neuron/core';
import { uuidV7 } from '@neuron/shared';

import { fromReviewLog, fromSchedulingState } from '../repositories/mapping.js';
import { systemNoteTypeId } from '../system-note-types.js';
import {
  createUser,
  rawAppPool,
  rawAuthPool,
  rawOwnerPool,
  repositoriesFor,
  testDatabase,
} from '../testing/database.js';

import { auditAccount, auditExitCode } from './audit.js';
import { structuralChecks } from './checks.js';

import type { AuditOptions } from './audit.js';
import type { Pool } from '@neondatabase/serverless';

const database = testDatabase();
const now = new Date('2026-11-01T12:00:00Z');
const secretContent = 'PRIVATE_NOTE_SENTINEL_DO_NOT_LOG';

describe.skipIf(!database)('Database Integrity Doctor on real PostgreSQL', () => {
  let owner: Pool;
  let app: Pool;
  beforeAll(() => {
    owner = rawOwnerPool(database!);
    app = rawAppPool(database!);
  });
  afterAll(async () => {
    await app?.end();
    await owner?.end();
  });

  async function fixture() {
    const userId = `doctor-${randomUUID()}`;
    await createUser(database!, userId);
    const repo = repositoriesFor(database!, userId);
    const folder = await repo.decks.create({ name: 'Folder', kind: 'folder' });
    const deck = await repo.decks.create({ name: 'Deck', parentId: folder.id });
    const note = await repo.notes.create({
      deckId: deck.id,
      noteType: 'vocab',
      fields: { term: secretContent, translation: 'meaning' },
    });
    const card = await repo.cards.create({ noteId: note.id, direction: 'recognition', due: now });
    return { userId, repo, folder, deck, note, card };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const run = (f: Fixture, options: Partial<AuditOptions> = {}) =>
    auditAccount(app, { userId: f.userId, ...options });
  const errors = (report: Awaited<ReturnType<typeof run>>) =>
    report.findings.filter((f) => f.severity === 'error');
  async function snapshot(userId: string) {
    const tables = [
      'decks',
      'notes',
      'cards',
      'reviews',
      'sync_receipts',
      'sync_conflicts',
      'practice_runs',
      'learning_restarts',
      'import_batches',
      'study_presets',
    ];
    return Promise.all(
      tables.map(
        async (table) =>
          (
            await owner.query(
              `select to_jsonb(x) as row from ${table} x where user_id=$1 order by to_jsonb(x)::text`,
              [userId],
            )
          ).rows,
      ),
    );
  }

  it('accepts a healthy multiple-account collection and emits no private values or identifiers by default', async () => {
    const a = await fixture();
    const b = await fixture();
    await owner.query('update cards set deck_id=$1 where id=$2', [a.deck.id, b.card.id]);
    const result = await run(a, { deep: true, pageSize: 1 });
    expect(result.status).toBe('complete');
    expect(result.findings).toEqual([]);
    expect(auditExitCode(result)).toBe(0);
    const printed = JSON.stringify(result);
    for (const value of [secretContent, a.userId, a.card.id, a.note.id, b.userId, b.card.id])
      expect(printed).not.toContain(value);
  });

  const corruptions: [string, (f: Fixture) => Promise<unknown>][] = [
    ['collection-path', (f) => owner.query("update decks set path='{}' where id=$1", [f.deck.id])],
    [
      'collection-cycle-depth',
      (f) => owner.query('update decks set parent_id=$1 where id=$1', [f.folder.id]),
    ],
    [
      'collection-live-parent',
      (f) => owner.query('update decks set deleted_at=now() where id=$1', [f.folder.id]),
    ],
    [
      'card-deck-copy',
      async (f) => {
        const other = await f.repo.decks.create({ name: 'Other' });
        await owner.query('update cards set deck_id=$1 where id=$2', [other.id, f.card.id]);
      },
    ],
    [
      'card-live-deleted-note',
      (f) => owner.query('update notes set deleted_at=now() where id=$1', [f.note.id]),
    ],
    ['card-slot', (f) => owner.query('update cards set slot=7 where id=$1', [f.card.id])],
    ['card-memory', (f) => owner.query('update cards set reps=2 where id=$1', [f.card.id])],
    [
      'cards-revision',
      (f) => owner.query('update cards set rev=9007199254740992 where id=$1', [f.card.id]),
    ],
    [
      'notes-revision',
      (f) => owner.query('update notes set rev=9007199254740992 where id=$1', [f.note.id]),
    ],
    [
      'collection-live-provenance',
      (f) => owner.query('update decks set deletion_id=$1 where id=$2', [randomUUID(), f.deck.id]),
    ],
    [
      'note-purge',
      (f) =>
        owner.query('update notes set deleted_at=now(),purged_at=now() where id=$1', [f.note.id]),
    ],
    [
      'collection-purge',
      (f) =>
        owner.query('update decks set deleted_at=now(),purged_at=now() where id=$1', [f.folder.id]),
    ],
  ];
  it.each(corruptions)(
    'detects %s without weakening database constraints',
    async (check, corrupt) => {
      const f = await fixture();
      await corrupt(f);
      const before = await snapshot(f.userId);
      const result = await run(f, { details: true });
      expect(result.status).toBe('complete');
      expect(result.findings.find((finding) => finding.check === check)?.count).toBe(
        check === 'collection-cycle-depth' ? 2 : 1,
      );
      expect(await snapshot(f.userId)).toEqual(before);
      expect(JSON.stringify(result)).not.toContain(secretContent);
    },
  );

  it('detects inaccessible ownership boundaries under RLS without disclosing another account', async () => {
    const a = await fixture();
    const b = await fixture();
    await owner.query('update notes set user_id=$1 where id=$2', [b.userId, a.note.id]);
    const result = await run(a, { details: true });
    expect(result.findings.find((f) => f.check === 'card-parent')?.samples).toEqual([a.card.id]);
    expect(JSON.stringify(result)).not.toContain(b.userId);
    expect(JSON.stringify(result)).not.toContain(b.card.id);
    expect(auditExitCode(result)).toBe(1);
  });

  it('recognizes database-enforced impossible fixtures instead of disabling triggers or constraints', async () => {
    const a = await fixture();
    const b = await fixture();
    await expect(
      owner.query('update notes set deck_id=$1 where id=$2', [b.deck.id, a.note.id]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      owner.query('update cards set lapses=2 where id=$1', [a.card.id]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      owner.query(
        `insert into cards (id,user_id,note_id,deck_id,direction,due) values ($1,$2,$3,$4,'recognition',now())`,
        [randomUUID(), a.userId, a.note.id, a.deck.id],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('detects inaccessible collection parents, Note parents, import provenance and Review ownership', async () => {
    const a = await fixture();
    const b = await fixture();
    await owner.query("update decks set user_id=$1,name='Foreign fixture parent' where id=$2", [
      b.userId,
      a.folder.id,
    ]);
    expect((await run(a)).findings.some((x) => x.check === 'collection-parent')).toBe(true);
    await owner.query('update notes set user_id=$1 where id=$2', [b.userId, a.note.id]);
    const batch = randomUUID();
    await owner.query(
      `insert into import_batches (id,user_id,deck_id,source) values ($1,$2,$3,'fixture')`,
      [batch, a.userId, a.deck.id],
    );
    await owner.query('update notes set import_batch_id=$1 where id=$2', [batch, a.note.id]);
    await badReview({ ...a, userId: b.userId }, {});
    const result = await run(b);
    for (const check of ['note-parent', 'note-import-owner', 'review-card-owner'])
      expect(result.findings.some((x) => x.check === check)).toBe(true);
  });

  it.each(['partial', 'infinity', 'nan'])(
    'detects %s Card memory that current SQL checks can technically store',
    async (kind) => {
      const f = await fixture();
      await owner.query(
        `update cards set state='review',stability=$1,difficulty=3,last_review=$2 where id=$3`,
        [kind === 'partial' ? null : kind === 'nan' ? 'NaN' : 'Infinity', now, f.card.id],
      );
      expect((await run(f)).findings.find((x) => x.check === 'card-memory')?.count).toBe(1);
    },
  );

  it('accepts a captured nonzero legacy origin and changed account settings without claiming missing history', async () => {
    const f = await fixture();
    const state = review(newCard(now), 3, now, createSchedulerConfig(), createSeededRandom(1)).next;
    await f.repo.cards.putState(f.card.id, state);
    await f.repo.reviews.record({
      cardId: f.card.id,
      rating: 3,
      now: new Date(now.getTime() + 86400000),
    });
    expect(errors(await run(f, { deep: true }))).toEqual([]);
    await owner.query('update "user" set settings=$1 where id=$2', [
      { targetRetention: 0.85 },
      f.userId,
    ]);
    const result = await run(f, { deep: true });
    expect(errors(result)).toEqual([]);
    expect(result.findings.some((x) => x.check === 'replay-origin-unproven')).toBe(false);
  });

  it('accepts deletion/restoration histories, independent retired Cards and live Notes beneath deleted Decks', async () => {
    const f = await fixture();
    const retired = await f.repo.cards.create({ noteId: f.note.id, direction: 'recall', due: now });
    await f.repo.cards.softDelete(retired.id);
    await f.repo.notes.softDelete(f.note.id);
    expect(errors(await run(f, { deep: true }))).toEqual([]);
    await f.repo.notes.restore(f.note.id);
    await f.repo.decks.softDelete(f.folder.id);
    expect(errors(await run(f, { deep: true }))).toEqual([]);
    await f.repo.decks.restore(f.folder.id);
    expect(errors(await run(f, { deep: true }))).toEqual([]);
    expect(
      (
        await owner.query('select deleted_at,deleted_with_note from cards where id=$1', [
          retired.id,
        ])
      ).rows[0]?.deleted_at,
    ).not.toBeNull();
  });

  it('accepts answer retries, concurrent Undo aliases, later answers, restart and legacy Card reset', async () => {
    const f = await fixture();
    const id = uuidV7();
    const input = { id, cardId: f.card.id, rating: 3 as const, now };
    await f.repo.reviews.record(input);
    await f.repo.reviews.record(input);
    await f.repo.reviews.record({
      cardId: f.card.id,
      rating: 4,
      now: new Date(now.getTime() + 86400000),
    });
    await Promise.all([f.repo.reviews.undo(id, uuidV7()), f.repo.reviews.undo(id, uuidV7())]);
    expect((await run(f, { deep: true })).findings).toEqual([]);
    const restart = uuidV7();
    await f.repo.reviews.restartDeck(f.deck.id, restart);
    await f.repo.reviews.restartDeck(f.deck.id, restart);
    expect(errors(await run(f, { deep: true }))).toEqual([]);
    await f.repo.cards.reset(f.card.id, new Date('2026-11-06T12:00:00Z'));
    expect((await run(f, { deep: true })).findings).toEqual([]);
  });

  it('keeps immutable attribution after permanent purge and detects unredacted conflicts', async () => {
    const f = await fixture();
    await f.repo.reviews.record({ cardId: f.card.id, rating: 3, now });
    await f.repo.notes.softDelete(f.note.id);
    await f.repo.purge.remove('notes', f.note.id);
    expect(errors(await run(f, { deep: true }))).toEqual([]);
    await owner.query(
      `insert into sync_conflicts (id,user_id,entity,entity_id,reason,losing) values ($1,$2,'notes',$3,'deleted_remotely',$4)`,
      [randomUUID(), f.userId, f.note.id, { term: secretContent }],
    );
    const result = await run(f, { details: true });
    expect(result.findings.some((x) => x.check === 'purged-conflict-content')).toBe(true);
    expect(JSON.stringify(result)).not.toContain(secretContent);
  });

  async function badReview(f: Fixture, extra: Record<string, unknown>) {
    const id = randomUUID();
    await owner.query(
      `insert into reviews (id,user_id,card_id,rating,reviewed_at,placed_due,state_before,elapsed_days,scheduled_days,
      cancels_review_id,resets_learning,restart_id,stability_before,difficulty_before)
      values ($1,$2,$3,'good',$4,$4,$5,0,0,$6,$7,$8,$9,$10)`,
      [
        id,
        f.userId,
        f.card.id,
        now,
        extra['state'] ?? 'new',
        extra['cancels'] ?? null,
        extra['reset'] ?? false,
        extra['restart'] ?? null,
        extra['stability'] ?? null,
        extra['difficulty'] ?? null,
      ],
    );
    return id;
  }
  it('detects missing cancellation and restart targets, and partial Review memory', async () => {
    const f = await fixture();
    await badReview(f, { cancels: randomUUID() });
    await badReview(f, { reset: true, restart: randomUUID() });
    await badReview(f, { state: 'review', difficulty: 3 });
    const result = await run(f);
    for (const check of ['review-cancellation', 'review-restart', 'review-memory'])
      expect(result.findings.find((x) => x.check === check)?.count).toBe(1);
  });
  it('detects a cancellation of another Card and a cancellation of a cancellation', async () => {
    const f = await fixture();
    const other = await f.repo.cards.create({ noteId: f.note.id, direction: 'recall', due: now });
    const original = await f.repo.reviews.record({ cardId: other.id, rating: 3, now });
    const cancellation = await badReview(f, { cancels: original.review.id });
    await badReview(f, { cancels: cancellation });
    expect((await run(f)).findings.find((x) => x.check === 'review-cancellation')?.count).toBe(2);
  });
  it('detects incomplete restart event counts without interpreting a moved Note as corruption', async () => {
    const f = await fixture();
    await f.repo.reviews.restartDeck(f.deck.id, uuidV7());
    const other = await f.repo.decks.create({ name: 'Moved' });
    await f.repo.notes.moveToDeck(f.note.id, other.id);
    expect(errors(await run(f))).toEqual([]);
    await owner.query(
      `insert into learning_restarts (id,user_id,deck_id,card_count,rev) select $1,$2,$3,1,current_rev from "user" where id=$2`,
      [randomUUID(), f.userId, f.deck.id],
    );
    expect((await run(f)).findings.find((x) => x.check === 'restart-count')?.count).toBe(1);
  });
  it('reports confirmed history counter drift and current-settings replay differences separately', async () => {
    const f = await fixture();
    await f.repo.reviews.record({ cardId: f.card.id, rating: 3, now });
    await owner.query('update cards set reps=reps+1 where id=$1', [f.card.id]);
    expect(
      (await run(f, { deep: true })).findings.find((x) => x.check === 'history-counters')?.severity,
    ).toBe('error');
    await owner.query('update cards set reps=reps-1,stability=stability+1 where id=$1', [
      f.card.id,
    ]);
    const result = await run(f, { deep: true });
    expect(errors(result)).toEqual([]);
    expect(result.findings.find((x) => x.check === 'replay-current-settings')?.severity).toBe(
      'warning',
    );
  });
  it('does not equate backlog placement with memory corruption', async () => {
    const f = await fixture();
    await f.repo.reviews.record({ cardId: f.card.id, rating: 3, now });
    await owner.query("update cards set due=due+interval '3 days' where id=$1", [f.card.id]);
    expect((await run(f, { deep: true })).findings).toEqual([]);
  });
  it('distinguishes explicit Cloze c0, legacy slot zero, retired identities and invalid Note shape', async () => {
    const f = await fixture();
    const note = await f.repo.notes.create({
      deckId: f.deck.id,
      noteType: 'cloze',
      fields: { text: '{{c0::answer}}' },
    });
    const card = await f.repo.cards.create({
      noteId: note.id,
      direction: 'cloze',
      slot: 0,
      due: now,
    });
    expect((await run(f, { deep: true })).findings).toEqual([]);
    await owner.query('update notes set fields=$1 where id=$2', [{ text: '{{answer}}' }, note.id]);
    expect(
      (await run(f, { deep: true })).findings.find((x) => x.check === 'legacy-cloze-slot')
        ?.severity,
    ).toBe('warning');
    await f.repo.cards.softDelete(card.id);
    expect((await run(f, { deep: true })).findings).toEqual([]);
    await owner.query('update notes set fields=$1 where id=$2', [
      { term: secretContent },
      f.note.id,
    ]);
    const result = await run(f, { deep: true });
    expect(result.findings.some((x) => x.check === 'note-fields')).toBe(true);
    expect(JSON.stringify(result)).not.toContain(secretContent);
  });
  it('validates immutable delivery results but permits older successful results after later edits', async () => {
    const f = await fixture();
    await owner.query(`insert into sync_receipts values ($1,$2,$3,now())`, [
      f.userId,
      secretContent,
      {
        clamped: false,
        noteCreate: {
          digest: 'a'.repeat(64),
          result: { operationId: randomUUID(), noteId: f.note.id, revision: 1, status: 'applied' },
        },
      },
    ]);
    expect((await run(f, { deep: true })).findings).toEqual([]);
    await owner.query(`insert into sync_receipts values ($1,$2,$3,now())`, [
      f.userId,
      secretContent + 'bad',
      { clamped: false, noteCreate: { digest: 'bad', result: { status: 'applied' } } },
    ]);
    const result = await run(f, { deep: true, details: true });
    expect(result.findings.find((x) => x.check === 'receipt-result')?.count).toBe(1);
    expect(JSON.stringify(result)).not.toContain(secretContent);
  });

  it('detects missing successful creation targets and invalid Undo aliases, allowing conflict-only receipts', async () => {
    const f = await fixture();
    await owner.query(
      `insert into sync_receipts values ($1,$2,$3,now()),($1,$4,$5,now()),($1,$6,$7,now())`,
      [
        f.userId,
        'a'.repeat(64),
        {
          clamped: false,
          noteCreate: {
            digest: 'a'.repeat(64),
            result: {
              operationId: randomUUID(),
              noteId: randomUUID(),
              status: 'applied',
              revision: 1,
            },
          },
        },
        'b'.repeat(64),
        {
          clamped: false,
          reviewUndo: { targetId: randomUUID(), cancellationId: randomUUID(), submittedAt: null },
        },
        'c'.repeat(64),
        {
          clamped: false,
          deckCreation: {
            digest: 'c'.repeat(64),
            result: {
              operationId: randomUUID(),
              entityId: randomUUID(),
              status: 'conflict',
              reason: 'parent_unavailable',
            },
          },
        },
      ],
    );
    const result = await run(f, { deep: true });
    expect(result.findings.find((x) => x.check === 'receipt-created-entity')?.count).toBe(1);
    expect(result.findings.find((x) => x.check === 'undo-receipt')?.count).toBe(1);
    expect(result.findings.some((x) => x.check === 'receipt-result')).toBe(false);
    const first = await run(f, { deep: true, details: true, maxItems: 1 });
    expect(first.coverage['receipts']?.after).toBe('a'.repeat(64));
    const next = await run(f, {
      deep: true,
      details: true,
      maxItems: 2,
      afterReceipt: first.coverage['receipts']!.after!,
    });
    expect(next.coverage['receipts']).toMatchObject({ scanned: 2, complete: true });
  });
  it('marks capped pages, oversized fields, oversized histories and missing targets incomplete', async () => {
    const f = await fixture();
    await f.repo.cards.create({ noteId: f.note.id, direction: 'recall', due: now });
    const first = await run(f, { deep: true, details: true, maxItems: 1, pageSize: 1 });
    expect(first.status).toBe('incomplete');
    expect(first.coverage['cards']?.after).toBeDefined();
    const next = await run(f, { deep: true, afterCard: first.coverage['cards']!.after! });
    expect(next.coverage['cards']?.scanned).toBe(1);
    await f.repo.reviews.record({ cardId: f.card.id, rating: 3, now });
    await f.repo.reviews.record({
      cardId: f.card.id,
      rating: 3,
      now: new Date(now.getTime() + 100000),
    });
    expect(
      (await run(f, { deep: true, maxEvents: 1 })).findings.some(
        (x) => x.check === 'replay-event-limit',
      ),
    ).toBe(true);
    await owner.query('update notes set fields=$1 where id=$2', [
      { term: 'x'.repeat(70000), translation: 'large' },
      f.note.id,
    ]);
    expect((await run(f, { deep: true })).status).toBe('incomplete');
    expect((await run(f, { deep: true, cardId: randomUUID() })).status).toBe('incomplete');
  });

  it('bounds pathological Cloze expansion and oversized receipt keys without exporting stored strings', async () => {
    const f = await fixture();
    const note = await f.repo.notes.create({
      deckId: f.deck.id,
      noteType: 'cloze',
      fields: { text: Array.from({ length: 65 }, (_, i) => `{{c${i}::gap}}`).join(' ') },
    });
    await f.repo.cards.create({ noteId: note.id, direction: 'cloze', slot: 1, due: now });
    await owner.query('insert into sync_receipts values($1,$2,$3,now())', [
      f.userId,
      secretContent.repeat(1000),
      { clamped: false },
    ]);
    const result = await run(f, { deep: true, details: true });
    expect(result.status).toBe('incomplete');
    for (const check of ['cloze-expansion-limit', 'receipt-key-size-limit'])
      expect(result.findings.find((x) => x.check === check)?.count).toBe(1);
    expect(JSON.stringify(result)).not.toContain(secretContent);
  });

  it('validates Practice snapshots without treating stale historical Note membership as corruption', async () => {
    const f = await fixture();
    const staleNote = randomUUID();
    const value = {
      id: randomUUID(),
      front: 'term',
      back: 'translation',
      queue: [staleNote],
      statuses: { [staleNote]: 'unseen' },
      round: 1,
    };
    await owner.query(
      `insert into practice_runs(id,user_id,deck_id,last_operation_id,run,version) values($1,$2,$3,$4,$5,1)`,
      [randomUUID(), f.userId, f.deck.id, randomUUID(), value],
    );
    expect((await run(f, { deep: true })).findings).toEqual([]);
    await owner.query(`update practice_runs set run=$1 where user_id=$2`, [
      { ...value, queue: [staleNote, staleNote] },
      f.userId,
    ]);
    const result = await run(f, { deep: true });
    expect(result.findings.find((x) => x.check === 'practice-shape')?.severity).toBe('warning');
  });
  it('requires a restricted role and a real account; failures disclose no driver messages', async () => {
    const f = await fixture();
    expect((await auditAccount(owner, { userId: f.userId })).status).toBe('failed');
    const auth = rawAuthPool(database!);
    try {
      expect((await auditAccount(auth, { userId: f.userId })).status).toBe('failed');
    } finally {
      await auth.end();
    }
    const result = await auditAccount(app, { userId: secretContent });
    expect(result.failure?.code).toBe('account-unavailable');
    expect(JSON.stringify(result)).not.toContain(secretContent);
  });
  it('handles interruption and bounded statement failure, then releases the connection for a fresh run', async () => {
    const f = await fixture();
    const probe = await app.connect();
    const pid = (await probe.query('select pg_backend_pid() as pid')).rows[0]?.pid as number;
    probe.release();
    const controller = new AbortController();
    controller.abort();
    const stopped = await run(f, { signal: controller.signal });
    expect(stopped.status).toBe('interrupted');
    expect(auditExitCode(stopped)).toBe(130);
    const limited = await run(f, { budgetMs: 1 });
    expect(limited.status).not.toBe('complete');
    expect(auditExitCode(limited)).toBe(2);
    expect((await run(f)).status).toBe('complete');
    expect(
      (
        await owner.query(
          `select count(*)::int as n from pg_stat_activity where pid=$1 and state='idle in transaction'`,
          [pid],
        )
      ).rows[0]?.n,
    ).toBe(0);
  });

  it('keeps Card/Note/Review consistency work bounded for a new large account with stale statistics', async () => {
    await fixture();
    await owner.query('analyze notes');
    await owner.query('analyze cards');
    await owner.query('analyze reviews');
    const statistics = await owner.connect();
    const reader = await app.connect();
    try {
      await statistics.query('begin');
      // Keep ANALYZE from replacing the deliberately older account statistics.
      // This mode permits the fixture's normal writes and the restricted reads.
      await statistics.query('lock table notes, cards, reviews in share update exclusive mode');
      const f = await fixture();
      const count = 3000;
      await owner.query(
        `insert into notes(id,user_id,deck_id,note_type_id,fields,rev)
        select md5($1||':cold:'||s)::uuid,$1,$2,$3,'{"term":"bulk","translation":"meaning"}',0
        from generate_series(1,$4) s`,
        [f.userId, f.deck.id, systemNoteTypeId('vocab'), count],
      );
      await owner.query(
        `insert into cards(id,user_id,note_id,deck_id,direction,due)
        select md5(n.id::text||d)::uuid,$1,n.id,$2,d,$3
        from notes n cross join unnest(array['recognition','recall']) d
        where n.user_id=$1 and n.id<>$4`,
        [f.userId, f.deck.id, now, f.note.id],
      );
      await owner.query(
        `insert into reviews(id,user_id,card_id,rating,reviewed_at,placed_due,state_before,elapsed_days,scheduled_days)
        select md5(c.id::text||':cold-review')::uuid,$1,c.id,'good',$2,$2,'new',0,0
        from cards c where c.user_id=$1`,
        [f.userId, now],
      );
      await reader.query('begin read only');
      await reader.query("select set_config('app.user_id',$1,true)", [f.userId]);
      await reader.query("set local statement_timeout='5000'");
      await reader.query("set local work_mem='4MB'");
      await reader.query("set local jit='off'");
      await reader.query('set local max_parallel_workers_per_gather=0');
      type Plan = {
        'Actual Rows': number;
        'Actual Loops': number;
        'Rows Removed by Filter'?: number;
        'Rows Removed by Join Filter'?: number;
        Plans?: Plan[];
      };
      const visits = (plan: Plan): number =>
        (plan['Actual Rows'] +
          (plan['Rows Removed by Filter'] ?? 0) +
          (plan['Rows Removed by Join Filter'] ?? 0)) *
          plan['Actual Loops'] +
        (plan.Plans ?? []).reduce((sum, child) => sum + visits(child), 0);
      for (const name of [
        'card-parent',
        'card-deck-copy',
        'card-live-deleted-note',
        'review-card-owner',
      ]) {
        const check = structuralChecks.find((entry) => entry.id === name)!;
        const query = `select count(*)::int as count from (${check.sql}) violations`;
        const explained = await reader.query(`explain (analyze,format json) ${query}`, [f.userId]);
        const work = visits(explained.rows[0]['QUERY PLAN'][0].Plan);
        // Measure examined tuples, rather than a runner-dependent elapsed-time budget.
        const size = (count * 2 + 1) * (name === 'review-card-owner' ? 2 : 1);
        expect(work, name).toBeLessThanOrEqual(size * 20);
        expect((await reader.query(query, [f.userId])).rows[0]?.count).toBe(0);
      }
    } finally {
      await reader.query('rollback');
      reader.release();
      await statistics.query('rollback');
      statistics.release();
    }
  });

  it('measures thousands of Notes, many Cards and substantial immutable histories with bounded results', async () => {
    const f = await fixture();
    const count = 3000;
    const perCard = 10;
    await owner.query(
      `insert into notes(id,user_id,deck_id,note_type_id,fields,rev)
      select md5($1||':n:'||s)::uuid,$1,$2,$3,'{"term":"bulk","translation":"meaning"}',0 from generate_series(1,$4) s`,
      [f.userId, f.deck.id, systemNoteTypeId('vocab'), count],
    );
    await owner.query(
      `insert into cards(id,user_id,note_id,deck_id,direction,due)
      select md5(n.id::text||d)::uuid,$1,n.id,$2,d,$3 from notes n cross join unnest(array['recognition','recall']) d where n.user_id=$1 and n.id<>$4`,
      [f.userId, f.deck.id, now, f.note.id],
    );
    const history = [];
    let state: SchedulingState = newCard(now);
    const config = createSchedulerConfig();
    for (let i = 0; i < perCard; i++) {
      const outcome = review(
        state,
        3,
        new Date(now.getTime() + i * 86400000),
        config,
        createSeededRandom(i),
      );
      history.push(fromReviewLog(outcome.log));
      state = outcome.next;
    }
    await owner.query(
      `insert into reviews(id,user_id,card_id,rating,reviewed_at,placed_due,state_before,elapsed_days,scheduled_days,stability_before,difficulty_before)
      select md5(c.id::text||':'||s)::uuid,$1,c.id,h->>'rating',(h->>'reviewedAt')::timestamptz,(h->>'placedDue')::timestamptz,
        h->>'stateBefore',(h->>'elapsedDays')::int,(h->>'scheduledDays')::int,(h->>'stabilityBefore')::float8,(h->>'difficultyBefore')::float8
      from cards c cross join jsonb_array_elements($2::jsonb) with ordinality as v(h,s) where c.user_id=$1 and c.id<>$3`,
      [f.userId, JSON.stringify(history), f.card.id],
    );
    const stored = fromSchedulingState(state);
    await owner.query(
      `update cards set state=$2,stability=$3,difficulty=$4,due=$5,last_review=$6,reps=$7,lapses=$8,learning_step=$9,placed_due=$5 where user_id=$1 and id<>$10`,
      [
        f.userId,
        stored.state,
        stored.stability,
        stored.difficulty,
        stored.due,
        stored.lastReview,
        stored.reps,
        stored.lapses,
        stored.learningStep,
        f.card.id,
      ],
    );
    const baselineRss = process.memoryUsage().rss;
    let peakRss = baselineRss;
    const sample = setInterval(() => {
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
    }, 10);
    let result;
    let deep;
    try {
      result = await run(f, { statementMs: 10000 });
      expect(
        result.status,
        JSON.stringify({ failure: result.failure, metrics: result.metrics }),
      ).toBe('complete');
      expect(errors(result)).toEqual([]);
      expect(result.counts['notes']).toBe('3001');
      expect(result.counts['cards']).toBe('6001');
      expect(result.counts['reviews']).toBe('60000');
      expect(result.metrics.maxRows).toBeLessThanOrEqual(11);
      deep = await run(f, { deep: true, deckId: f.deck.id, maxItems: 50, pageSize: 17 });
      expect(
        deep.status,
        JSON.stringify({ failure: deep.failure, metrics: deep.metrics, checks: deep.checks }),
      ).toBe('incomplete');
      expect(errors(deep)).toEqual([]);
      expect(deep.metrics.maxRows).toBeLessThanOrEqual(18);
    } finally {
      clearInterval(sample);
    }
    expect(peakRss - baselineRss).toBeLessThan(128 * 1024 * 1024);
    console.log(
      JSON.stringify({
        benchmark: 'doctor-local-postgres',
        notes: 3001,
        cards: 6001,
        reviews: 60000,
        structural: result?.metrics,
        slowChecks: result?.checks.filter((check) => check.elapsedMs >= 100),
        deep50: deep?.metrics,
        rssGrowthMiB: Math.round((peakRss - baselineRss) / 1024 / 1024),
      }),
    );
  });
});

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createSchedulerConfig, createSeededRandom, newCard, review } from '@neuron/core';
import { dailyStudySessionSchema, uuidV7 } from '@neuron/shared';
import type { DailyStudySessionRequest, Me, PullSyncResult } from '@neuron/shared';

import { planDownloadedStudy } from '../../../web/src/lib/offline-study-snapshot.js';
import { createUser, repositoriesFor, testDatabase } from '../db/testing/database.js';
import { json, testServer } from '../testing/server.js';

import type { StudySnapshot } from '../../../web/src/lib/offline-study-snapshot.js';
import type { PendingReview } from '../../../web/src/lib/review-intent.js';
import type { Repositories } from '../db/repositories/index.js';
import type { Hono } from 'hono';

const database = testDatabase();
const owner = 'offline-study-parity';
describe.skipIf(!database)(
  'downloaded and authenticated Study planner parity over PostgreSQL/RLS',
  () => {
    let repositories: Repositories;
    let server: Hono;
    let german: string;
    let english: string;
    let paused: string;
    let folder: string;
    let current: StudySnapshot;
    beforeAll(async () => {
      if (!database) return;
      await createUser(database, owner, {
        timezone: 'UTC',
        settings: { budgetMinutes: [30, 15, 15, 15, 15, 15, 30], maximumNewCardsPerDay: 3 },
      });
      repositories = repositoriesFor(database, owner);
      server = testServer(database, owner);
      folder = (
        await repositories.decks.create({
          name: 'German folder',
          kind: 'folder',
          settings: { targetLanguage: 'de' },
        })
      ).id;
      german = (await repositories.decks.create({ name: 'German', parentId: folder })).id;
      english = (
        await repositories.decks.create({ name: 'English', settings: { targetLanguage: 'en' } })
      ).id;
      paused = (
        await repositories.decks.create({
          name: 'Paused',
          settings: { dailyStudyIncluded: false, targetLanguage: 'en' },
        })
      ).id;
      for (const deckId of [german, english, paused]) {
        const notes = await repositories.notes.createMany(
          Array.from({ length: 8 }, (_, n) => ({
            deckId,
            noteType: 'vocab' as const,
            fields: { term: `Term ${n}`, translation: `Meaning ${n}` },
          })),
        );
        const created = await repositories.cards.createMany(
          notes.flatMap((note) =>
            (['recognition', 'recall', 'production', 'listening'] as const).map((direction) => ({
              noteId: note.id,
              direction,
              due: new Date('2026-08-01T12:00:00Z'),
            })),
          ),
        );
        for (const card of created.slice(0, 8))
          await repositories.reviews.record({
            id: uuidV7(),
            cardId: card.id,
            rating: 4,
            now: new Date('2026-09-01T12:00:00Z'),
            durationMs: 6000,
          });
        await repositories.reviews.record({
          id: uuidV7(),
          cardId: created[16]!.id,
          rating: 1,
          now: new Date('2026-10-15T03:59:00Z'),
          durationMs: 12000,
        });
      }
      const toReset = (await repositories.cards.forSession({ deckIds: [german] }))[0]!;
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-14T12:00:00Z'));
      await repositories.reviews.restartDeck(german, uuidV7(), toReset.noteId);
      vi.useRealTimers();
      const restored = await repositories.reviews.record({
        id: uuidV7(),
        cardId: toReset.id,
        rating: 4,
        now: new Date('2026-10-15T04:01:00Z'),
      });
      await repositories.reviews.undo(
        restored.review.id,
        uuidV7(),
        new Date('2026-10-15T04:02:00Z'),
      );
      current = await download();
    });
    afterEach(() => vi.useRealTimers());

    async function download(): Promise<StudySnapshot> {
      const account = await json<Me>(await server.request('/api/account'), 200);
      const changes: PullSyncResult['changes'] = [];
      let cursor = 0;
      for (;;) {
        const page = await json<PullSyncResult>(
          await server.request(`/api/sync?since=${cursor}&limit=20`),
          200,
        );
        changes.push(...page.changes);
        cursor = page.revision;
        if (!page.hasMore) break;
      }
      return {
        account,
        cursor,
        complete: true,
        reviewSequence: 0,
        decks: changes.filter((row) => row.entity === 'decks'),
        notes: changes.filter((row) => row.entity === 'notes'),
        cards: changes.filter((row) => row.entity === 'cards'),
        reviews: changes.filter((row) => row.entity === 'reviews'),
        edits: [],
        events: [],
      };
    }
    async function compare(
      body: Partial<DailyStudySessionRequest>,
      time = '2026-10-15T12:00:00.000Z',
    ) {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(time));
      const before = (await repositories.account.read()).currentRev;
      const online = dailyStudySessionSchema.parse(
        await json(
          await server.request('/api/study/session', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }),
          200,
        ),
      );
      const { offlineStudy, ...offline } = planDownloadedStudy(
        current,
        owner,
        body,
        new Date(time),
      );
      expect(offlineStudy.limit).toBeNull();
      const normalize = (plan: typeof online) => ({
        ...plan,
        notes: [...plan.notes].sort((a, b) => a.id.localeCompare(b.id)),
      });
      expect(normalize(offline)).toEqual(normalize(online));
      expect((await repositories.account.read()).currentRev).toBe(before);
      return online;
    }
    for (const time of [
      '2026-10-15T03:59:30.000Z',
      '2026-10-15T04:00:00.000Z',
      '2026-10-16T04:00:00.000Z',
    ]) {
      for (const targetLanguage of ['de', 'en'] as const) {
        it(`matches shared automatic workload and history at ${time} in ${targetLanguage}`, async () => {
          await compare({ targetLanguage }, time);
        });
      }
    }
    for (const direction of ['recognition', 'recall', 'production', 'listening'] as const) {
      it(`matches ${direction}, temporary time and explicit override`, async () => {
        await compare({ direction, minutes: 5, newCards: 'override', targetLanguage: 'en' });
      });
    }
    it('matches default participation, Folder inheritance and temporary paused scope', async () => {
      expect((await compare({})).scopeDeckIds).not.toContain(paused);
      await compare({ deckId: folder });
      await compare({ deckIds: [paused, english], targetLanguage: 'en', newCards: 'exclude' });
      await compare({ deckIds: [] });
    });
    it('matches cancellation, restarted history and a changed account timezone/weekday budget', async () => {
      await repositories.account.updatePreferences({
        timezone: 'America/New_York',
        dayCutoffHour: 3,
        settings: {
          budgetMinutes: [5, 10, 15, 20, 25, 30, 35],
          maximumNewCardsPerDay: 2,
          targetRetention: 0.95,
        },
      });
      current = await download();
      await compare({ targetLanguage: 'de' }, '2026-11-01T06:59:00.000Z');
      await compare({ targetLanguage: 'en' }, '2026-11-01T08:00:00.000Z');
    });
    it('replays a locally committed answer, Undo and regrade exactly like causal server delivery', async () => {
      current = await download();
      const time = '2026-11-02T12:00:00.000Z';
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(time));
      const first = planDownloadedStudy(
        current,
        owner,
        { targetLanguage: 'en', newCards: 'override' },
        new Date(time),
      ).cards[0]!;
      const sessionId = uuidV7();
      const answerId = uuidV7();
      const answer: PendingReview = {
        kind: 'review-event',
        operationId: answerId,
        accountId: owner,
        sessionId,
        sequence: 1,
        predecessor: null,
        before: first,
        state: 'pending',
        event: {
          type: 'answer',
          payload: {
            id: answerId,
            cardId: first.id,
            rating: 'good',
            reviewedAt: time,
            durationMs: 7000,
          },
        },
      };
      const undoId = uuidV7();
      const undo: PendingReview = {
        ...answer,
        operationId: undoId,
        sequence: 2,
        predecessor: answerId,
        event: { type: 'undo', payload: { id: undoId, reviewId: answerId, reviewedAt: time } },
      };
      const regradeId = uuidV7();
      const regrade: PendingReview = {
        ...answer,
        operationId: regradeId,
        sequence: 3,
        predecessor: undoId,
        event: {
          type: 'answer',
          payload: {
            ...(answer.event.payload as Extract<
              PendingReview['event'],
              { type: 'answer' }
            >['payload']),
            id: regradeId,
            cardId: first.id,
            rating: 'easy',
            reviewedAt: time,
            durationMs: 5000,
          },
        },
      };
      current.events = [answer, undo, regrade];
      current.reviewSequence = 3;
      const local = planDownloadedStudy(current, owner, { targetLanguage: 'en' }, new Date(time));
      for (const entry of [answer, undo, regrade])
        await json(
          await server.request(
            entry.event.type === 'answer' ? '/api/reviews' : '/api/reviews/undo',
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(entry.event.payload),
            },
          ),
          200,
        );
      const online = dailyStudySessionSchema.parse(
        await json(
          await server.request('/api/study/session', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ targetLanguage: 'en' }),
          }),
          200,
        ),
      );
      expect(local.offlineStudy.limit).toBeNull();
      expect({
        ...local,
        offlineStudy: undefined,
        planningContext: undefined,
        notes: [...local.notes].sort((a, b) => a.id.localeCompare(b.id)),
      }).toEqual({
        ...online,
        offlineStudy: undefined,
        planningContext: undefined,
        notes: [...online.notes].sort((a, b) => a.id.localeCompare(b.id)),
      });
      const other = `${owner}-isolated`;
      await createUser(database!, other);
      const isolated = await json<PullSyncResult>(
        await testServer(database!, other).request('/api/sync'),
        200,
      );
      expect(isolated.changes).toEqual([]);
      expect(() => planDownloadedStudy(current, other, {}, new Date(time))).toThrow(
        'offline_study_account',
      );
    });

    it('recognizes a later-dated captured root after out-of-order answers, Undo and regrading', async () => {
      const note = await repositories.notes.create({
        deckId: german,
        noteType: 'basic',
        fields: { front: 'Out of order', back: 'Captured origin' },
      });
      const card = await repositories.cards.create({
        noteId: note.id,
        direction: 'recognition',
        due: new Date('2026-08-01T12:00:00Z'),
      });
      await repositories.reviews.record({
        id: uuidV7(),
        cardId: card.id,
        rating: 4,
        now: new Date('2026-10-01T12:00:00Z'),
        durationMs: 5000,
      });
      const late = await repositories.reviews.record({
        id: uuidV7(),
        cardId: card.id,
        rating: 4,
        now: new Date('2026-10-01T11:59:00Z'),
        durationMs: 5000,
      });
      current = await download();
      await compare({ targetLanguage: 'de' });
      await repositories.reviews.undo(late.review.id, uuidV7(), new Date('2026-10-02T12:00:00Z'));
      current = await download();
      await compare({ targetLanguage: 'de' });
      await repositories.reviews.record({
        id: uuidV7(),
        cardId: card.id,
        rating: 4,
        now: new Date('2026-10-01T11:59:30Z'),
        durationMs: 5000,
      });
      current = await download();
      await compare({ targetLanguage: 'de' });
    });

    it('matches complete mixed legacy history, Undo and purged/deleted workload without changing original schedules', async () => {
      const note = await repositories.notes.create({
        deckId: german,
        noteType: 'basic',
        fields: { front: 'Legacy', back: 'History' },
      });
      const card = await repositories.cards.create({
        noteId: note.id,
        direction: 'recognition',
        due: new Date('2026-08-01T12:00:00Z'),
      });
      const first = review(
        newCard(new Date('2026-08-01T12:00:00Z')),
        4,
        new Date('2026-09-02T12:00:00Z'),
        createSchedulerConfig({ timezone: 'UTC', dayCutoffHour: 4 }),
        createSeededRandom(1),
        6000,
      );
      await repositories.cards.putState(card.id, first.next);
      await repositories.reviews.append([{ cardId: card.id, log: first.log }]);
      const modern = await repositories.reviews.record({
        id: uuidV7(),
        cardId: card.id,
        rating: 4,
        now: new Date('2026-09-01T12:00:00Z'),
        durationMs: 7000,
      });
      expect(modern.card.reps).toBe(3);
      current = await download();
      const original = current.cards.find((row) => row.id === card.id)!.row;
      await compare({ targetLanguage: 'de' });
      expect(current.cards.find((row) => row.id === card.id)!.row).toEqual(original);
      await repositories.reviews.undo(modern.review.id, uuidV7(), new Date('2026-09-03T12:00:00Z'));
      current = await download();
      await compare({ targetLanguage: 'de', newCards: 'override' });
      await repositories.notes.softDelete(note.id);
      current = await download();
      await compare({ targetLanguage: 'de' });
      await repositories.purge.remove('notes', note.id);
      current = await download();
      expect(current.cards.find((row) => row.id === card.id)?.purged).toBe(true);
      await compare({ targetLanguage: 'de' });
      await compare({ targetLanguage: 'en' });
    });
  },
);

import { expect } from '@playwright/test';

import { toSchedulingState } from '../../../api/src/db/repositories/index.js';

import { connect, converges, snapshot, test, warmed } from './fixture';

import type { PendingReview } from '../../src/lib/review-intent';
import type { Page } from '@playwright/test';

const settings = '/settings';
const initialAnswer = 'Original answer';
const localAnswer = (device: string) => `Synthetic edit by ${device}`;
const folder = 'Synthetic saved folder';
const deck = 'Synthetic saved deck';
const grades = ['Again', 'Hard', 'Good', 'Easy'] as const;

async function study(page: Page, grade: string, replacement?: string) {
  await page.getByRole('button', { name: 'Study', exact: true }).click();
  await page.getByRole('button', { name: 'Show answer', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(`^${grade} `) }).click();
  if (replacement) {
    await page.getByRole('button', { name: 'Undo last answer', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(`^${replacement} `) }).click();
  }
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
}

async function edit(page: Page, noteId: string, device: string) {
  await page.goto(`/notes/${noteId}`);
  const field = page.getByRole('textbox', { name: 'Back', exact: true });
  await expect(field).toHaveValue(initialAnswer);
  await field.fill(localAnswer(device));
  await expect(page.getByText('Saved on device', { exact: true })).toBeVisible();
}

async function signIn(page: Page) {
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('fixture@neuron.test');
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Library', exact: true })).toBeVisible();
}

async function create(page: Page, kind: 'folder' | 'deck') {
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: `New ${kind}`, exact: true }).click();
  const dialog = page.getByRole('dialog');
  const name = kind === 'folder' ? folder : deck;
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('button', { name: new RegExp(`^${name}`) })).toBeVisible();
}

function assertChain(reviews: PendingReview[]) {
  expect(
    reviews.map((item) => item.event.type),
    'answer, Undo, replacement',
  ).toEqual(['answer', 'undo', 'answer']);
  expect(
    reviews.map((item) => item.predecessor),
    'durable causal predecessors',
  ).toEqual([null, reviews[0]!.operationId, reviews[1]!.operationId]);
  expect(reviews[1]!.event.payload).toMatchObject({ reviewId: reviews[0]!.operationId });
}

const fixedSeed = 104;
const stressSeeds = [17, 38, 59, 80, 101, 122, 143, 164];
const seedOverride = process.env['SYNC_CHAOS_SEED'];
if (
  seedOverride !== undefined &&
  (!/^\d+$/.test(seedOverride) || Number(seedOverride) > 0xffffffff)
)
  throw new Error('SYNC_CHAOS_SEED must be an unsigned 32-bit integer.');
const seeds =
  seedOverride !== undefined
    ? [Number(seedOverride)]
    : process.env['SYNC_CHAOS_STRESS'] === 'true'
      ? stressSeeds
      : [fixedSeed];

for (const seed of seeds) {
  test(`mixed delivery and canonical replay, seed ${seed}`, async ({ lab, journal }) => {
    const { owner, repo, note, card } = lab;
    const a = await lab.device('A');
    const b = await lab.device('B');
    let pageA = await a.open('/');
    const pageB = await b.open('/');
    await Promise.all([warmed(pageA, owner), warmed(pageB, owner)]);

    // The seed chooses meaningful orderings and ratings. No wall-clock sleeps
    // decide who commits first or when any fault is injected.
    const bFirst = Boolean(seed & 1);
    const noteFirst = Boolean(seed & 2);
    const firstGrade = grades[(seed >>> 2) % grades.length]!;
    const lastGrade = grades[(seed >>> 4) % grades.length]!;
    const gradeB = grades[(seed >>> 6) % grades.length]!;
    const stageA = async () => {
      await pageA.bringToFront();
      journal.record({ event: 'stage', device: 'A', grade: firstGrade, replacement: lastGrade });
      await study(pageA, firstGrade, lastGrade);
      if (noteFirst) await edit(pageA, note.id, 'A');
      await create(pageA, 'folder');
      if (!noteFirst) await edit(pageA, note.id, 'A');
      await pageA.getByRole('link', { name: 'Settings', exact: true }).click();
    };
    const stageB = async () => {
      await pageB.bringToFront();
      journal.record({ event: 'stage', device: 'B', grade: gradeB });
      await study(pageB, gradeB);
      await edit(pageB, note.id, 'B');
      await create(pageB, 'deck');
      await pageB.getByRole('link', { name: 'Settings', exact: true }).click();
    };
    const [savedA, savedB] =
      await test.step('stage independent work from the same revision', async () => {
        journal.record({
          event: 'plan',
          seed,
          firstDevice: bFirst ? 'B' : 'A',
          firstWrite: noteFirst ? 'note' : 'folder',
        });
        await Promise.all([connect(pageA, a.origin, false), connect(pageB, b.origin, false)]);
        if (bFirst) {
          await stageB();
          await stageA();
        } else {
          await stageA();
          await stageB();
        }
        const stateA = (await snapshot(pageA, owner))!;
        const stateB = (await snapshot(pageB, owner))!;
        assertChain(stateA.reviews);
        expect(stateB.reviews.map((entry) => entry.state)).toEqual(['pending']);
        expect(stateA.reviews.map((entry) => entry.state)).toEqual([
          'pending',
          'pending',
          'pending',
        ]);
        expect(stateA.edits[0]?.payload.baseRev).toBe(note.rev);
        expect(stateB.edits[0]?.payload.baseRev).toBe(note.rev);
        expect(a.origin.attempts).toHaveLength(0);
        expect(b.origin.attempts).toHaveLength(0);
        return [stateA, stateB] as const;
      });
    const [answer, undo, replacement] = savedA.reviews as [
      PendingReview,
      PendingReview,
      PendingReview,
    ];
    const competing = savedB.reviews[0]!;
    const firstToAnswer = bFirst ? competing : replacement;
    const lastToAnswer = bFirst ? replacement : competing;
    expect(
      firstToAnswer.event.payload.reviewedAt < lastToAnswer.event.payload.reviewedAt,
      'the seed controls the surviving event order independently of commit order',
    ).toBe(true);
    const reviewRows = async () =>
      (await repo.sync.pull(0, 200)).changes.filter((entry) => entry.entity === 'reviews');

    const before = a.origin.hold('answer', 'before');
    const delayed = a.origin.hold('answer', 'after');
    const noteRace = a.origin.hold('note', 'before');
    const undoLost = a.origin.hold('undo', 'after');
    const duplicate = a.origin.hold('undo', 'after');
    const undoFinal = a.origin.hold('undo', 'before');
    await test.step(
      'drop the first request before dispatch and hold the committed retry',
      async () => {
        await connect(pageA, a.origin, true);
        await before.reached;
        expect(await reviewRows(), 'pre-dispatch cut leaves PostgreSQL untouched').toEqual([]);
        before.release('drop');
        const response = await delayed.reached;
        expect(response?.ok, 'retry reached the real Review route').toBe(true);
        expect(
          (await reviewRows()).map((row) => row.id),
          'Review committed before the held reply',
        ).toEqual([answer.operationId]);
        expect((await snapshot(pageA, owner))?.reviews[0]?.state).toBe('pending');
        a.origin.exact('answer', [answer.event.payload, answer.event.payload]);
        a.origin.exact('undo', []);
      },
      { timeout: 20_000 },
    );

    const earlierReply = (await delayed.reached)!;
    await test.step(
      'settle B while A still waits, then retain the losing Note edit',
      async () => {
        await noteRace.reached;
        await connect(pageB, b.origin, true);
        await expect
          .poll(async () => {
            const state = await snapshot(pageB, owner);
            return [state?.reviews[0]?.state, state?.edits[0]?.state, state?.creations[0]?.state];
          })
          .toEqual(['synchronized', 'synchronized', 'synchronized']);
        expect((await repo.notes.byId(note.id))?.fields).toEqual({
          front: 'Synthetic question',
          back: localAnswer('B'),
        });
        noteRace.release();
        await expect
          .poll(async () => (await snapshot(pageA, owner))?.edits[0]?.state)
          .toBe('conflict');
        expect((await snapshot(pageA, owner))?.edits[0]).toMatchObject({
          operationId: savedA.edits[0]!.operationId,
          payload: savedA.edits[0]!.payload,
          outcome: { status: 'conflict', reason: 'changed_remotely' },
        });
        a.origin.exact('undo', []);
        delayed.release();
        await undoLost.reached;
        const sent = journal.entries.filter(
          (entry) => entry.event === 'response-sent' && entry.operation === 'answer',
        );
        expect(
          sent.map((entry) => entry.device),
          'B acknowledgement passed A’s held acknowledgement',
        ).toEqual(['B', 'A']);
        const committed = await reviewRows();
        expect(
          committed.map((row) => row.id).sort(),
          'Undo committed while replacement still waits',
        ).toEqual([answer.operationId, competing.operationId, undo.operationId].sort());
        expect((await snapshot(pageA, owner))?.reviews.map((entry) => entry.state)).toEqual([
          'synchronized',
          'pending',
          'pending',
        ]);
      },
      { timeout: 16_000 },
    );

    await test.step(
      'reopen after losing the Undo reply and reject a duplicated answer reply',
      async () => {
        const cut = pageA.waitForEvent('requestfailed', {
          predicate: (request) => new URL(request.url()).pathname === '/api/reviews/undo',
          timeout: 5_000,
        });
        undoLost.release('drop');
        await cut;
        journal.record({ event: 'close-page', device: 'A' });
        await pageA.close();
        journal.record({ event: 'reopen-page', device: 'A' });
        pageA = await a.open(settings);
        const retryResponse = await duplicate.reached;
        expect(retryResponse?.ok, 'exact Undo retry returned the real server acknowledgement').toBe(
          true,
        );
        expect(
          (await reviewRows()).map((row) => row.id).sort(),
          'exact retry did not insert another Review',
        ).toEqual([answer.operationId, competing.operationId, undo.operationId].sort());
        duplicate.release(earlierReply);
        await undoFinal.reached;
        const retained = (await snapshot(pageA, owner))!.reviews;
        expect(retained.map((entry) => entry.event)).toEqual(
          savedA.reviews.map((entry) => entry.event),
        );
        expect(retained[1], 'duplicate answer acknowledgement cannot settle Undo').toMatchObject({
          state: 'pending',
          failure: 'invalid_acknowledgement',
        });
        expect(retained[2]?.state).toBe('pending');
        undoFinal.release();
        await expect
          .poll(async () => (await snapshot(pageA, owner))?.reviews.map((entry) => entry.state))
          .toEqual(['synchronized', 'synchronized', 'synchronized']);
      },
      { timeout: 20_000 },
    );

    await test.step('verify history, receipts, scheduling, and convergence', async () => {
      a.origin.exact('answer', [
        answer.event.payload,
        answer.event.payload,
        replacement.event.payload,
      ]);
      a.origin.exact('undo', [undo.event.payload, undo.event.payload, undo.event.payload]);
      a.origin.exact('note', [savedA.edits[0]!.payload]);
      a.origin.exact('create', [savedA.creations[0]!.payload]);
      b.origin.exact('answer', [competing.event.payload]);
      b.origin.exact('note', [savedB.edits[0]!.payload]);
      b.origin.exact('create', [savedB.creations[0]!.payload]);

      const events = await reviewRows();
      const expectedCommitOrder = [answer, competing, undo, replacement];
      expect(
        events.toSorted((x, y) => x.rev - y.rev).map((row) => row.id),
        'immutable history and causal commit order',
      ).toEqual(expectedCommitOrder.map((entry) => entry.operationId));
      for (const entry of expectedCommitOrder) {
        const stored = events.find((row) => row.id === entry.operationId)?.row;
        const { event } = entry;
        expect(
          stored,
          'persisted Review or Undo retains original identity and target',
        ).toMatchObject(
          event.type === 'answer'
            ? {
                cardId: card.id,
                rating: event.payload.rating,
                durationMs: event.payload.durationMs,
                reviewedAt: new Date(event.payload.reviewedAt),
                cancelsReviewId: null,
              }
            : {
                cardId: card.id,
                cancelsReviewId: event.payload.reviewId,
                submittedAt: new Date(event.payload.reviewedAt),
              },
        );
      }
      const [persisted] = await repo.cards.forNote(note.id);
      expect(persisted?.id, 'Note edit preserved the studied Card identity').toBe(card.id);
      const replay = await repo.reviews.rebuild(card.id);
      expect(
        toSchedulingState(persisted!),
        'stored Card matches read-only canonical replay',
      ).toEqual(replay);
      expect(replay.reps, 'both surviving answers count once').toBe(2);
      expect(
        replay.lastReview,
        'the most recent surviving event determines last review time',
      ).toEqual(new Date(lastToAnswer.event.payload.reviewedAt));
      expect(
        await repo.reviews.countForCards([card.id]),
        'canceled answer remains in history',
      ).toBe(3);

      const receipts = [
        { fingerprint: `note-edit:${savedA.edits[0]!.operationId}`, status: 'conflict' },
        { fingerprint: `note-edit:${savedB.edits[0]!.operationId}`, status: 'applied' },
        ...[savedA, savedB].map(({ creations }) => ({
          fingerprint: `deck-create:${creations[0]!.payload.operationId}`,
          status: 'applied',
        })),
      ];
      expect(await lab.receipts(owner), 'one durable receipt per collection intent').toEqual(
        receipts.sort((x, y) => x.fingerprint.localeCompare(y.fingerprint)),
      );
      for (const { creations } of [savedA, savedB]) {
        const { entityId, name, kind } = creations[0]!.payload;
        expect(await repo.decks.byId(entityId)).toMatchObject({ id: entityId, name, kind });
      }
      expect((await repo.decks.list()).map((entry) => entry.name).sort()).toEqual(
        ['Chaos study deck', deck, folder].sort(),
      );
      expect((await repo.notes.byId(note.id))?.fields).toMatchObject({ back: localAnswer('B') });

      // Foreground validation is how an idle second device learns of later writes.
      await pageB.reload();
      await Promise.all([
        converges(pageA, owner, lab.apps.owner),
        converges(pageB, owner, lab.apps.owner),
      ]);
    });
  });
}

if (seedOverride === undefined) {
  test('expiry and account switching interrupt a committed creation, seed 0', async ({
    lab,
    journal,
  }) => {
    const { owner, other, repo, note, foreignDeck } = lab;
    const a = await lab.device('A');
    const page = await a.open(settings);
    await warmed(page, owner);
    const saved = await test.step('stage a creation and a later Note edit offline', async () => {
      journal.record({ event: 'plan', seed: 0, device: 'A', firstWrite: 'folder' });
      await connect(page, a.origin, false);
      await create(page, 'folder');
      await edit(page, note.id, 'A');
      await page.getByRole('link', { name: 'Settings', exact: true }).click();
      const stored = (await snapshot(page, owner))!;
      expect(stored.creations.map((entry) => entry.state)).toEqual(['pending']);
      expect(stored.edits.map((entry) => entry.state)).toEqual(['pending']);
      return stored;
    });
    const creation = saved.creations[0]!;
    const pendingEdit = saved.edits[0]!;
    const committed = a.origin.hold('create', 'after');

    await test.step(
      'expire the session with a committed creation and a pending edit',
      async () => {
        await connect(page, a.origin, true);
        expect((await committed.reached)?.ok).toBe(true);
        expect(await repo.decks.byId(creation.payload.entityId)).toMatchObject({ name: folder });
        expect(await lab.receipts(owner)).toEqual([
          { fingerprint: `deck-create:${creation.payload.operationId}`, status: 'applied' },
        ]);
        a.origin.authenticate('expired');
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
        expect(journal.entries).toContainEqual(
          expect.objectContaining({
            event: 'account-validation',
            session: 'expired',
            status: 401,
          }),
        );
        committed.release();
        const retained = (await snapshot(page, owner))!;
        expect(retained.creations).toEqual(saved.creations);
        expect(retained.edits).toEqual(saved.edits);
        a.origin.exact('note', []);
      },
      { timeout: 20_000 },
    );

    await test.step('validate another account without delivering or exposing the original work', async () => {
      a.origin.authenticate('other');
      await signIn(page);
      await page.getByRole('link', { name: 'Library', exact: true }).click();
      await expect(page.getByRole('button', { name: /^Other account deck/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /^Synthetic saved folder/ })).toHaveCount(0);
      await converges(page, other, lab.apps.other);
      const isolated = (await snapshot(page, other))!;
      expect(isolated.rows.map((row) => row.id)).toEqual([foreignDeck.id]);
      expect([isolated.edits, isolated.creations, isolated.reviews]).toEqual([[], [], []]);
      expect(await lab.receipts(other), 'RLS hides receipts from the other account').toEqual([]);
      expect(await repo.decks.byId(foreignDeck.id)).toBeUndefined();
      a.origin.exact('note', []);
      a.origin.exact('create', [creation.payload]);
    });

    await test.step('restore the original session and settle both intents exactly once', async () => {
      await page.getByRole('link', { name: 'Settings', exact: true }).click();
      await page.getByRole('button', { name: 'What works offline', exact: true }).click();
      a.origin.authenticate('expired');
      await page.getByRole('button', { name: 'Check connection', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
      a.origin.authenticate('owner');
      await signIn(page);
      await expect
        .poll(async () => {
          const state = await snapshot(page, owner);
          return [state?.creations[0]?.state, state?.edits[0]?.state];
        })
        .toEqual(['synchronized', 'synchronized']);
      a.origin.exact('create', [creation.payload, creation.payload]);
      a.origin.exact('note', [pendingEdit.payload]);
      expect(await lab.receipts(owner)).toEqual([
        { fingerprint: `deck-create:${creation.payload.operationId}`, status: 'applied' },
        { fingerprint: `note-edit:${pendingEdit.operationId}`, status: 'applied' },
      ]);
      expect(
        (await repo.decks.list()).filter((entry) => entry.name === folder).map((entry) => entry.id),
      ).toEqual([creation.payload.entityId]);
      expect((await repo.notes.byId(note.id))?.fields).toMatchObject({ back: localAnswer('A') });
      await converges(page, owner, lab.apps.owner);
    });
  });
}

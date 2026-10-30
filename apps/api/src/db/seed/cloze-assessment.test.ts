import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSchedulerConfig, createSeededRandom, newCard, replay, review } from '@neuron/core';

import { toSchedulingState } from '../repositories/mapping.js';
import {
  createUser,
  rawAppPool,
  rawOwnerPool,
  repositoriesFor,
  testDatabase,
} from '../testing/database.js';

import { assessClozeNote, assessStoredClozes } from './cloze-assessment.js';

import type { AssessmentCard, AssessmentNote } from './cloze-assessment.js';
import type { Pool } from '@neondatabase/serverless';

const zero: AssessmentCard = {
  id: 'zero',
  slot: 0,
  deleted: false,
  suspended: false,
  reviewRows: 0,
  pristine: true,
};
const note: AssessmentNote = {
  id: 'note',
  fields: { text: 'a {{gap}}' },
  deleted: false,
  active: true,
  cards: [zero],
};

describe('legacy Cloze assessment', () => {
  it('identifies only a pristine unreviewed single-gap Card as a retarget candidate', () => {
    expect(assessClozeNote(note)[0]).toMatchObject({
      resolution: 'single-gap-unreviewed-candidate',
      validSlots: [1],
      missingSlots: [1],
    });
  });
  it('does not assume slot 1 when the only explicitly numbered gap is slot 7', () => {
    expect(assessClozeNote({ ...note, fields: { text: '{{c7::gap}}' } })[0]?.validSlots).toEqual([
      7,
    ]);
  });
  it('does not classify a valid explicit c0 Card as unrenderable', () => {
    expect(assessClozeNote({ ...note, fields: { text: '{{c0::gap}}' } })).toEqual([]);
  });
  it('never guesses which gap a multi-gap legacy Card meant', () => {
    expect(assessClozeNote({ ...note, fields: { text: '{{a}} {{b}}' } })[0]?.resolution).toBe(
      'ambiguous-gap',
    );
  });
  it('reports the PR #61 collision without assigning the invalid Card to the other gap', () => {
    expect(
      assessClozeNote({
        ...note,
        fields: { text: '{{a}} {{b}}' },
        cards: [zero, { ...zero, id: 'one', slot: 1 }],
      })[0],
    ).toMatchObject({ resolution: 'live-collision', liveCollisions: [1], missingSlots: [2] });
  });
  it('retains deleted collisions for an explicit restore/history decision', () => {
    expect(
      assessClozeNote({ ...note, cards: [zero, { ...zero, id: 'one', slot: 1, deleted: true }] })[0]
        ?.resolution,
    ).toBe('historical-collision');
    expect(assessClozeNote({ ...note, deleted: true })[0]?.resolution).toBe('retained-deleted');
  });
  it('counts immutable history even when reps and the current state have been reset', () => {
    expect(assessClozeNote({ ...note, cards: [{ ...zero, reviewRows: 2 }] })[0]?.resolution).toBe(
      'reviewed-or-stateful',
    );
    expect(assessClozeNote({ ...note, cards: [{ ...zero, pristine: false }] })[0]?.resolution).toBe(
      'reviewed-or-stateful',
    );
  });
  it('reports malformed or gapless content without printing the content', () => {
    const result = assessClozeNote({ ...note, fields: { text: 'private gapless text' } });
    expect(result[0]?.resolution).toBe('invalid-note');
    expect(JSON.stringify(result)).not.toContain('private');
  });
});

const database = testDatabase();
describe.skipIf(!database)('stored Cloze assessment', () => {
  const userId = 'cloze-assessment-user';
  let owner: Pool;
  let app: Pool;
  let zeroId: string;
  let oneId: string;

  beforeAll(async () => {
    owner = rawOwnerPool(database!);
    app = rawAppPool(database!);
    await createUser(database!, userId);
    await createUser(database!, 'cloze-assessment-other');
    for (const id of [userId, 'cloze-assessment-other']) {
      const repos = repositoriesFor(database!, id);
      const deck = await repos.decks.create({ name: 'Assessment fixture' });
      const stored = await repos.notes.create({
        deckId: deck.id,
        noteType: 'cloze',
        fields: { text: '{{a}} {{b}}' },
      });
      const due = new Date('2026-10-31T12:00:00Z');
      const cards = await repos.cards.createMany([
        { noteId: stored.id, direction: 'cloze', slot: 0, due },
        { noteId: stored.id, direction: 'cloze', slot: 1, due },
      ]);
      // A raw immutable answer must be counted even if the Card is now new.
      const log = review(newCard(due), 3, due, createSchedulerConfig(), createSeededRandom(42)).log;
      await repos.reviews.append([{ cardId: cards[0]!.id, log }]);
      if (id === userId) {
        zeroId = cards[0]!.id;
        oneId = cards[1]!.id;
      }
    }
  });
  afterAll(async () => {
    await app?.end();
    await owner?.end();
  });

  it('reads only the named user and leaves Card schedules and immutable Reviews unchanged', async () => {
    const snapshot = async () =>
      (
        await owner.query(
          `select (select jsonb_agg(to_jsonb(c) order by id) from cards c where user_id = $1) as cards,
              (select jsonb_agg(to_jsonb(r) order by id) from reviews r where user_id = $1) as reviews`,
          [userId],
        )
      ).rows;
    const before = await snapshot();
    const findings = await assessStoredClozes(app, userId);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      cardId: zeroId,
      resolution: 'live-collision',
      reviewRows: 1,
      missingSlots: [2],
    });
    expect(await snapshot()).toEqual(before);
    expect(await assessStoredClozes(app, 'cloze-assessment-absent')).toEqual([]);
  });

  it('proves PostgreSQL rejects a slot-1 retarget when a valid slot-1 sibling exists', async () => {
    const connection = await owner.connect();
    try {
      await connection.query('begin');
      await expect(
        connection.query('update cards set slot = 1 where id = $1', [zeroId]),
      ).rejects.toMatchObject({ code: '23505' });
    } finally {
      await connection.query('rollback');
      connection.release();
    }
    const result = await owner.query(
      'select id, slot from cards where id = any($1::uuid[]) order by slot',
      [[zeroId, oneId]],
    );
    expect(result.rows).toEqual([
      { id: zeroId, slot: 0 },
      { id: oneId, slot: 1 },
    ]);
  });

  it('demonstrates a slot-only retarget preserves a reviewed Card numerically without authorizing its meaning', async () => {
    const repos = repositoriesFor(database!, userId);
    const deck = await repos.decks.create({ name: 'Single-gap fixture' });
    const stored = await repos.notes.create({
      deckId: deck.id,
      noteType: 'cloze',
      fields: { text: '{{only gap}}' },
    });
    const at = new Date('2026-10-31T12:00:00Z');
    const config = createSchedulerConfig();
    const outcome = review(newCard(at), 3, at, config, createSeededRandom(42));
    const card = await repos.cards.create({
      noteId: stored.id,
      direction: 'cloze',
      slot: 0,
      due: outcome.next.due,
      scheduling: outcome.next,
    });
    await repos.reviews.append([{ cardId: card.id, log: outcome.log }]);
    expect(replay(await repos.reviews.forCard(card.id), config)).toEqual(toSchedulingState(card));
    const connection = await owner.connect();
    try {
      await connection.query('begin');
      const snapshot = async () =>
        (
          await connection.query(
            `select (select to_jsonb(c) - 'slot' from cards c where id = $1) as card,
                (select jsonb_agg(to_jsonb(r) order by id) from reviews r where card_id = $1) as reviews`,
            [card.id],
          )
        ).rows;
      const before = await snapshot();
      await connection.query('update cards set slot = 1 where id = $1', [card.id]);
      expect(await snapshot()).toEqual(before);
      expect(
        (await connection.query('select slot from cards where id = $1', [card.id])).rows,
      ).toEqual([{ slot: 1 }]);
    } finally {
      await connection.query('rollback');
      connection.release();
    }
    expect((await repos.cards.byId(card.id))?.slot).toBe(0);
  });
});

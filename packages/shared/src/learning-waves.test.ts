import { describe, expect, it } from 'vitest';

import { freshCard, reviewCard } from '@neuron/core';
import type { WorkloadCard } from '@neuron/core';

import { dailyStudySessionRequestSchema } from './api/study.js';
import { resolveDeckSettings } from './deck-settings.js';
import { WAVE_SIZE, learningWaves, waveRank } from './learning-waves.js';
import { planDailyStudy } from './study-planner.js';

const NOW = new Date('2026-11-02T12:00:00Z');
const id = (index: number) => `n-${String(index).padStart(5, '0')}`;

/** One fresh Card per Note, created in file order. */
function deck(deckId: string, size: number, started: ReadonlySet<number> = new Set()) {
  return Array.from({ length: size }, (_, index): WorkloadCard => {
    const shape = { id: `${deckId}:${id(index)}`, noteId: `${deckId}:${id(index)}` };
    const card = started.has(index)
      ? reviewCard(shape, 10, new Date(NOW.getTime() + 86_400_000 * 5))
      : freshCard(shape, new Date(NOW.getTime() - 86_400_000 + index));
    return { ...card, deckId };
  });
}

const range = (from: number, to: number) =>
  new Set(Array.from({ length: to - from }, (_, i) => from + i));

describe('cutting a Deck into waves', () => {
  it('cuts in file order into waves of fifty and points at the first unfinished one', () => {
    const [summary] = learningWaves(deck('d', 120), new Set()).decks;

    expect(WAVE_SIZE).toBe(50);
    expect(summary).toEqual({
      deckId: 'd',
      number: 1,
      count: 3,
      size: 50,
      started: 0,
      waiting: 50,
      unsure: 0,
      later: 70,
    });
  });

  it('moves on once every Note of a wave has an answered Card', () => {
    const started = new Set([...range(0, 50), 50, 51, 52]);
    const [summary] = learningWaves(deck('d', 120, started), new Set()).decks;

    expect(summary).toMatchObject({ number: 2, size: 50, started: 3, waiting: 47, later: 20 });
  });

  it('holds the last, shorter wave and then nothing once everything has started', () => {
    const last = learningWaves(deck('d', 120, range(0, 110)), new Set()).decks[0];
    expect(last).toMatchObject({ number: 3, size: 20, started: 10, waiting: 10, later: 0 });

    const done = learningWaves(deck('d', 120, range(0, 120)), new Set()).decks[0];
    expect(done).toMatchObject({ number: 0, count: 3, size: 0, waiting: 0, later: 0 });
  });

  it('brings a restarted Note back into its own wave', () => {
    // Note 3 of the first wave was started over: its Card is new again.
    const started = new Set([...range(0, 60)].filter((index) => index !== 3));
    const [summary] = learningWaves(deck('d', 120, started), new Set()).decks;

    expect(summary).toMatchObject({ number: 1, started: 49, waiting: 1, later: 60 });
  });

  it('counts a Note with several Cards once, started by any of them', () => {
    const cards = deck('d', 10);
    const sibling = {
      ...reviewCard({ id: 'second', noteId: cards[0]!.noteId }, 5, NOW),
      deckId: 'd',
    };
    const [summary] = learningWaves([...cards, sibling], new Set()).decks;

    expect(summary).toMatchObject({ size: 10, started: 1, waiting: 9 });
  });

  it('keeps every Deck to its own waves and does not depend on input order', () => {
    const cards = [...deck('b', 60), ...deck('a', 10)];
    const forward = learningWaves(cards, new Set());
    const backward = learningWaves([...cards].reverse(), new Set());

    expect(forward.decks.map((row) => [row.deckId, row.count])).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
    expect(backward.decks).toEqual(forward.decks);
    const rank = (result: typeof forward) =>
      Object.fromEntries(result.cards.map((card) => [card.id, card.admissionRank]));
    expect(rank(backward)).toEqual(rank(forward));
  });
});

describe('Unsure first inside a wave', () => {
  it('ranks Unsure before New in the same wave and never ahead of an earlier wave', () => {
    const cards = deck('d', 120);
    const unsure = new Set([cards[40]!.noteId, cards[60]!.noteId]);
    const { cards: ranked, decks } = learningWaves(cards, unsure);
    const rankOf = (index: number) => ranked[index]!.admissionRank;

    expect(rankOf(40)).toBe(waveRank(0, true));
    expect(rankOf(0)).toBe(waveRank(0, false));
    expect(rankOf(60)).toBe(waveRank(1, true));
    expect(rankOf(40)!).toBeLessThan(rankOf(0)!);
    expect(rankOf(0)!).toBeLessThan(rankOf(60)!);
    expect(rankOf(60)!).toBeLessThan(rankOf(51)!);
    expect(decks[0]).toMatchObject({ unsure: 1 });
  });
});

describe('waves in the shared planner', () => {
  const plan = (cards: readonly WorkloadCard[], unsure?: ReadonlySet<string>) =>
    planDailyStudy({
      account: { id: 'account', settings: {}, timezone: 'UTC', dayCutoffHour: 4 },
      collections: [{ id: 'd', parentId: null, kind: 'deck' }],
      scopeDeckIds: ['d'],
      explicitScope: false,
      settings: resolveDeckSettings([]),
      cards,
      ...(unsure ? { unsureNoteIds: unsure } : {}),
      allLogs: [],
      body: dailyStudySessionRequestSchema.parse({}),
      now: NOW,
    });

  it('admits as many new Notes as before, Unsure ones of the current wave first', () => {
    const cards = deck('d', 300);
    const unsure = new Set([45, 49, 120].map((index) => cards[index]!.noteId));
    const plain = plan(cards);
    const waved = plan(cards, unsure);
    const started = waved.cards.map((card) => card.noteId);

    expect(plain.newCount).toBeGreaterThan(3);
    expect(plain.newCount).toBeLessThan(50);
    expect(waved.newCount).toBe(plain.newCount);
    expect(waved.newCards.allowed).toBe(plain.newCards.allowed);
    // The two Unsure Notes of the first wave start; the one in the third waits.
    expect(started).toContain(cards[45]!.noteId);
    expect(started).toContain(cards[49]!.noteId);
    expect(started).not.toContain(cards[120]!.noteId);
    expect(new Set(started)).toEqual(
      new Set([45, 49, ...range(0, plain.newCount - 2)].map((index) => cards[index]!.noteId)),
    );
    expect(waved.waves).toEqual([
      {
        deckId: 'd',
        number: 1,
        count: 6,
        size: 50,
        started: 0,
        waiting: 50,
        unsure: 2,
        later: 250,
        today: plain.newCount,
      },
    ]);
  });

  it('without triage marks keeps exactly the creation order it had', () => {
    const cards = deck('d', 300);
    const plain = plan(cards);
    expect(plain.cards.map((card) => card.noteId).sort()).toEqual(
      [...range(0, plain.newCount)].map((index) => cards[index]!.noteId),
    );
  });

  it('starts nothing of a later wave while the throttle stops new material', () => {
    // Reviews owed far beyond the budget: a backlog, so no new Cards today.
    const owed = Array.from({ length: 600 }, (_, index) => ({
      ...reviewCard(
        { id: `r${index}`, noteId: `r${index}` },
        3,
        new Date(NOW.getTime() - 86_400_000 * 10),
      ),
      deckId: 'd',
    }));
    const result = plan([...owed, ...deck('d', 80)], new Set());

    expect(result.newCount).toBe(0);
    expect(result.waves[0]).toMatchObject({ today: 0 });
  });
});

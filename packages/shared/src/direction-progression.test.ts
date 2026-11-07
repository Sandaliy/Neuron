import { describe, expect, it } from 'vitest';

import { DEFAULT_DECK_SETTINGS } from './deck-settings.js';
import { directionProgress, ladderProgresses } from './direction-progression.js';

import type { LadderStep } from './card-plan.js';
import type { ProgressionCard } from './direction-progression.js';

const LADDER = DEFAULT_DECK_SETTINGS.ladder;
const WORD = { term: 'Sorgfalt', translation: 'care' };

function card(
  direction: ProgressionCard['direction'],
  stability: number | null,
  extra: Partial<ProgressionCard> = {},
): ProgressionCard {
  return {
    direction,
    slot: 0,
    state: stability === null ? 'new' : 'review',
    stability,
    suspended: false,
    ...extra,
  };
}

function progress(
  cards: readonly ProgressionCard[],
  options: { ladder?: readonly LadderStep[]; active?: boolean; type?: 'vocab' | 'basic' } = {},
) {
  return directionProgress({
    noteType: options.type ?? 'vocab',
    fields: options.type === 'basic' ? { front: 'Sorgfalt', back: 'care' } : WORD,
    ladder: options.ladder ?? LADDER,
    cards,
    active: options.active ?? true,
  });
}

const kinds = (result: ReturnType<typeof progress>) =>
  Object.fromEntries(result.directions.map((status) => [status.direction, status.kind]));

describe('progressive directions on the default ladder', () => {
  it('keeps a new word on recognition and says what comes next', () => {
    const result = progress([card('recognition', null)]);

    expect(result.unlock).toEqual([]);
    expect(kinds(result)).toEqual({
      recognition: 'open',
      recall: 'next',
      production: 'waiting',
      listening: 'manual',
    });
    expect(result.directions[1]).toMatchObject({ after: 'recognition', threshold: 14 });
  });

  it('opens recall exactly at 14 days and not a moment before', () => {
    expect(progress([card('recognition', 13.999)]).unlock).toEqual([]);
    const at = progress([card('recognition', 14)]);
    expect(at.unlock.map((planned) => planned.direction)).toEqual(['recall']);
    expect(at.directions[1]).toMatchObject({ kind: 'ready', stability: 14 });
  });

  it('opens typing from recall, never from recognition', () => {
    const result = progress([card('recognition', 400), card('recall', 20)]);
    expect(result.unlock).toEqual([]);
    expect(result.directions[2]).toMatchObject({
      kind: 'next',
      after: 'recall',
      threshold: 21,
      stability: 20,
    });
    expect(
      progress([card('recognition', 400), card('recall', 21)]).unlock.map((c) => c.direction),
    ).toEqual(['production']);
  });

  it('opens at most the rung whose predecessor qualifies', () => {
    // Recognition far past both thresholds still opens only recall.
    expect(progress([card('recognition', 400)]).unlock.map((c) => c.direction)).toEqual(['recall']);
  });

  it('draws the card it would open, faces included', () => {
    const [planned] = progress([card('recognition', 30)]).unlock;
    expect(planned).toMatchObject({
      direction: 'recall',
      slot: 0,
      front: [{ field: 'translation', value: 'care' }],
      back: [{ field: 'term', value: 'Sorgfalt' }],
    });
  });

  it('never opens a direction that already has a Card, however it got there', () => {
    const result = progress([card('recognition', 30), card('recall', null)]);
    expect(result.unlock).toEqual([]);
    expect(kinds(result)['recall']).toBe('open');
  });

  it('respects a direction opened by hand out of order', () => {
    // Typing opened manually; recall still opens from recognition.
    const result = progress([card('recognition', 15), card('production', null)]);
    expect(result.unlock.map((c) => c.direction)).toEqual(['recall']);
    expect(kinds(result)['production']).toBe('open');
  });

  it('holds the next rung while the preceding direction is set aside', () => {
    const result = progress([card('recognition', 90, { suspended: true })]);
    expect(result.unlock).toEqual([]);
    expect(result.directions[1]).toMatchObject({ kind: 'paused', reason: 'suspended' });
  });

  it('opens nothing for a Note that is not in Study', () => {
    const result = progress([card('recognition', 90)], { active: false });
    expect(result.unlock).toEqual([]);
    expect(result.directions[1]).toMatchObject({ kind: 'paused', reason: 'inactive' });
  });

  it('waits for an answered predecessor after a reset', () => {
    const result = progress([card('recognition', null), card('recall', null)]);
    expect(result.unlock).toEqual([]);
    expect(result.directions[2]).toMatchObject({ kind: 'next', stability: null });
  });

  it('keeps a direction already opened when its predecessor later lapses', () => {
    // The lapse lowers recognition; recall is open and stays open.
    expect(kinds(progress([card('recognition', 2), card('recall', 5)]))['recall']).toBe('open');
  });
});

describe('note type differences', () => {
  it('skips a rung a Basic Note cannot produce', () => {
    const result = progress([card('recognition', 30), card('recall', 400)], { type: 'basic' });
    expect(result.unlock).toEqual([]);
    expect(result.directions.map((status) => status.direction)).toEqual(['recognition', 'recall']);
  });

  it('follows the nearest producible rung when one in the middle is skipped', () => {
    const ladder: LadderStep[] = [
      { direction: 'recognition', opensAtStability: 0 },
      { direction: 'production', opensAtStability: 21 },
      { direction: 'recall', opensAtStability: 10 },
    ];
    const basic = progress([card('recognition', 10)], { type: 'basic', ladder });
    expect(basic.unlock.map((c) => c.direction)).toEqual(['recall']);
    expect(basic.directions[1]).toMatchObject({ after: 'recognition', threshold: 10 });
  });

  it('gives a Cloze Note nothing to progress to', () => {
    const result = directionProgress({
      noteType: 'cloze',
      fields: { text: 'Ich {{stehe}} früh {{auf}}.' },
      ladder: LADDER,
      cards: [
        { direction: 'cloze', slot: 1, state: 'review', stability: 90, suspended: false },
        { direction: 'cloze', slot: 2, state: 'review', stability: 90, suspended: false },
      ],
      active: true,
    });
    expect(result.unlock).toEqual([]);
    expect(result.directions).toEqual([
      { kind: 'open', direction: 'cloze', suspended: false, answered: true },
    ]);
  });

  it('follows the fallback opening direction when the ladder shares none with the type', () => {
    const ladder: LadderStep[] = [
      { direction: 'listening', opensAtStability: 0 },
      { direction: 'recall', opensAtStability: 7 },
    ];
    const result = progress([card('recognition', 7)], { type: 'basic', ladder });
    expect(result.unlock.map((c) => c.direction)).toEqual(['recall']);
  });
});

describe('ladder shapes from the Deck skill switches', () => {
  it('treats a direction switched on as opening, never as progression', () => {
    const ladder: LadderStep[] = [
      { direction: 'recognition', opensAtStability: 0 },
      { direction: 'recall', opensAtStability: 14 },
      { direction: 'production', opensAtStability: 21 },
      { direction: 'listening', opensAtStability: 0 },
    ];
    const result = progress([card('recognition', 1)], { ladder });
    expect(kinds(result)['listening']).toBe('manual');
    expect(result.unlock).toEqual([]);
  });

  it('uses the first rung for a direction listed twice', () => {
    const ladder: LadderStep[] = [
      { direction: 'recognition', opensAtStability: 0 },
      { direction: 'recall', opensAtStability: 3 },
      { direction: 'recall', opensAtStability: 300 },
    ];
    expect(progress([card('recognition', 3)], { ladder }).unlock).toHaveLength(1);
  });

  it('knows a ladder without later rungs never progresses', () => {
    expect(ladderProgresses(LADDER)).toBe(true);
    expect(ladderProgresses([{ direction: 'recognition', opensAtStability: 0 }])).toBe(false);
  });
});

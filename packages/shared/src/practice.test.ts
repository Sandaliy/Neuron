import { describe, expect, it } from 'vitest';

import {
  advancePractice,
  reconcilePractice,
  practiceRunSchema,
  practiceValue,
  hasPracticeSide,
  isPracticeRunConsistent,
} from './practice.js';

import { uuidV7 } from './index.js';

const notes = [1, 2, 3].map((n) => ({ id: uuidV7(), fields: { front: `Q${n}`, back: `A${n}` } }));
const start = {
  kind: 'start' as const,
  id: uuidV7(),
  runId: uuidV7(),
  expectedVersion: 0,
  front: 'front' as const,
  back: 'back' as const,
};
describe('durable Practice rounds', () => {
  it('reconciles an inverse against live membership and rejects unrelated state changes', () => {
    const previous = advancePractice(null, start, notes);
    const run = advancePractice(
      previous,
      {
        kind: 'answer',
        id: uuidV7(),
        runId: previous.id,
        expectedVersion: 1,
        noteId: notes[0]!.id,
        known: true,
      },
      notes,
    );
    const undo = {
      kind: 'undo' as const,
      id: uuidV7(),
      runId: run.id,
      expectedVersion: 2,
      previous,
    };
    const survivors = [notes[0]!, notes[2]!];
    expect(advancePractice(run, undo, survivors)).toEqual(reconcilePractice(previous, survivors));
    expect(() =>
      advancePractice(
        run,
        {
          ...undo,
          previous: { ...previous, statuses: { ...previous.statuses, [notes[2]!.id]: 'known' } },
        },
        notes,
      ),
    ).toThrow('Practice position changed');
    expect(() =>
      advancePractice(run, { ...undo, previous: { ...previous, id: uuidV7() } }, notes),
    ).toThrow('Practice run changed');
  });
  it('rewinds classifications and exact queue order repeatedly through completion and rounds', () => {
    let run = advancePractice(null, start, notes);
    const history: (typeof run)[] = [];
    const decide = (known: boolean) => {
      history.push(run);
      run = advancePractice(
        run,
        {
          kind: 'answer',
          id: uuidV7(),
          runId: run.id,
          expectedVersion: 1,
          noteId: run.queue[0]!,
          known,
        },
        notes,
      );
    };
    expect(Object.values(run.statuses).filter((status) => status !== 'unseen')).toHaveLength(0);
    decide(false);
    decide(true);
    decide(true);
    run = advancePractice(
      run,
      { kind: 'round', id: uuidV7(), runId: run.id, expectedVersion: 1 },
      notes,
    );
    decide(false);
    expect(Object.values(run.statuses).filter((status) => status === 'learning')).toHaveLength(1);
    run = advancePractice(
      run,
      { kind: 'round', id: uuidV7(), runId: run.id, expectedVersion: 1 },
      notes,
    );
    decide(true);
    expect(Object.values(run.statuses)).toEqual(['known', 'known', 'known']);
    while (history.length) {
      const previous = history.pop()!;
      run = advancePractice(
        run,
        { kind: 'undo', id: uuidV7(), runId: run.id, expectedVersion: 1, previous },
        notes,
      );
      expect(run).toEqual(previous);
    }
    expect(run).toEqual(advancePractice(null, start, notes));
  });
  it('keeps scalar runs compatible and requires every populated field in a composed side', () => {
    const legacy = advancePractice(null, start, notes);
    expect(practiceRunSchema.parse(legacy)).toEqual(legacy);
    const word = {
      id: uuidV7(),
      fields: {
        term: 'Haus',
        translation: 'house',
        grammar: { article: 'das', plural: 'Häuser', separable: false },
      },
    };
    const run = advancePractice(
      null,
      { ...start, front: 'translation', back: ['grammar.article', 'term', 'grammar.plural'] },
      [word, { id: uuidV7(), fields: { term: 'empty', translation: 'missing grammar' } }],
    );
    expect(run.queue).toEqual([word.id]);
    expect(practiceValue(word.fields, 'grammar.separable')).toBe(false);
    expect(hasPracticeSide(word.fields, ['term', 'grammar.pastSimple'])).toBe(false);
    expect(() =>
      advancePractice(
        null,
        { ...start, front: ['term', 'grammar.article'], back: ['grammar.article', 'term'] },
        [word],
      ),
    ).toThrow();
  });
  it('visits unseen first, repeats only learning, and retains completion', () => {
    let run = advancePractice(null, start, notes);
    for (const [index, note] of notes.entries())
      run = advancePractice(
        run,
        {
          kind: 'answer',
          id: uuidV7(),
          runId: run.id,
          expectedVersion: index + 1,
          noteId: note.id,
          known: index !== 0,
        },
        notes,
      );
    expect(run.queue).toEqual([]);
    run = advancePractice(
      run,
      { kind: 'round', id: uuidV7(), runId: run.id, expectedVersion: 4 },
      notes,
    );
    expect(run.queue).toEqual([notes[0]!.id]);
    run = advancePractice(
      run,
      {
        kind: 'answer',
        id: uuidV7(),
        runId: run.id,
        expectedVersion: 5,
        noteId: notes[0]!.id,
        known: true,
      },
      notes,
    );
    expect(reconcilePractice(run, notes)).toEqual(run);
    expect(Object.values(run.statuses)).toEqual(['known', 'known', 'known']);
  });
  it('preserves survivors, removes missing notes, and admits new material as unseen', () => {
    let run = advancePractice(null, start, notes);
    run = advancePractice(
      run,
      {
        kind: 'answer',
        id: uuidV7(),
        runId: run.id,
        expectedVersion: 1,
        noteId: notes[0]!.id,
        known: true,
      },
      notes,
    );
    const added = { id: uuidV7(), fields: { front: 'New', back: 'Answer' } };
    run = reconcilePractice(run, [notes[0]!, notes[2]!, added]);
    expect(run.statuses[notes[0]!.id]).toBe('known');
    expect(run.statuses[notes[1]!.id]).toBeUndefined();
    expect(run.queue).toEqual([notes[2]!.id, added.id]);
    const changed = advancePractice(
      run,
      { ...start, runId: uuidV7(), front: 'back', back: 'front' },
      notes,
    );
    expect(Object.values(changed.statuses)).toEqual(['unseen', 'unseen', 'unseen']);
  });
});

describe('Practice delivered after time away', () => {
  const answer = (run: ReturnType<typeof advancePractice>, noteId: string, known = true) => ({
    kind: 'answer' as const,
    id: uuidV7(),
    runId: run.id,
    expectedVersion: 1,
    noteId,
    known,
  });
  it('skips a classification, and its Undo, for a Note that left the pool elsewhere', () => {
    const run = advancePractice(null, start, notes);
    const survivors = notes.slice(1);
    const skipped = advancePractice(run, answer(run, notes[0]!.id), survivors);
    expect(skipped).toEqual(reconcilePractice(run, survivors));
    const next = advancePractice(skipped, answer(skipped, notes[1]!.id, false), survivors);
    expect(next.statuses[notes[1]!.id]).toBe('learning');
    const undo = {
      kind: 'undo' as const,
      id: uuidV7(),
      runId: run.id,
      expectedVersion: 2,
      previous: run,
    };
    expect(advancePractice(next, undo, survivors)).toEqual(next);
  });
  it('still refuses a classification out of order for a Note that remains', () => {
    const run = advancePractice(null, start, notes);
    expect(() => advancePractice(run, answer(run, notes[1]!.id), notes)).toThrow(
      'Practice position changed',
    );
  });
  it('replaces a run only with a consistent one, reconciled to the live pool', () => {
    const run = advancePractice(null, start, notes);
    const progressed = advancePractice(run, answer(run, notes[0]!.id), notes);
    const replace = {
      kind: 'replace' as const,
      id: uuidV7(),
      runId: progressed.id,
      expectedVersion: 4,
      run: progressed,
    };
    expect(advancePractice(null, replace, notes)).toEqual(progressed);
    expect(advancePractice(run, replace, notes.slice(1))).toEqual(
      reconcilePractice(progressed, notes.slice(1)),
    );
    expect(isPracticeRunConsistent(progressed)).toBe(true);
    for (const broken of [
      { ...progressed, queue: [...progressed.queue, progressed.queue[0]!] },
      { ...progressed, queue: [notes[0]!.id, ...progressed.queue] },
      { ...progressed, queue: [uuidV7()] },
      { ...progressed, back: progressed.front },
    ]) {
      expect(isPracticeRunConsistent(broken)).toBe(false);
      expect(() => advancePractice(run, { ...replace, run: broken }, notes)).toThrow();
    }
    expect(() => advancePractice(run, { ...replace, runId: uuidV7() }, notes)).toThrow();
  });
});

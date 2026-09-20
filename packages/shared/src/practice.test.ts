import { describe, expect, it } from 'vitest';

import {
  advancePractice,
  reconcilePractice,
  practiceRunSchema,
  practiceValue,
  hasPracticeSide,
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

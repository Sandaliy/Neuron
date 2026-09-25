import { z } from 'zod';

import { readField } from './note-fields.js';

import type { MessageKey } from './i18n/index.js';

export const practiceFieldSchema = z.enum([
  'term',
  'translation',
  'definition',
  'example',
  'front',
  'back',
  'text',
  'extra',
  'note',
  'reading',
  'exampleTranslation',
  'grammar.article',
  'grammar.plural',
  'grammar.gender',
  'grammar.praeteritum',
  'grammar.partizip2',
  'grammar.auxiliary',
  'grammar.separable',
  'grammar.reflexive',
  'grammar.case',
  'grammar.pattern',
  'grammar.comparative',
  'grammar.superlative',
  'grammar.pastSimple',
  'grammar.pastParticiple',
  'grammar.countability',
  'grammar.irregular',
  'grammar.uncountable',
  'grammar.variant',
]);
export type PracticeField = z.infer<typeof practiceFieldSchema>;
export const PRACTICE_FIELDS = practiceFieldSchema.options;
/** Old scalar field choices remain valid and unchanged; new sides may combine fields. */
const practiceSideSchema = z.union([
  practiceFieldSchema,
  z
    .array(practiceFieldSchema)
    .min(1)
    .max(6)
    .refine((fields) => new Set(fields).size === fields.length),
]);
export type PracticeSide = z.infer<typeof practiceSideSchema>;
export const practiceFields = (side: PracticeSide): PracticeField[] =>
  typeof side === 'string' ? [side] : side;
export const practiceFieldLabel = (field: PracticeField): MessageKey =>
  `note.field.${field.replace('grammar.', '')}` as MessageKey;
export function practiceValue(
  fields: Record<string, unknown>,
  field: PracticeField,
): string | boolean | undefined {
  const value = readField(fields, field);
  return typeof value === 'boolean'
    ? value
    : typeof value === 'string' && value.trim()
      ? value
      : undefined;
}
export function hasPracticeSide(fields: Record<string, unknown>, side: PracticeSide): boolean {
  return practiceFields(side).every((field) => practiceValue(fields, field) !== undefined);
}
export function samePracticeSides(front: PracticeSide, back: PracticeSide): boolean {
  return [...practiceFields(front)].sort().join('|') === [...practiceFields(back)].sort().join('|');
}
export const practiceResponseSchema = z.enum(['reveal', 'typing', 'listening']);
export type PracticeResponse = z.infer<typeof practiceResponseSchema>;
export function supportsPracticeResponse(
  fields: Record<string, unknown>,
  front: PracticeSide,
  back: PracticeSide,
  response: PracticeResponse = 'reveal',
): boolean {
  if (!hasPracticeSide(fields, front) || !hasPracticeSide(fields, back)) return false;
  if (response === 'listening')
    return practiceFields(front).length === 1 && practiceFields(front)[0] === 'term';
  if (response === 'typing') {
    const selected = practiceFields(back);
    const value = selected.length === 1 ? practiceValue(fields, selected[0]!) : undefined;
    return typeof value === 'string' && value.length <= 200 && !value.includes('\n');
  }
  return true;
}
export const practiceRunSchema = z.object({
  id: z.uuid(),
  front: practiceSideSchema,
  back: practiceSideSchema,
  response: practiceResponseSchema.optional(),
  statuses: z.record(z.string(), z.enum(['unseen', 'learning', 'known'])),
  queue: z.array(z.string()),
  round: z.number().int().positive(),
});
export type PracticeRun = z.infer<typeof practiceRunSchema>;
export const practiceCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('start'),
    id: z.uuid(),
    expectedVersion: z.number().int().nonnegative(),
    runId: z.uuid(),
    front: practiceSideSchema,
    back: practiceSideSchema,
    response: practiceResponseSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal('answer'),
    id: z.uuid(),
    expectedVersion: z.number().int().nonnegative(),
    runId: z.uuid(),
    noteId: z.uuid(),
    known: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal('round'),
    id: z.uuid(),
    expectedVersion: z.number().int().nonnegative(),
    runId: z.uuid(),
  }),
]);
export type PracticeCommand = z.infer<typeof practiceCommandSchema>;
export interface PracticeNote {
  readonly id: string;
  readonly fields: Record<string, unknown>;
}
export function reconcilePractice(run: PracticeRun, notes: readonly PracticeNote[]): PracticeRun {
  const eligible = notes.filter((n) =>
    supportsPracticeResponse(n.fields, run.front, run.back, run.response),
  );
  const ids = new Set(eligible.map((n) => n.id));
  const added = eligible.filter((n) => !run.statuses[n.id]).map((n) => n.id);
  return {
    ...run,
    statuses: Object.fromEntries(eligible.map((n) => [n.id, run.statuses[n.id] ?? 'unseen'])),
    queue: [...run.queue.filter((id) => ids.has(id)), ...added],
  };
}
/** Pure product state. No scheduling or review dependency. */
export function advancePractice(
  run: PracticeRun | null,
  command: PracticeCommand,
  notes: readonly PracticeNote[],
): PracticeRun {
  if (command.kind === 'start') {
    if (samePracticeSides(command.front, command.back)) throw new Error('Choose different fields');
    return reconcilePractice(
      {
        id: command.runId,
        front: command.front,
        back: command.back,
        ...(command.response ? { response: command.response } : {}),
        statuses: {},
        queue: [],
        round: 1,
      },
      notes,
    );
  }
  if (!run || run.id !== command.runId) throw new Error('Practice run changed');
  const current = reconcilePractice(run, notes);
  if (command.kind === 'round') {
    if (current.queue.length) throw new Error('Round is unfinished');
    return {
      ...current,
      round: current.round + 1,
      queue: Object.keys(current.statuses).filter((id) => current.statuses[id] !== 'known'),
    };
  }
  if (current.queue[0] !== command.noteId) throw new Error('Practice position changed');
  return {
    ...current,
    statuses: { ...current.statuses, [command.noteId]: command.known ? 'known' : 'learning' },
    queue: current.queue.slice(1),
  };
}
export const practiceResultSchema = z.object({
  run: practiceRunSchema.nullable(),
  version: z.number().int().nonnegative(),
});
export const restartLearningSchema = z.strictObject({ id: z.uuid() });

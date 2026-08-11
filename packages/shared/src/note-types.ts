import { z } from 'zod';

import type { CardDirection } from '@neuron/core';

/**
 * What a note holds, and which cards it can produce.
 *
 * A note is the fact. A card is one direction of asking about it. Three built
 * in types cover everything the first version needs: a foreign word, a plain
 * question, and a text with a gap in it.
 *
 * The database stores the fields of a note as one jsonb value, which Postgres
 * will happily accept in any shape at all. The guarantee that a `vocab` note
 * really has a term and a translation comes from here, applied in the
 * repository layer before every write. Nothing else writes to that table.
 */

/** The built in note types. */
export const NOTE_TYPES = ['vocab', 'basic', 'cloze'] as const;

export const noteTypeSchema = z.enum(NOTE_TYPES);

export type NoteTypeName = z.infer<typeof noteTypeSchema>;

/** Everything a note can be in, and whether it is being studied. */
export const NOTE_STATUSES = ['active', 'known', 'suspended', 'draft'] as const;

export const noteStatusSchema = z.enum(NOTE_STATUSES);

export type NoteStatus = z.infer<typeof noteStatusSchema>;

/** A field the editor has to render, and whether a note is valid without it. */
export interface NoteFieldDefinition {
  readonly name: string;
  readonly required: boolean;
  /** Rendered as a text area rather than a single line. */
  readonly multiline: boolean;
}

/** One way of asking about a note, and what it needs in order to be possible. */
export interface CardTemplate {
  readonly direction: CardDirection;
  /** Shown on the front. */
  readonly ask: readonly string[];
  /** Expected as the answer. */
  readonly answer: readonly string[];
  /** Fields that have to be filled in before this card can exist. */
  readonly requires: readonly string[];
}

const trimmed = z.string().trim();

/** A field that has to be there and cannot be blank. */
const required = trimmed.min(1);

/**
 * A field that may be absent, but may not be present and empty.
 *
 * The distinction matters for the editor: a field cleared by the user should be
 * dropped rather than stored as an empty string, otherwise "has a definition"
 * becomes true for a note whose definition is nothing at all.
 */
const optional = required.optional();

const grammarSchema = z
  .strictObject({
    /** der, die, das. */
    article: optional,
    plural: optional,
    /** Principal parts, for a verb. */
    verbForms: optional,
  })
  .optional();

const vocabFieldsSchema = z.strictObject({
  term: required,
  reading: optional,
  translation: required,
  definition: optional,
  example: optional,
  exampleTranslation: optional,
  partOfSpeech: optional,
  grammar: grammarSchema,
  mnemonic: optional,
  image: optional,
  audio: optional,
  note: optional,
});

const basicFieldsSchema = z.strictObject({
  front: required,
  back: required,
  note: optional,
  image: optional,
});

/** A gap, written as {{like this}}. */
const CLOZE_GAP = /\{\{[^{}]+\}\}/;

const clozeFieldsSchema = z.strictObject({
  text: required.refine(
    (value) => CLOZE_GAP.test(value),
    'needs at least one gap, written as {{the hidden part}}',
  ),
  note: optional,
  image: optional,
});

/** The schema for each type, keyed by the name stored on the note row. */
export const noteFieldsSchemas = {
  vocab: vocabFieldsSchema,
  basic: basicFieldsSchema,
  cloze: clozeFieldsSchema,
} as const;

export type VocabFields = z.infer<typeof vocabFieldsSchema>;
export type BasicFields = z.infer<typeof basicFieldsSchema>;
export type ClozeFields = z.infer<typeof clozeFieldsSchema>;

/** The fields of a note, narrowed by its type. */
export type NoteFields = VocabFields | BasicFields | ClozeFields;

/**
 * The fields each type has, in the order an editor should show them.
 *
 * Derived by hand rather than read out of the Zod schema, because the order is
 * an interface decision and the schema has no opinion about it. The test keeps
 * the two in step.
 */
export const NOTE_TYPE_FIELDS: Record<NoteTypeName, readonly NoteFieldDefinition[]> = {
  vocab: [
    { name: 'term', required: true, multiline: false },
    { name: 'reading', required: false, multiline: false },
    { name: 'translation', required: true, multiline: false },
    { name: 'definition', required: false, multiline: true },
    { name: 'example', required: false, multiline: true },
    { name: 'exampleTranslation', required: false, multiline: true },
    { name: 'partOfSpeech', required: false, multiline: false },
    { name: 'grammar', required: false, multiline: false },
    { name: 'mnemonic', required: false, multiline: true },
    { name: 'image', required: false, multiline: false },
    { name: 'audio', required: false, multiline: false },
    { name: 'note', required: false, multiline: true },
  ],
  basic: [
    { name: 'front', required: true, multiline: true },
    { name: 'back', required: true, multiline: true },
    { name: 'note', required: false, multiline: true },
    { name: 'image', required: false, multiline: false },
  ],
  cloze: [
    { name: 'text', required: true, multiline: true },
    { name: 'note', required: false, multiline: true },
    { name: 'image', required: false, multiline: false },
  ],
};

/**
 * The cards each type can produce.
 *
 * `requires` is what makes a template conditional: a listening card is only
 * possible once the note has audio, so a vocab note without it produces four
 * templates and three cards. Which of these are actually created is a deck
 * setting, and the ladder that opens them one at a time is the scheduler's
 * business, not this file's.
 */
export const NOTE_TYPE_TEMPLATES: Record<NoteTypeName, readonly CardTemplate[]> = {
  vocab: [
    { direction: 'recognition', ask: ['term'], answer: ['translation'], requires: [] },
    { direction: 'recall', ask: ['translation'], answer: ['term'], requires: [] },
    { direction: 'production', ask: ['translation'], answer: ['term'], requires: [] },
    { direction: 'listening', ask: ['audio'], answer: ['term'], requires: ['audio'] },
  ],
  basic: [
    { direction: 'recognition', ask: ['front'], answer: ['back'], requires: [] },
    { direction: 'recall', ask: ['back'], answer: ['front'], requires: [] },
  ],
  cloze: [{ direction: 'cloze', ask: ['text'], answer: ['text'], requires: [] }],
};

/**
 * Checks the fields of a note against its type.
 *
 * @param type which type the note claims to be
 * @param fields the fields as they arrived
 * @returns the parsed fields, with blank values dropped
 * @throws ZodError listing every field that is wrong
 */
export function parseNoteFields(type: NoteTypeName, fields: unknown): NoteFields {
  return noteFieldsSchemas[type].parse(fields);
}

/**
 * The templates a note can actually produce, given what is filled in.
 *
 * @param type which type the note is
 * @param fields the fields of the note
 * @returns the templates whose requirements are met
 */
export function templatesFor(type: NoteTypeName, fields: NoteFields): readonly CardTemplate[] {
  const present = new Set(
    Object.entries(fields)
      .filter(([, value]) => value !== undefined && value !== '')
      .map(([name]) => name),
  );

  return NOTE_TYPE_TEMPLATES[type].filter((template) =>
    template.requires.every((name) => present.has(name)),
  );
}

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

/**
 * What kind of word this is, which decides what grammar it needs.
 *
 * A closed list, and the same one the generation prompt is told to use, so a
 * generated note and a typed one describe a noun with the same word. Anything
 * that does not fit is `other`, which asks for no grammar at all.
 */
export const PARTS_OF_SPEECH = ['noun', 'verb', 'adjective', 'adverb', 'phrase', 'other'] as const;

export const partOfSpeechSchema = z.enum(PARTS_OF_SPEECH);

export type PartOfSpeech = z.infer<typeof partOfSpeechSchema>;

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

/**
 * Everything a word carries that is not its meaning.
 *
 * One flat object rather than one shape per language. The alternative is a
 * union keyed on a field the note does not have to fill in, and a person who
 * studies German and English wants both sets available without the note
 * changing type. Which of these the editor shows is decided in note-fields.ts,
 * from the part of speech and the deck language. Every one is optional: a word
 * that names none is a word with nothing to memorise beyond its meaning, which
 * is most of them.
 */
const grammarSchema = z
  .strictObject({
    /** A German noun: der, die, das, and the rest of what has to be learned. */
    article: optional,
    plural: optional,
    gender: z.enum(['m', 'f', 'n']).optional(),

    /** A German verb. */
    praeteritum: optional,
    partizip2: optional,
    auxiliary: z.enum(['haben', 'sein']).optional(),
    separable: z.boolean().optional(),
    /** The case it governs, when that is not the plain accusative. */
    case: z.enum(['accusative', 'dative', 'genitive']).optional(),
    reflexive: z.boolean().optional(),

    /** A German adjective, when its comparison is irregular. */
    comparative: optional,
    superlative: optional,

    /** English. */
    variant: z.enum(['BrE', 'AmE']).optional(),
    /** The principal parts of an irregular verb, as "went / gone". */
    irregular: optional,
    uncountable: z.boolean().optional(),
  })
  .optional();

const vocabFieldsSchema = z.strictObject({
  term: required,
  reading: optional,
  translation: required,
  definition: optional,
  example: optional,
  exampleTranslation: optional,
  partOfSpeech: partOfSpeechSchema.optional(),
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

/**
 * A gap, written as {{like this}} or, from Anki, as {{c1::like this}}.
 *
 * Two gaps sharing a number are hidden by the same card. Bare gaps are numbered
 * in the order they appear, so a sentence with three of them makes three cards
 * without anybody having to number anything.
 */
const CLOZE_GAP = String.raw`\{\{(?:c(\d+)::)?([^{}]+?)(?:::([^{}]+?))?\}\}`;

/**
 * A fresh matcher every time.
 *
 * A shared global regular expression carries `lastIndex` between calls, and
 * both `test` and `matchAll` read it. One shared object meant that checking
 * whether a text had a gap left the position past the first one, and reading
 * the gaps immediately afterwards started from there and lost it. Three gaps
 * came out as two cards, and only when the two functions were called in that
 * order, which is exactly the order the api calls them in.
 */
function gapPattern(): RegExp {
  return new RegExp(CLOZE_GAP, 'g');
}

/** Whether a text has at least one gap in it. */
export function hasClozeGap(text: string): boolean {
  return gapPattern().test(text);
}

const clozeFieldsSchema = z.strictObject({
  text: required.refine(hasClozeGap, 'needs at least one gap, written as {{the hidden part}}'),
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

/** Everything a word carries that is not its meaning. */
export type NoteGrammar = NonNullable<VocabFields['grammar']>;

/** The fields of a note, narrowed by its type. */
export type NoteFields = VocabFields | BasicFields | ClozeFields;

/** One gap in a cloze text, and where it sits. */
export interface ClozeGap {
  /** Which card hides it. Gaps sharing a number are hidden together. */
  readonly number: number;
  /** What is hidden. */
  readonly answer: string;
  /** Shown in place of the answer, when the author wrote one. */
  readonly hint: string | undefined;
  readonly start: number;
  readonly end: number;
}

/**
 * Reads the gaps out of a cloze text.
 *
 * @param text the text as the author wrote it
 * @returns every gap, in the order it appears
 */
export function clozeGaps(text: string): ClozeGap[] {
  const gaps: ClozeGap[] = [];
  let unnumbered = 0;

  for (const match of text.matchAll(gapPattern())) {
    const [whole, numbered, answer, hint] = match;

    // A bare gap takes the next number, counting only the bare ones. Mixing the
    // two forms in one text is unusual, and it should not make two gaps collide.
    const number = numbered === undefined ? ++unnumbered : Number(numbered);

    gaps.push({
      number,
      answer: (answer ?? '').trim(),
      hint: hint?.trim(),
      start: match.index,
      end: match.index + whole.length,
    });
  }

  return gaps;
}

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

/** One field of a type, as the database records it. */
export interface NoteFieldSummary {
  readonly name: string;
  readonly required: boolean;
}

/**
 * The fields of a type, read out of its schema.
 *
 * Derived rather than written out, because it is stored on the `note_types`
 * row and a second hand written list is a second thing to keep in step. What
 * the editor draws is a different and conditional question, answered in
 * note-fields.ts; this is the flat truth about what the type can hold.
 *
 * @param type which type
 * @returns every field, and whether the type is valid without it
 */
export function noteFieldSummary(type: NoteTypeName): NoteFieldSummary[] {
  return Object.entries(noteFieldsSchemas[type].shape).map(([name, schema]) => ({
    name,
    required: !schema.safeParse(undefined).success,
  }));
}

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

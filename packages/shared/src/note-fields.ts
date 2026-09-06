import type { MessageKey } from './i18n/index.js';
import type { LanguageCode } from './languages.js';
import type { NoteTypeName, PartOfSpeech } from './note-types.js';

/**
 * Which fields the editor draws, and when.
 *
 * A vocab note has a field for the case a verb governs and a field for a
 * noun's plural, and showing both to somebody typing an adverb is how an
 * editor becomes a wall. So the list is conditional: on the type, on the part
 * of speech, and on the language the deck is about.
 *
 * Two rules, and the second one is the one that is usually forgotten. Show a
 * field only when it applies, so a word with no grammar renders no grammar
 * block at all rather than an empty one. And never hide a field somebody has
 * already filled in, whatever the conditions say now, because a value that
 * disappears from the screen while it is still in the database is a value
 * nobody can find or correct.
 *
 * Here rather than in the editor so the importer, the tests and the gallery
 * ask the same question and get the same answer.
 */

/** How the editor draws one field. */
export type FieldKind = 'text' | 'multiline' | 'choice' | 'toggle';

/** One option of a choice. Language data labels itself. */
export interface FieldOption {
  readonly value: string;
  /** Absent when the value is the label: der, haben, BrE. */
  readonly labelKey?: MessageKey;
}

export interface EditorField {
  /** Where the value lives on the note: `term`, or `grammar.article`. */
  readonly path: string;
  readonly kind: FieldKind;
  readonly required: boolean;
  readonly labelKey: MessageKey;
  readonly hintKey?: MessageKey;
  readonly options?: readonly FieldOption[];
}

/** A block of fields with one heading, or none for the first block. */
export interface EditorSection {
  readonly name: 'main' | 'grammar' | 'extra';
  readonly labelKey?: MessageKey;
  readonly fields: readonly EditorField[];
}

/** What the editor knows when it asks which fields to draw. */
export interface FieldContext {
  readonly noteType: NoteTypeName;
  readonly partOfSpeech?: PartOfSpeech | undefined;
  /** The deck's target language, which decides which grammar is asked for. */
  readonly targetLanguage?: LanguageCode | undefined;
  /** Paths that already hold a value. These are never hidden. */
  readonly filled?: ReadonlySet<string> | undefined;
}

const text = (path: string, labelKey: MessageKey): EditorField => ({
  path,
  kind: 'text',
  required: false,
  labelKey,
});

const multiline = (path: string, labelKey: MessageKey): EditorField => ({
  path,
  kind: 'multiline',
  required: false,
  labelKey,
});

const toggle = (path: string, labelKey: MessageKey): EditorField => ({
  path,
  kind: 'toggle',
  required: false,
  labelKey,
});

const choice = (
  path: string,
  labelKey: MessageKey,
  options: readonly FieldOption[],
): EditorField => ({ path, kind: 'choice', required: false, labelKey, options });

const require = (field: EditorField): EditorField => ({ ...field, required: true });

const withHint = (field: EditorField, hintKey: MessageKey): EditorField => ({ ...field, hintKey });

const PART_OF_SPEECH_OPTIONS: readonly FieldOption[] = [
  { value: 'noun', labelKey: 'note.pos.noun' },
  { value: 'verb', labelKey: 'note.pos.verb' },
  { value: 'adjective', labelKey: 'note.pos.adjective' },
  { value: 'adverb', labelKey: 'note.pos.adverb' },
  { value: 'phrase', labelKey: 'note.pos.phrase' },
  { value: 'other', labelKey: 'note.pos.other' },
];

/**
 * The grammar a word needs, by language and by part of speech.
 *
 * German is the one this app is being built for, so it is the one written out.
 * A language with no entry asks for no grammar, which is the right answer until
 * somebody studies it and says what a word in it has to be learned with.
 */
const GRAMMAR: Partial<
  Record<LanguageCode, Partial<Record<PartOfSpeech, readonly EditorField[]>>>
> = {
  de: {
    noun: [
      choice('grammar.article', 'note.field.article', [
        { value: 'der' },
        { value: 'die' },
        { value: 'das' },
      ]),
      text('grammar.plural', 'note.field.plural'),
      choice('grammar.gender', 'note.field.gender', [
        { value: 'm', labelKey: 'note.gender.m' },
        { value: 'f', labelKey: 'note.gender.f' },
        { value: 'n', labelKey: 'note.gender.n' },
      ]),
    ],
    verb: [
      text('grammar.praeteritum', 'note.field.praeteritum'),
      text('grammar.partizip2', 'note.field.partizip2'),
      choice('grammar.auxiliary', 'note.field.auxiliary', [{ value: 'haben' }, { value: 'sein' }]),
      toggle('grammar.separable', 'note.field.separable'),
      withHint(
        choice('grammar.case', 'note.field.case', [
          { value: 'accusative', labelKey: 'note.case.accusative' },
          { value: 'dative', labelKey: 'note.case.dative' },
          { value: 'genitive', labelKey: 'note.case.genitive' },
        ]),
        'note.hint.case',
      ),
      toggle('grammar.reflexive', 'note.field.reflexive'),
    ],
    adjective: [
      withHint(text('grammar.comparative', 'note.field.comparative'), 'note.hint.comparison'),
      text('grammar.superlative', 'note.field.superlative'),
    ],
  },
  en: {
    noun: [toggle('grammar.uncountable', 'note.field.uncountable')],
    verb: [withHint(text('grammar.irregular', 'note.field.irregular'), 'note.hint.irregular')],
  },
};

/** The fields English asks for whatever the part of speech is. */
const ENGLISH_ANY: readonly EditorField[] = [
  choice('grammar.variant', 'note.field.variant', [{ value: 'BrE' }, { value: 'AmE' }]),
];

/** Every grammar field there is, for deciding whether a filled one is grammar. */
const ALL_GRAMMAR: readonly EditorField[] = [
  ...Object.values(GRAMMAR).flatMap((byPart) => Object.values(byPart).flat()),
  ...ENGLISH_ANY,
];

function grammarFor(context: FieldContext): EditorField[] {
  const filled = context.filled ?? new Set<string>();
  const language = context.targetLanguage;
  const part = context.partOfSpeech;

  const applies =
    language === undefined
      ? []
      : [
          ...(part === undefined ? [] : (GRAMMAR[language]?.[part] ?? [])),
          ...(language === 'en' ? ENGLISH_ANY : []),
        ];

  const shown = new Set(applies.map((field) => field.path));

  // Anything already written down stays on screen, whatever the part of speech
  // says now. Changing a word from a noun to a verb must not make its plural
  // invisible while it is still stored.
  const kept = ALL_GRAMMAR.filter((field) => filled.has(field.path) && !shown.has(field.path));

  return [...applies, ...kept];
}

/**
 * The fields to draw for one note.
 *
 * @param context the type, the part of speech, the deck language, and what is
 *   already filled in
 * @returns the sections, each with its fields, in the order they are shown
 */
export function editorFields(context: FieldContext): EditorSection[] {
  const filled = context.filled ?? new Set<string>();

  if (context.noteType === 'basic') {
    return [
      {
        name: 'main',
        fields: [
          require(multiline('front', 'note.field.front')),
          require(multiline('back', 'note.field.back')),
        ],
      },
      {
        name: 'extra',
        labelKey: 'note.section.extra',
        fields: [multiline('note', 'note.field.note'), imageField()],
      },
    ];
  }

  if (context.noteType === 'cloze') {
    return [
      {
        name: 'main',
        fields: [require(withHint(multiline('text', 'note.field.text'), 'note.hint.cloze'))],
      },
      {
        name: 'extra',
        labelKey: 'note.section.extra',
        fields: [multiline('note', 'note.field.note'), imageField()],
      },
    ];
  }

  const grammar = grammarFor(context);
  const reading = withHint(
    text('reading', 'note.field.reading'),
    context.targetLanguage === 'en' ? 'note.hint.readingIpa' : 'note.hint.reading',
  );

  const sections: EditorSection[] = [
    {
      name: 'main',
      fields: [
        require(text('term', 'note.field.term')),
        choice('partOfSpeech', 'note.field.partOfSpeech', PART_OF_SPEECH_OPTIONS),
        reading,
        require(text('translation', 'note.field.translation')),
        multiline('definition', 'note.field.definition'),
        withHint(multiline('example', 'note.field.example'), 'note.hint.example'),
        multiline('exampleTranslation', 'note.field.exampleTranslation'),
      ],
    },
  ];

  if (grammar.length > 0) {
    sections.push({ name: 'grammar', labelKey: 'note.section.grammar', fields: grammar });
  }

  sections.push({
    name: 'extra',
    labelKey: 'note.section.extra',
    fields: [
      withHint(multiline('mnemonic', 'note.field.mnemonic'), 'note.hint.mnemonic'),
      multiline('note', 'note.field.note'),
      imageField(),
      // Nothing writes audio yet, and a listening card needs it. It shows once
      // there is one rather than sitting empty on every word.
      ...(filled.has('audio') ? [text('audio', 'note.field.audio')] : []),
    ],
  });

  return sections;
}

function imageField(): EditorField {
  return withHint(text('image', 'note.field.image'), 'note.hint.image');
}

/**
 * Reads one field off a note, following a dotted path.
 *
 * @param fields the note's fields
 * @param path `term`, or `grammar.article`
 * @returns the value, or undefined when nothing is there
 */
export function readField(fields: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, part) => {
    if (typeof value !== 'object' || value === null) {
      return undefined;
    }

    return (value as Record<string, unknown>)[part];
  }, fields);
}

/**
 * Writes one field onto a copy of a note's fields.
 *
 * An empty string removes the field rather than storing it, because the schema
 * refuses a present but blank value: "has a definition" must not be true for a
 * note whose definition is nothing at all.
 *
 * @param fields the note's fields
 * @param path `term`, or `grammar.article`
 * @param value what to put there
 * @returns a new object, the original untouched
 */
export function writeField(
  fields: Record<string, unknown>,
  path: string,
  value: string | boolean | undefined,
): Record<string, unknown> {
  const [head, tail] = path.split('.');

  if (head === undefined) {
    return fields;
  }

  const empty = value === undefined || value === '' || value === false;

  if (tail === undefined) {
    const next = { ...fields };

    if (empty) {
      delete next[head];
    } else {
      next[head] = value;
    }

    return next;
  }

  const current = fields[head];
  const nested = {
    ...((typeof current === 'object' && current !== null ? current : {}) as Record<
      string,
      unknown
    >),
  };

  if (empty) {
    delete nested[tail];
  } else {
    nested[tail] = value;
  }

  const next = { ...fields };

  // An empty grammar object is not the same as no grammar object: the first
  // one makes every note carry `"grammar": {}` for ever.
  if (Object.keys(nested).length === 0) {
    delete next[head];
  } else {
    next[head] = nested;
  }

  return next;
}

/** Every path on a note that currently holds something. */
export function filledPaths(fields: unknown): Set<string> {
  const paths = new Set<string>();

  if (typeof fields !== 'object' || fields === null) {
    return paths;
  }

  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined || value === '' || value === null) {
      continue;
    }

    if (typeof value === 'object') {
      for (const [inner, nested] of Object.entries(value as Record<string, unknown>)) {
        if (nested !== undefined && nested !== '' && nested !== null) {
          paths.add(`${name}.${inner}`);
        }
      }

      continue;
    }

    paths.add(name);
  }

  return paths;
}

import { noteFieldsSchemas } from './note-types.js';
import { exampleContainsTerm, noteTermKey, termOf } from './text.js';

import type { NoteTypeName } from './note-types.js';

/**
 * Reading a word list, whatever shape it arrived in.
 *
 * Four ways in, and they exist because the four are what people actually have.
 * JSON is the main path, produced by a model from the prompt in
 * docs/card-generation-prompt.md. CSV and TSV come out of a spreadsheet. Plain
 * text is what a list pasted out of a textbook looks like. An Anki export is a
 * tab separated file with HTML in it.
 *
 * Pure, and here rather than in the client, so five thousand rows can be run
 * through it in a test without a browser.
 */

export const IMPORT_FORMATS = ['json', 'csv', 'tsv', 'text', 'anki'] as const;

export type ImportFormat = (typeof IMPORT_FORMATS)[number];

/** One row as it was read, before anything has been decided about it. */
export interface ParsedRow {
  /** Where it was in the file, counting from one. */
  readonly line: number;
  readonly fields: Record<string, unknown>;
  readonly tags: readonly string[];
  readonly rank?: number | undefined;
  /** What the generator itself said was wrong with this row. */
  readonly issue?: string | undefined;
}

/** A whole file, read. */
export interface ParseResult {
  readonly format: ImportFormat;
  readonly noteType: NoteTypeName;
  readonly rows: readonly ParsedRow[];
  /** The columns of a table, for the mapping step. */
  readonly columns?: readonly string[];
  /** Rows that could not be read at all, and why. */
  readonly failures: readonly { readonly line: number; readonly reason: string }[];
  /** What the file said it was about, when it said. */
  readonly source?: string | undefined;
}

/**
 * What shape a pasted file is in.
 *
 * Guessed rather than asked, because a person pasting five thousand rows should
 * not have to answer a question they can see the answer to. The guess is shown
 * and can be overridden.
 *
 * @param text the file as it was pasted or read
 * @returns the format it looks like
 */
export function detectFormat(text: string): ImportFormat {
  const trimmed = stripFences(text).trim();

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return 'json';
  }

  const lines = trimmed.split('\n').filter((line) => line.trim() !== '');
  const first = lines[0] ?? '';

  // An Anki export announces itself in a comment before the first row.
  if (lines.some((line) => line.startsWith('#separator:') || line.startsWith('#html:'))) {
    return 'anki';
  }

  if (first.includes('\t')) {
    return 'tsv';
  }

  // A comma on most lines is a table. A comma on one line out of forty is a
  // list of words where somebody used one.
  const withCommas = lines.filter((line) => line.includes(',')).length;

  return withCommas > lines.length * 0.6 ? 'csv' : 'text';
}

/** Takes a model's ```json fence off, if it wrapped its answer in one. */
function stripFences(text: string): string {
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/.exec(text);

  return fenced?.[1] ?? text;
}

/**
 * Reads a file in whichever format it is.
 *
 * @param text the file
 * @param format which format to read it as
 * @param options the note type for a format that does not carry one, and the
 *   column mapping for a table
 * @returns the rows, and what could not be read
 */
export function parseImport(
  text: string,
  format: ImportFormat,
  options: {
    readonly noteType?: NoteTypeName;
    /** Which field each column holds, by column index. Empty means ignore it. */
    readonly columns?: readonly string[];
    /** Whether the first row of a table is a header. */
    readonly header?: boolean;
  } = {},
): ParseResult {
  switch (format) {
    case 'json': {
      return parseJson(text);
    }

    case 'csv':
    case 'tsv':
    case 'anki': {
      return parseTable(text, format, options);
    }

    default: {
      return parseText(text, options.noteType ?? 'vocab');
    }
  }
}

/** Everything the generation schema can put on a note, in the order it reads. */
export const IMPORT_FIELDS = [
  'term',
  'translation',
  'definition',
  'example',
  'exampleTranslation',
  'reading',
  'partOfSpeech',
  'mnemonic',
  'note',
  'front',
  'back',
  'text',
  'tags',
  'rank',
  'article',
  'plural',
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

function text(value: unknown): string | undefined {
  if (typeof value === 'number') {
    return String(value);
  }

  if (Array.isArray(value)) {
    const joined = value.filter((entry) => typeof entry === 'string').join(', ');

    return joined === '' ? undefined : joined;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed === '' ? undefined : trimmed;
}

/** Only the grammar keys the note schema knows, and only the filled ones. */
function grammarOf(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const known = new Set([
    'article',
    'plural',
    'gender',
    'praeteritum',
    'partizip2',
    'auxiliary',
    'separable',
    'case',
    'reflexive',
    'comparative',
    'superlative',
    'variant',
    'irregular',
    'uncountable',
  ]);

  const grammar: Record<string, unknown> = {};

  for (const [name, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!known.has(name) || entry === null || entry === undefined || entry === '') {
      continue;
    }

    grammar[name] = typeof entry === 'boolean' ? entry : text(entry);
  }

  return Object.keys(grammar).length === 0 ? undefined : grammar;
}

/**
 * The main path: JSON in the shape the generation prompt asks for.
 *
 * A bare array of notes is accepted as well, because that is what a model
 * produces about one time in five however the prompt is worded.
 */
function parseJson(raw: string): ParseResult {
  const failures: { line: number; reason: string }[] = [];
  let parsed: unknown;

  try {
    parsed = JSON.parse(stripFences(raw));
  } catch (error) {
    return {
      format: 'json',
      noteType: 'vocab',
      rows: [],
      failures: [{ line: 1, reason: error instanceof Error ? error.message : 'not JSON' }],
    };
  }

  const envelope = (Array.isArray(parsed) ? { notes: parsed } : parsed) as Record<string, unknown>;
  const list = Array.isArray(envelope['notes']) ? envelope['notes'] : [];
  const noteType = (text(envelope['noteType']) ?? 'vocab') as NoteTypeName;
  const rows: ParsedRow[] = [];

  for (const [index, entry] of list.entries()) {
    if (typeof entry !== 'object' || entry === null) {
      failures.push({ line: index + 1, reason: 'not an object' });

      continue;
    }

    const note = entry as Record<string, unknown>;
    const fields: Record<string, unknown> = {};

    for (const name of [
      'term',
      'reading',
      'translation',
      'definition',
      'example',
      'exampleTranslation',
      'partOfSpeech',
      'mnemonic',
      'note',
      'front',
      'back',
      'text',
    ]) {
      const value = text(note[name]);

      if (value !== undefined) {
        fields[name] = value;
      }
    }

    const grammar = grammarOf(note['grammar']);

    if (grammar) {
      fields['grammar'] = grammar;
    }

    const tags = Array.isArray(note['tags'])
      ? note['tags'].filter((tag): tag is string => typeof tag === 'string' && tag.trim() !== '')
      : [];

    // The level is a tag rather than a field. The note schema has nowhere to
    // put it, and as a tag it is something the list can filter by, which is
    // what a level is actually for.
    const level = text(note['level']);

    rows.push({
      line: index + 1,
      fields,
      tags: level === undefined ? tags : [...tags, level],
      ...(typeof note['rank'] === 'number' ? { rank: note['rank'] } : {}),
      ...(text(note['issue']) === undefined ? {} : { issue: text(note['issue']) }),
    });
  }

  return {
    format: 'json',
    noteType,
    rows,
    failures,
    ...(text(envelope['source']) === undefined ? {} : { source: text(envelope['source']) }),
  };
}

/**
 * One line of a delimited file, quotes and all.
 *
 * Written out rather than split on the delimiter, because a translation with a
 * comma in it is normal and splitting on commas turns it into two columns and
 * every column after it into the wrong one.
 */
function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (quoted) {
      if (character === '"') {
        if (line[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }

      continue;
    }

    if (character === '"' && cell === '') {
      quoted = true;
    } else if (character === delimiter) {
      cells.push(cell);
      cell = '';
    } else {
      cell += character ?? '';
    }
  }

  cells.push(cell);

  return cells.map((value) => value.trim());
}

/** Anki writes its fields as HTML. The cards here are text. */
function stripHtml(value: string): string {
  return value
    .replaceAll(/<br\s*\/?>/gi, ' ')
    .replaceAll(/<[^>]+>/g, '')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A table: CSV, TSV, or an Anki export, which is a TSV with a different button.
 *
 * The columns are named by the caller, from the mapping step, because a file
 * out of a spreadsheet has whatever headings somebody typed and guessing is how
 * a translation ends up in the definition of five thousand cards.
 */
function parseTable(
  raw: string,
  format: ImportFormat,
  options: {
    readonly noteType?: NoteTypeName;
    readonly columns?: readonly string[];
    readonly header?: boolean;
  },
): ParseResult {
  const anki = format === 'anki';
  const delimiter = format === 'csv' ? ',' : '\t';
  const noteType = options.noteType ?? (anki ? 'basic' : 'vocab');
  const failures: { line: number; reason: string }[] = [];

  const lines = raw
    .split('\n')
    .map((line, index) => ({ line: index + 1, value: line.replace(/\r$/, '') }))
    // Anki puts its settings in comments above the rows.
    .filter((entry) => entry.value.trim() !== '' && !(anki && entry.value.startsWith('#')));

  const first = lines[0];
  const cells = first ? splitLine(first.value, delimiter) : [];

  // A header row is one whose cells are all names of fields we know, or one the
  // caller has said is a header.
  const header =
    options.header ??
    (!anki && cells.length > 1 && cells.every((cell) => looksLikeFieldName(cell)));

  const columns =
    options.columns ??
    (header
      ? cells.map((cell) => fieldNameOf(cell) ?? '')
      : defaultColumns(noteType, cells.length));

  const rows: ParsedRow[] = [];

  for (const entry of lines.slice(header ? 1 : 0)) {
    const values = splitLine(entry.value, delimiter);
    const fields: Record<string, unknown> = {};
    let tags: string[] = [];
    let rank: number | undefined;

    for (const [index, value] of values.entries()) {
      const name = columns[index];
      const cleaned = anki ? stripHtml(value) : value;

      if (name === undefined || name === '' || cleaned === '') {
        continue;
      }

      if (name === 'tags') {
        tags = cleaned
          .split(/[,\s]+/)
          .map((tag) => tag.trim())
          .filter((tag) => tag !== '');
      } else if (name === 'rank') {
        const parsed = Number.parseInt(cleaned, 10);

        rank = Number.isFinite(parsed) ? parsed : undefined;
      } else if (name === 'article' || name === 'plural') {
        const grammar = (fields['grammar'] ?? {}) as Record<string, unknown>;

        fields['grammar'] = { ...grammar, [name]: cleaned };
      } else {
        fields[name] = cleaned;
      }
    }

    if (Object.keys(fields).length === 0) {
      failures.push({ line: entry.line, reason: 'no fields' });

      continue;
    }

    rows.push({
      line: entry.line,
      fields,
      tags,
      ...(rank === undefined ? {} : { rank }),
    });
  }

  return { format, noteType, rows, columns, failures };
}

/** What a column called this holds, if it is one we know. */
function fieldNameOf(heading: string): ImportField | undefined {
  const cleaned = heading.trim().toLowerCase().replaceAll(' ', '');

  return IMPORT_FIELDS.find(
    (field) => field.toLowerCase() === cleaned || SYNONYMS[cleaned] === field,
  );
}

/** The names a spreadsheet column is likely to carry, in both languages. */
const SYNONYMS: Record<string, ImportField> = {
  word: 'term',
  wort: 'term',
  слово: 'term',
  meaning: 'translation',
  перевод: 'translation',
  übersetzung: 'translation',
  definition: 'definition',
  определение: 'definition',
  example: 'example',
  beispiel: 'example',
  пример: 'example',
  sentence: 'example',
  reading: 'reading',
  чтение: 'reading',
  ipa: 'reading',
  pos: 'partOfSpeech',
  partofspeech: 'partOfSpeech',
  частьречи: 'partOfSpeech',
  artikel: 'article',
  артикль: 'article',
  plural: 'plural',
  мнч: 'plural',
  tag: 'tags',
  метки: 'tags',
  frequency: 'rank',
  частота: 'rank',
};

function looksLikeFieldName(heading: string): boolean {
  return fieldNameOf(heading) !== undefined;
}

/** What the columns of a headerless table are assumed to be. */
function defaultColumns(noteType: NoteTypeName, width: number): string[] {
  const shapes: Record<NoteTypeName, readonly string[]> = {
    vocab: ['term', 'translation', 'example', 'exampleTranslation', 'tags'],
    basic: ['front', 'back', 'tags'],
    cloze: ['text', 'tags'],
  };

  const shape = shapes[noteType];

  return Array.from({ length: width }, (_, index) => shape[index] ?? '');
}

/**
 * Plain text: one entry a line, split on whatever separator is in it.
 *
 * A list copied out of a textbook uses a dash, an equals sign, a tab or a
 * semicolon, and nobody is going to normalise five hundred lines by hand before
 * pasting them.
 */
function parseText(raw: string, noteType: NoteTypeName): ParseResult {
  const separators = ['\t', ' — ', ' – ', ' - ', ' = ', ' | ', ';', ' : '];
  const rows: ParsedRow[] = [];

  for (const [index, line] of raw.split('\n').entries()) {
    const value = line.trim();

    if (value === '') {
      continue;
    }

    const separator = separators.find((candidate) => value.includes(candidate));
    const [left, ...rest] = separator === undefined ? [value] : value.split(separator);
    const right = rest.join(separator ?? '').trim();

    const fields: Record<string, unknown> =
      noteType === 'basic'
        ? { front: left?.trim() ?? '', ...(right === '' ? {} : { back: right }) }
        : noteType === 'cloze'
          ? { text: value }
          : { term: left?.trim() ?? '', ...(right === '' ? {} : { translation: right }) };

    rows.push({ line: index + 1, fields, tags: [] });
  }

  return { format: 'text', noteType, rows, failures: [] };
}

/** What is wrong with one row, if anything. */
export interface RowProblems {
  /** Fields the type needs that this row does not have. */
  readonly missing: readonly string[];
  /** The example does not contain the word it is an example of. */
  readonly exampleMisses: boolean;
  /** Another row in this same file has the same word. */
  readonly duplicateInFile: boolean;
}

/**
 * Checks a row against its type and against the rest of the file.
 *
 * The example check is the one worth having. A generated sentence that does not
 * contain its own word is the most common thing wrong with generated cards, and
 * it stays invisible until the card comes up in a review months later.
 *
 * @param row the row
 * @param noteType which type it is being imported as
 * @param counts how many rows share each comparable term, from `termCounts`
 * @returns what is wrong with it
 */
export function rowProblems(
  row: ParsedRow,
  noteType: NoteTypeName,
  counts: ReadonlyMap<string, number>,
): RowProblems {
  const parsed = noteFieldsSchemas[noteType].safeParse(row.fields);
  const missing = parsed.success
    ? []
    : [
        ...new Set(
          parsed.error.issues.map((issue) => issue.path.map(String).join('.') || '(fields)'),
        ),
      ];

  const example = row.fields['example'];
  const exampleMisses =
    typeof example === 'string' &&
    example !== '' &&
    !exampleContainsTerm(example, termOf(row.fields));

  return {
    missing,
    exampleMisses,
    duplicateInFile: (counts.get(noteTermKey(row.fields)) ?? 0) > 1,
  };
}

/** How many rows share each comparable term, for finding duplicates in a file. */
export function termCounts(rows: readonly ParsedRow[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const row of rows) {
    const key = noteTermKey(row.fields);

    if (key !== '') {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  return counts;
}

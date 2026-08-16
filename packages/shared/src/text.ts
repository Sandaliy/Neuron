/**
 * How two words are compared when deciding whether they are the same word.
 *
 * Used by the importer to find duplicates, and by the database, which stores
 * the same value in a generated column so the check is one indexed query for
 * a whole import rather than one query per row. The two have to agree
 * exactly: a normalisation that differs by a space finds nothing and lets
 * five thousand duplicates in.
 *
 * The SQL half is on `notes.term_key`, and `normalise.test.ts` in apps/api runs
 * both over the same words and fails if they ever disagree.
 */

/** Longer than this is not a word, and the index does not need the rest. */
export const TERM_KEY_LENGTH = 200;

/**
 * Exactly what Postgres calls whitespace, and nothing more.
 *
 * `\s` in JavaScript also matches a non-breaking space and a handful of other
 * unicode separators, and `[[:space:]]` in Postgres does not. `String.trim`
 * has the same problem against `btrim`. The two normalisations have to produce
 * the same string or the duplicate check finds nothing, so this one is written
 * to match the database rather than the other way round.
 */
const SPACE = /[ \t\n\r\f\v]+/g;

/**
 * The comparable form of a term.
 *
 * Case is folded and runs of whitespace become one space. Nothing else:
 * accents are not stripped, because in German `schon` and `schön` are two
 * different words and treating them as one would silently merge them.
 *
 * @param term the term as it was written
 * @returns the form two terms are compared by
 */
export function normaliseTerm(term: string): string {
  return term.replace(SPACE, ' ').replace(/^ | $/g, '').toLowerCase().slice(0, TERM_KEY_LENGTH);
}

/**
 * The field a note is identified by, whatever type it is.
 *
 * A vocab note is its term, a basic note its front, a cloze note its text. The
 * database column uses the same three in the same order.
 *
 * @param fields the note's fields
 * @returns the term, or an empty string when there is nothing to compare
 */
export function termOf(fields: unknown): string {
  if (typeof fields !== 'object' || fields === null) {
    return '';
  }

  const record = fields as Record<string, unknown>;

  for (const name of ['term', 'front', 'text']) {
    const value = record[name];

    if (typeof value === 'string' && value.trim() !== '') {
      return value;
    }
  }

  return '';
}

/** The comparable form of whatever a note is identified by. */
export function noteTermKey(fields: unknown): string {
  return normaliseTerm(termOf(fields));
}

/**
 * Case and umlauts folded away, for comparing a word against a sentence.
 *
 * Only for that comparison. `normaliseTerm` deliberately keeps its umlauts,
 * because `schon` and `schön` are two different words and a duplicate check
 * that merged them would lose one of them.
 */
function fold(value: string): string {
  return normaliseTerm(value)
    .replaceAll('ä', 'a')
    .replaceAll('ö', 'o')
    .replaceAll('ü', 'u')
    .replaceAll('ß', 'ss');
}

/** The separable prefixes a German verb is written apart from in a sentence. */
const SEPARABLE = /^(ab|an|auf|aus|bei|ein|mit|nach|vor|zusammen|zuruck|zu)/;

/**
 * Whether an example sentence actually contains the word it is an example of.
 *
 * A generated example that does not is the most common thing wrong with a
 * generated card, and it stays invisible until the card comes up in a review
 * months later. So the importer checks every one, and this is the check.
 *
 * Deliberately generous. German inflects and compounds, `aufstehen` appears in
 * a sentence as `steht früh auf`, and a strict match would flag most correct
 * examples, which trains a person to ignore the warning. It looks for the
 * stem, not the form.
 *
 * @param example the sentence
 * @param term the word it should contain
 * @returns whether the word is in it
 */
export function exampleContainsTerm(example: string, term: string): boolean {
  const word = fold(term);

  if (word === '') {
    return true;
  }

  const haystack = fold(example);

  if (haystack.includes(word)) {
    return true;
  }

  // An inflected form shares a stem with the word it comes from. Dropping the
  // last two characters catches `Hauser` for `Haus` and `arbeitet` for
  // `arbeiten` without pretending to know the grammar. Four letters is the
  // floor: below that a stem matches nearly everything.
  const stem = word.length > 5 ? word.slice(0, -2) : word;

  if (stem.length >= 4 && haystack.includes(stem)) {
    return true;
  }

  // A separable verb: `aufstehen` is `steht auf`, so the prefix comes off and
  // what is left is looked for on its own.
  const bare = stem.replace(SEPARABLE, '');

  return bare.length >= 4 && bare !== stem && haystack.includes(bare);
}

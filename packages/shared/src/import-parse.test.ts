import { describe, expect, it } from 'vitest';

import { detectFormat, parseImport, rowProblems, termCounts } from './import-parse.js';

/**
 * Reading a word list.
 *
 * The cases here are the ones that actually arrive: a model that wrapped its
 * JSON in a code fence, a spreadsheet whose translations contain commas, a list
 * copied out of a textbook with dashes in it, and an Anki export full of HTML.
 */

const GENERATED = `{
  "version": 1,
  "noteType": "vocab",
  "language": { "target": "de", "native": "ru" },
  "source": "Menschen B1, Lektion 4",
  "notes": [
    {
      "term": "Sorgfalt",
      "reading": null,
      "partOfSpeech": "noun",
      "grammar": { "article": "die", "plural": null, "gender": "f" },
      "translation": ["тщательность", "аккуратность"],
      "definition": "das genaue Arbeiten an einer Aufgabe",
      "example": "Sie prüft die Rechnungen mit großer Sorgfalt.",
      "exampleTranslation": "Она проверяет счета с большой тщательностью.",
      "level": "B2",
      "rank": null,
      "tags": ["work"],
      "mnemonic": null,
      "issue": null
    }
  ]
}`;

describe('working out what a file is', () => {
  it('knows JSON, fenced or not', () => {
    expect(detectFormat(GENERATED)).toBe('json');
    expect(detectFormat('```json\n{"notes":[]}\n```')).toBe('json');
  });

  it('knows a tab separated table', () => {
    expect(detectFormat('Haus\thouse\nBaum\ttree')).toBe('tsv');
  });

  it('knows a comma separated table', () => {
    expect(detectFormat('term,translation\nHaus,house\nBaum,tree')).toBe('csv');
  });

  it('knows an Anki export by what it says about itself', () => {
    expect(detectFormat('#separator:tab\n#html:true\nHaus\thouse')).toBe('anki');
  });

  it('does not call a word list a table because one line has a comma', () => {
    expect(detectFormat('Haus\nBaum\nSorgfalt, die\nFenster\nTermin')).toBe('text');
  });
});

describe('the generated JSON', () => {
  const result = parseImport(GENERATED, 'json');

  it('reads the note and what it is about', () => {
    expect(result.rows).toHaveLength(1);
    expect(result.source).toBe('Menschen B1, Lektion 4');
    expect(result.noteType).toBe('vocab');
  });

  it('joins several translations into one field', () => {
    expect(result.rows[0]?.fields['translation']).toBe('тщательность, аккуратность');
  });

  it('drops the nulls rather than storing them', () => {
    expect(result.rows[0]?.fields).not.toHaveProperty('reading');
    expect(result.rows[0]?.fields['grammar']).toEqual({ article: 'die', gender: 'f' });
  });

  it('keeps the level as a tag, which is the one place it can be filtered by', () => {
    expect(result.rows[0]?.tags).toEqual(['work', 'B2']);
  });

  it('takes a code fence off, because a model puts one on about half the time', () => {
    const fenced = parseImport('```json\n' + GENERATED + '\n```', 'json');

    expect(fenced.rows).toHaveLength(1);
  });

  it('accepts a bare array, which is the other thing a model does', () => {
    const bare = parseImport('[{"term":"Haus","translation":"house"}]', 'json');

    expect(bare.rows).toHaveLength(1);
  });

  it('says what went wrong rather than throwing', () => {
    const broken = parseImport('{ not json', 'json');

    expect(broken.rows).toHaveLength(0);
    expect(broken.failures).toHaveLength(1);
  });
});

describe('a table', () => {
  it('reads a header and maps the columns by name', () => {
    const result = parseImport('term,translation\nHaus,house', 'csv');

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.fields).toEqual({ term: 'Haus', translation: 'house' });
  });

  it('keeps a comma that is inside quotes out of the columns', () => {
    const result = parseImport('term,translation\nHaus,"house, building"', 'csv');

    expect(result.rows[0]?.fields['translation']).toBe('house, building');
  });

  it('takes the columns it is given when there is no header', () => {
    const result = parseImport('Haus\thouse\nBaum\ttree', 'tsv', {
      columns: ['term', 'translation'],
    });

    expect(result.rows).toHaveLength(2);
    expect(result.rows[1]?.fields['term']).toBe('Baum');
  });

  it('puts an article and a plural into the grammar rather than beside it', () => {
    const result = parseImport('die\tSorgfalt\tcare', 'tsv', {
      columns: ['article', 'term', 'translation'],
    });

    expect(result.rows[0]?.fields['grammar']).toEqual({ article: 'die' });
  });

  it('reads an Anki export, comments, HTML and all', () => {
    const result = parseImport(
      '#separator:tab\n#html:true\n<b>Haus</b>\thouse<br>building',
      'anki',
    );

    expect(result.noteType).toBe('basic');
    expect(result.rows[0]?.fields).toEqual({ front: 'Haus', back: 'house building' });
  });
});

describe('plain text', () => {
  it('splits on whatever separator the list happens to use', () => {
    const result = parseImport('Haus - house\nBaum = tree\nFenster\twindow', 'text');

    expect(result.rows.map((row) => row.fields['translation'])).toEqual([
      'house',
      'tree',
      'window',
    ]);
  });

  it('keeps a line with no separator, so it can be reported rather than lost', () => {
    const result = parseImport('Haus', 'text');

    expect(result.rows[0]?.fields).toEqual({ term: 'Haus' });
  });
});

describe('what is wrong with a row', () => {
  const rows = parseImport(
    'term,translation,example\nHaus,house,Das Haus ist alt.\nBaum,,Der Wald ist gross.\nHaus,house,',
    'csv',
  ).rows;
  const counts = termCounts(rows);

  it('names the fields a row is missing', () => {
    expect(rowProblems(rows[1] as never, 'vocab', counts).missing).toContain('translation');
  });

  it('notices an example that does not contain its own word', () => {
    expect(rowProblems(rows[0] as never, 'vocab', counts).exampleMisses).toBe(false);
    expect(rowProblems(rows[1] as never, 'vocab', counts).exampleMisses).toBe(true);
  });

  it('notices a word that appears twice in the same file', () => {
    expect(rowProblems(rows[0] as never, 'vocab', counts).duplicateInFile).toBe(true);
    expect(rowProblems(rows[1] as never, 'vocab', counts).duplicateInFile).toBe(false);
  });
});

describe('five thousand rows', () => {
  it('reads them in one pass', () => {
    const text = Array.from({ length: 5000 }, (_, index) => `Wort${index}\tword ${index}`).join(
      '\n',
    );
    const started = Date.now();
    const result = parseImport(text, 'tsv', { columns: ['term', 'translation'] });

    expect(result.rows).toHaveLength(5000);
    expect(termCounts(result.rows).size).toBe(5000);
    // Not a benchmark, a guard: a parser that is quadratic in the number of
    // rows passes every test above and takes a minute on a real list.
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

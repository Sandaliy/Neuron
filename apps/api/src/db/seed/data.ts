/**
 * The words the seed puts in the database.
 *
 * Real vocabulary with real articles, plurals and frequency ranks, because a
 * deck full of `test1` tells you nothing about whether the thing works. Looking
 * at these rows in a table browser should feel like looking at a real
 * collection.
 *
 * German is translated into English and English into Russian, which is what a
 * person actually learning these two languages would have. The Russian is also
 * doing a second job: it is the only place in the schema where non-ASCII text
 * gets written and read back, and finding out that a column mangles it is worth
 * a few Cyrillic characters in a seed file.
 */

export interface GermanWord {
  readonly term: string;
  readonly article?: string;
  readonly plural?: string;
  readonly translation: string;
  readonly partOfSpeech: string;
  readonly example?: string;
}

export interface EnglishWord {
  readonly term: string;
  readonly translation: string;
  readonly rank: number;
  readonly partOfSpeech: string;
}

/** Lesson 1: nouns from the first half of a B2 textbook chapter. */
export const GERMAN_LESSON_ONE: readonly GermanWord[] = [
  { term: 'Sorgfalt', article: 'die', translation: 'care, thoroughness', partOfSpeech: 'noun', example: 'Er arbeitet mit großer Sorgfalt.' },
  { term: 'Schlüssel', article: 'der', plural: 'die Schlüssel', translation: 'key', partOfSpeech: 'noun' },
  { term: 'Wohnung', article: 'die', plural: 'die Wohnungen', translation: 'flat, apartment', partOfSpeech: 'noun' },
  { term: 'Fenster', article: 'das', plural: 'die Fenster', translation: 'window', partOfSpeech: 'noun' },
  { term: 'Termin', article: 'der', plural: 'die Termine', translation: 'appointment', partOfSpeech: 'noun', example: 'Ich habe morgen einen Termin beim Arzt.' },
  { term: 'Rechnung', article: 'die', plural: 'die Rechnungen', translation: 'bill, invoice', partOfSpeech: 'noun' },
  { term: 'Verhältnis', article: 'das', plural: 'die Verhältnisse', translation: 'relationship, ratio', partOfSpeech: 'noun' },
  { term: 'Vorschlag', article: 'der', plural: 'die Vorschläge', translation: 'suggestion', partOfSpeech: 'noun' },
  { term: 'Erfahrung', article: 'die', plural: 'die Erfahrungen', translation: 'experience', partOfSpeech: 'noun' },
  { term: 'Ergebnis', article: 'das', plural: 'die Ergebnisse', translation: 'result', partOfSpeech: 'noun' },
  { term: 'Zusammenhang', article: 'der', plural: 'die Zusammenhänge', translation: 'connection, context', partOfSpeech: 'noun' },
  { term: 'Entscheidung', article: 'die', plural: 'die Entscheidungen', translation: 'decision', partOfSpeech: 'noun', example: 'Das war keine leichte Entscheidung.' },
  { term: 'Gespräch', article: 'das', plural: 'die Gespräche', translation: 'conversation', partOfSpeech: 'noun' },
  { term: 'Aufwand', article: 'der', plural: 'die Aufwände', translation: 'effort, expense', partOfSpeech: 'noun' },
  { term: 'Bedingung', article: 'die', plural: 'die Bedingungen', translation: 'condition', partOfSpeech: 'noun' },
  { term: 'Bedürfnis', article: 'das', plural: 'die Bedürfnisse', translation: 'need', partOfSpeech: 'noun' },
  { term: 'Anspruch', article: 'der', plural: 'die Ansprüche', translation: 'claim, demand', partOfSpeech: 'noun' },
  { term: 'Umgebung', article: 'die', plural: 'die Umgebungen', translation: 'surroundings', partOfSpeech: 'noun' },
  { term: 'Vertrauen', article: 'das', translation: 'trust', partOfSpeech: 'noun' },
  { term: 'Zweck', article: 'der', plural: 'die Zwecke', translation: 'purpose', partOfSpeech: 'noun' },
  { term: 'Möglichkeit', article: 'die', plural: 'die Möglichkeiten', translation: 'possibility', partOfSpeech: 'noun' },
  { term: 'Beispiel', article: 'das', plural: 'die Beispiele', translation: 'example', partOfSpeech: 'noun' },
  { term: 'Unterschied', article: 'der', plural: 'die Unterschiede', translation: 'difference', partOfSpeech: 'noun' },
  { term: 'Bedeutung', article: 'die', plural: 'die Bedeutungen', translation: 'meaning', partOfSpeech: 'noun' },
  { term: 'Verhalten', article: 'das', translation: 'behaviour', partOfSpeech: 'noun' },
  { term: 'Versuch', article: 'der', plural: 'die Versuche', translation: 'attempt', partOfSpeech: 'noun' },
  { term: 'Grundlage', article: 'die', plural: 'die Grundlagen', translation: 'basis', partOfSpeech: 'noun' },
  { term: 'Verfahren', article: 'das', plural: 'die Verfahren', translation: 'procedure', partOfSpeech: 'noun' },
  { term: 'Anteil', article: 'der', plural: 'die Anteile', translation: 'share, proportion', partOfSpeech: 'noun' },
  { term: 'Leistung', article: 'die', plural: 'die Leistungen', translation: 'performance', partOfSpeech: 'noun' },
];

/** Lesson 2: the verbs and adjectives from the second half. */
export const GERMAN_LESSON_TWO: readonly GermanWord[] = [
  { term: 'Ziel', article: 'das', plural: 'die Ziele', translation: 'goal', partOfSpeech: 'noun' },
  { term: 'Betrag', article: 'der', plural: 'die Beträge', translation: 'amount', partOfSpeech: 'noun' },
  { term: 'Ursache', article: 'die', plural: 'die Ursachen', translation: 'cause', partOfSpeech: 'noun' },
  { term: 'Merkmal', article: 'das', plural: 'die Merkmale', translation: 'feature', partOfSpeech: 'noun' },
  { term: 'Hinweis', article: 'der', plural: 'die Hinweise', translation: 'hint, notice', partOfSpeech: 'noun' },
  { term: 'Wirkung', article: 'die', plural: 'die Wirkungen', translation: 'effect', partOfSpeech: 'noun' },
  { term: 'Gebiet', article: 'das', plural: 'die Gebiete', translation: 'area, field', partOfSpeech: 'noun' },
  { term: 'Ablauf', article: 'der', plural: 'die Abläufe', translation: 'sequence, process', partOfSpeech: 'noun' },
  { term: 'Anlage', article: 'die', plural: 'die Anlagen', translation: 'facility, attachment', partOfSpeech: 'noun' },
  { term: 'Vermögen', article: 'das', plural: 'die Vermögen', translation: 'assets, ability', partOfSpeech: 'noun' },
  { term: 'erledigen', translation: 'to get done, to handle', partOfSpeech: 'verb', example: 'Ich muss noch zwei Sachen erledigen.' },
  { term: 'verzichten', translation: 'to do without', partOfSpeech: 'verb' },
  { term: 'berücksichtigen', translation: 'to take into account', partOfSpeech: 'verb' },
  { term: 'beantragen', translation: 'to apply for', partOfSpeech: 'verb' },
  { term: 'überzeugen', translation: 'to convince', partOfSpeech: 'verb' },
  { term: 'vermeiden', translation: 'to avoid', partOfSpeech: 'verb' },
  { term: 'verlangen', translation: 'to demand', partOfSpeech: 'verb' },
  { term: 'behaupten', translation: 'to claim', partOfSpeech: 'verb' },
  { term: 'erwähnen', translation: 'to mention', partOfSpeech: 'verb' },
  { term: 'bewerten', translation: 'to assess', partOfSpeech: 'verb' },
  { term: 'entsprechen', translation: 'to correspond to', partOfSpeech: 'verb' },
  { term: 'verfügen', translation: 'to have at your disposal', partOfSpeech: 'verb' },
  { term: 'gewährleisten', translation: 'to ensure', partOfSpeech: 'verb' },
  { term: 'wahrnehmen', translation: 'to perceive, to take up', partOfSpeech: 'verb' },
  { term: 'aufwendig', translation: 'elaborate, costly', partOfSpeech: 'adjective' },
  { term: 'zuverlässig', translation: 'reliable', partOfSpeech: 'adjective' },
  { term: 'erheblich', translation: 'considerable', partOfSpeech: 'adjective' },
  { term: 'gründlich', translation: 'thorough', partOfSpeech: 'adjective' },
  { term: 'vorläufig', translation: 'provisional', partOfSpeech: 'adjective' },
  { term: 'ausführlich', translation: 'detailed', partOfSpeech: 'adjective' },
];

/**
 * English words with the rank they carry in a frequency list.
 *
 * The rank is what lets new cards be introduced in order of usefulness, so an
 * import nobody finishes still teaches the words worth knowing first.
 */
export const ENGLISH_WORDS: readonly EnglishWord[] = [
  { term: 'account', translation: 'счёт, учётная запись', rank: 412, partOfSpeech: 'noun' },
  { term: 'issue', translation: 'вопрос, проблема', rank: 468, partOfSpeech: 'noun' },
  { term: 'approach', translation: 'подход', rank: 521, partOfSpeech: 'noun' },
  { term: 'concern', translation: 'беспокойство, забота', rank: 604, partOfSpeech: 'noun' },
  { term: 'assume', translation: 'предполагать', rank: 689, partOfSpeech: 'verb' },
  { term: 'maintain', translation: 'поддерживать, утверждать', rank: 733, partOfSpeech: 'verb' },
  { term: 'estimate', translation: 'оценивать', rank: 812, partOfSpeech: 'verb' },
  { term: 'ensure', translation: 'обеспечивать', rank: 878, partOfSpeech: 'verb' },
  { term: 'acquire', translation: 'приобретать', rank: 941, partOfSpeech: 'verb' },
  { term: 'framework', translation: 'структура, рамки', rank: 1024, partOfSpeech: 'noun' },
  { term: 'implement', translation: 'внедрять, осуществлять', rank: 1096, partOfSpeech: 'verb' },
  { term: 'constraint', translation: 'ограничение', rank: 1187, partOfSpeech: 'noun' },
  { term: 'sustain', translation: 'выдерживать, поддерживать', rank: 1243, partOfSpeech: 'verb' },
  { term: 'derive', translation: 'извлекать, выводить', rank: 1338, partOfSpeech: 'verb' },
  { term: 'consistent', translation: 'последовательный', rank: 1402, partOfSpeech: 'adjective' },
  { term: 'substantial', translation: 'значительный', rank: 1495, partOfSpeech: 'adjective' },
  { term: 'inherent', translation: 'присущий', rank: 1583, partOfSpeech: 'adjective' },
  { term: 'threshold', translation: 'порог', rank: 1671, partOfSpeech: 'noun' },
  { term: 'plausible', translation: 'правдоподобный', rank: 1764, partOfSpeech: 'adjective' },
  { term: 'discrepancy', translation: 'расхождение', rank: 1858, partOfSpeech: 'noun' },
  { term: 'mitigate', translation: 'смягчать', rank: 1943, partOfSpeech: 'verb' },
  { term: 'redundant', translation: 'избыточный', rank: 2037, partOfSpeech: 'adjective' },
  { term: 'coherent', translation: 'связный, последовательный', rank: 2124, partOfSpeech: 'adjective' },
  { term: 'arbitrary', translation: 'произвольный', rank: 2218, partOfSpeech: 'adjective' },
  { term: 'deteriorate', translation: 'ухудшаться', rank: 2306, partOfSpeech: 'verb' },
  { term: 'preliminary', translation: 'предварительный', rank: 2394, partOfSpeech: 'adjective' },
  { term: 'accumulate', translation: 'накапливать', rank: 2487, partOfSpeech: 'verb' },
  { term: 'ambiguous', translation: 'неоднозначный', rank: 2571, partOfSpeech: 'adjective' },
  { term: 'compelling', translation: 'убедительный', rank: 2663, partOfSpeech: 'adjective' },
  { term: 'diminish', translation: 'уменьшать', rank: 2748, partOfSpeech: 'verb' },
  { term: 'feasible', translation: 'осуществимый', rank: 2836, partOfSpeech: 'adjective' },
  { term: 'inevitable', translation: 'неизбежный', rank: 2921, partOfSpeech: 'adjective' },
  { term: 'reluctant', translation: 'неохотный', rank: 3014, partOfSpeech: 'adjective' },
  { term: 'scrutiny', translation: 'тщательная проверка', rank: 3108, partOfSpeech: 'noun' },
  { term: 'tentative', translation: 'предварительный, осторожный', rank: 3196, partOfSpeech: 'adjective' },
  { term: 'undermine', translation: 'подрывать', rank: 3284, partOfSpeech: 'verb' },
  { term: 'viable', translation: 'жизнеспособный', rank: 3371, partOfSpeech: 'adjective' },
  { term: 'contingent', translation: 'зависящий от обстоятельств', rank: 3468, partOfSpeech: 'adjective' },
  { term: 'nuance', translation: 'нюанс', rank: 3552, partOfSpeech: 'noun' },
  { term: 'prevalent', translation: 'распространённый', rank: 3647, partOfSpeech: 'adjective' },
];

/** Question and answer notes, where there is no word to learn. */
export const BASIC_NOTES: readonly { readonly front: string; readonly back: string }[] = [
  { front: 'What does the stability of a card measure?', back: 'The number of days until the chance of recalling it falls to the target retention.' },
  { front: 'What does difficulty measure in FSRS?', back: 'How hard one particular card is for one particular person, on a scale of 1 to 10.' },
  { front: 'What is retrievability?', back: 'The probability of recalling a card right now, computed from its stability and the time since the last review.' },
  { front: 'Why is a note not the same thing as a card?', back: 'A note is the fact. A card is one direction of asking about it, and each direction is scheduled on its own.' },
  { front: 'What is the Fisher equation used for?', back: 'Relating nominal interest rates, real interest rates and inflation.' },
];

/** Notes with a gap in them, for formulas and definitions. */
export const CLOZE_NOTES: readonly { readonly text: string }[] = [
  { text: 'Fisher equation: {{i}} = {{r}} + π' },
  { text: 'In FSRS, the interval grows with {{stability}} and shrinks as {{desired retention}} rises.' },
  { text: 'Quantity theory of money: M × {{V}} = {{P}} × Y' },
  { text: 'A study day in Neuron starts at {{04:00}} local time, not at midnight.' },
];

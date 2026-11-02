/** Synthetic Import benchmark data; never contains personal collection content. */
export function vocabularyFixture(size: number) {
  return Array.from({ length: size }, (_, index) => ({
    term: `Wort ${index}`,
    translation: `meaning ${index}`,
    definition: `A useful expression number ${index}.`,
    example: `Ich benutze Wort ${index} jeden Tag.`,
    exampleTranslation: `I use word ${index} every day.`,
    reading: `reading ${index}`,
    partOfSpeech: 'noun',
    grammar: { article: 'das', plural: `Wörter ${index}` },
    tags: ['frequency', `group-${index % 20}`],
    rank: index + 1,
  }));
}

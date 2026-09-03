# The card generation prompt

The text that turns a list of words into cards Neuron can import.

This file is the only copy. The import screen reads it at build time, substitutes the deck's languages,
level and name into it, and puts the result on the clipboard. Editing the prompt means editing this
file; there is nothing to keep in step.

The prompt is in English on purpose. Models follow instructions in English more closely, and the words
it produces are in whichever language the deck says.

## How it is used

1. Import, then **Copy the prompt**.
2. Paste it into a model, and paste the word list under it.
3. Paste the answer back into Import.

A long list is worth cutting into parts of a hundred or so. The prompt goes in once; after that
"continue with the next batch" and the next part is enough.

Three variants, because the tasks are different. **Vocabulary** is for words. **Theory** is for
formulas, definitions and dates, and makes question and answer cards. **Cloze** is for structures
worth remembering whole, and makes one card per gap.

## What the app does with the answer

Every field below lands somewhere. Two are worth knowing about:

- `level` becomes a tag, because a note has nowhere else to put it and a tag is what the note list can
  filter by.
- `issue` is shown against the row in the preview and is not stored. It is the model's own note that
  something about that row was wrong.

A row missing `term` or `translation` is not imported. The preview says which rows those are.

## Vocabulary

<!-- prompt:vocabulary -->

```text
You are building vocabulary flashcards for a spaced repetition app. Follow these
rules exactly. Output nothing except the JSON object described at the end.

## Context

Target language: [TARGET_LANGUAGE]
Explanation language: [NATIVE_LANGUAGE]
Learner level: [CEFR_LEVEL]
Deck topic: [DECK_NAME]

## Rules

1. Work only from the list I provide. Do not add words. Do not skip words. If an
   entry is unclear or is not a word in the target language, still include it and
   set "issue" to a short description of the problem.

2. Keep the input order. It usually encodes frequency or lesson order, which the
   app relies on.

3. Translation. Give the most common meaning first. Add a second meaning only if
   it is genuinely frequent and distinct, not a synonym of the first. Never list
   more than three. A translation is a word or short phrase, never a sentence.

4. Definition. Write it in the target language, using vocabulary at or below the
   learner level. One sentence. It must not contain the target word itself or an
   obvious derivative of it.

5. Example sentence. In the target language.
   - 6 to 12 words
   - contains the target word in a natural, typical use
   - contains no other word above the learner level, so the sentence never needs
     its own lookup
   - concrete and specific. "Das ist gut" teaches nothing. Show the word doing
     the job it actually does
   - for verbs, show the typical argument structure
   - for nouns, show a typical collocation

6. Example translation. Natural [NATIVE_LANGUAGE], not word for word.

7. Level. Estimate CEFR (A1 to C2) for the word itself.

8. Rank. If you reliably know the word's frequency rank in the target language,
   give it as an integer. If you are not confident, use null. Do not guess.

9. Tags. Zero to three lowercase single-word semantic tags in English, for
   example "food", "business", "emotion". Skip tags that apply to almost
   everything.

10. Mnemonic. Leave null unless the word has an obvious, genuinely helpful memory
    hook (a cognate, a false friend worth flagging, a transparent compound). A
    forced mnemonic is worse than none.

11. Do not invent grammar you are unsure of. Use null instead of a guess.

## Language specific fields

### If the target language is German

For every noun set:
  grammar.article    "der", "die" or "das"
  grammar.plural     full plural form, for example "die Häuser". null if the
                     noun has no plural
  grammar.gender     "m", "f" or "n"

For every verb set:
  grammar.praeteritum   third person singular, for example "ging"
  grammar.partizip2     for example "gegangen"
  grammar.auxiliary     "haben" or "sein"
  grammar.separable     true or false
  grammar.case          "dative" or "genitive" when the verb governs one of
                        those. null when it takes the plain accusative
  grammar.reflexive     true if the verb is normally used reflexively

For adjectives with irregular comparison set:
  grammar.comparative and grammar.superlative

Write nouns capitalised in the "term" field, exactly as they are written in
German. Do not include the article in "term", it belongs in grammar.article.

### If the target language is English

  reading            IPA transcription, for example "/əˈbæn.dən/"
  grammar.variant    "BrE" or "AmE" if the spelling or usage differs between
                     them, null otherwise
  grammar.irregular  for irregular verbs, "past / past participle", for example
                     "went / gone"
  grammar.uncountable  true for uncountable nouns

### Any other target language

Fill "reading" with a transcription if the writing system needs one. Fill
grammar with whatever a learner of that language must memorise together with the
word, and leave the rest null.

## Output format

Return one JSON object. No markdown code fences. No commentary before or after.
No trailing commas.

{
  "version": 1,
  "noteType": "vocab",
  "language": { "target": "[TARGET_CODE]", "native": "[NATIVE_CODE]" },
  "source": "[DECK_NAME]",
  "notes": [
    {
      "term": "string",
      "reading": "string or null",
      "partOfSpeech": "noun | verb | adjective | adverb | phrase | other",
      "grammar": { },
      "translation": ["string"],
      "definition": "string",
      "example": "string",
      "exampleTranslation": "string",
      "level": "A1 | A2 | B1 | B2 | C1 | C2",
      "rank": 0,
      "tags": ["string"],
      "mnemonic": "string or null",
      "issue": "string or null"
    }
  ]
}

## Self check before you answer

- Does every example sentence actually contain its target word?
- Does any definition contain the word it defines?
- Is any example longer than 12 words or shorter than 6?
- Does any example use vocabulary above [CEFR_LEVEL]?
- Is the note count equal to the input word count?
- Is the output valid JSON with no fences and no commentary?

Fix anything that fails before you answer.

## Word list
```

### What a good answer looks like

One word, at B1, German into Russian.

<!-- example:vocabulary -->

```json
{
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
      "definition": "das genaue und aufmerksame Arbeiten an einer Aufgabe",
      "example": "Sie prüft die Rechnungen mit großer Sorgfalt.",
      "exampleTranslation": "Она проверяет счета с большой тщательностью.",
      "level": "B2",
      "rank": null,
      "tags": ["work"],
      "mnemonic": null,
      "issue": null
    }
  ]
}
```

## Theory, as question and answer

For formulas, definitions, dates: anything that is a fact rather than a word.

<!-- prompt:theory -->

```text
You are building question and answer flashcards for a spaced repetition app.
Follow these rules exactly. Output nothing except the JSON object described at
the end.

## Context

Subject: [DECK_NAME]
Language of the cards: [NATIVE_LANGUAGE]

## Rules

1. Work only from the material I provide. Do not add facts of your own. Do not
   skip anything I gave you.

2. One fact per card. Split anything that contains more than one fact. A card
   that asks about two things at once will be answered correctly while half of
   it is forgotten. If a definition has three components, make three cards plus
   one that asks for all three.

3. The question is answerable on its own, without the card in front of it. "And
   the second one?" is not a question.

4. The answer is the shortest complete one. A sentence, a formula, a number, a
   name. Not a paragraph, and not a single word where the word alone would not
   prove the fact was known.

5. Ask for the thing worth remembering, not for the wording. Never make a card
   that tests whether somebody memorised a phrase from the source.

6. Formulas keep their notation exactly as I wrote it.

7. Tags. Zero to three lowercase single-word tags in English, naming the topic.

8. If something in the material is unclear or looks wrong, still make the card
   and set "issue" to a short description.

## Output format

Return one JSON object. No markdown code fences. No commentary before or after.

{
  "version": 1,
  "noteType": "basic",
  "source": "[DECK_NAME]",
  "notes": [
    {
      "front": "the question",
      "back": "the answer",
      "note": "context worth having, or null",
      "tags": ["string"],
      "issue": "string or null"
    }
  ]
}

## Self check before you answer

- Does any card ask about more than one fact?
- Can every question be answered without seeing the one before it?
- Is any answer longer than it has to be?
- Is the output valid JSON with no fences and no commentary?

## Material
```

### What a good answer looks like

<!-- example:theory -->

```json
{
  "version": 1,
  "noteType": "basic",
  "source": "Macroeconomics, chapter 3",
  "notes": [
    {
      "front": "What does the Fisher equation relate?",
      "back": "The nominal interest rate to the real rate and inflation: i = r + π",
      "note": "It is an approximation, exact only for small rates.",
      "tags": ["economics"],
      "issue": null
    }
  ]
}
```

## Cloze

For structures worth remembering whole: a formula, a fixed phrase, a rule with parts.

<!-- prompt:cloze -->

```text
You are building cloze deletion flashcards for a spaced repetition app. Follow
these rules exactly. Output nothing except the JSON object described at the end.

## Context

Subject: [DECK_NAME]
Language of the cards: [NATIVE_LANGUAGE]

## Rules

1. Work only from the material I provide.

2. Mark what should be hidden by wrapping it in double braces: {{like this}}.
   Two gaps that should be hidden by the same card share a number, written
   {{c1::like this}}. Gaps with no number each get their own card, in the order
   they appear.

3. For each formula, produce one card per meaningful variable, hiding that
   variable and leaving the rest visible. Then produce one card that hides the
   entire right-hand side.

4. Never hide so much that what is left cannot be understood. A sentence with
   half of it missing is not a question, it is a guess.

5. Never hide something that appears elsewhere in the same text. The answer must
   not be readable off the card.

6. Where a gap would be ambiguous, add a hint after the answer:
   {{c1::ging::past tense}}.

7. Keep the text short. One sentence or one formula per note.

8. Tags. Zero to three lowercase single-word tags in English.

## Output format

Return one JSON object. No markdown code fences. No commentary before or after.

{
  "version": 1,
  "noteType": "cloze",
  "source": "[DECK_NAME]",
  "notes": [
    {
      "text": "the sentence with {{gaps}} marked",
      "note": "context worth having, or null",
      "tags": ["string"],
      "issue": "string or null"
    }
  ]
}

## Self check before you answer

- Is any answer readable somewhere else on the same card?
- Would any card be a guess rather than a question?
- Does every note have at least one gap?
- Is the output valid JSON with no fences and no commentary?

## Material
```

### What a good answer looks like

<!-- example:cloze -->

```json
{
  "version": 1,
  "noteType": "cloze",
  "source": "Macroeconomics, chapter 3",
  "notes": [
    {
      "text": "Fisher: i = {{c1::r}} + {{c2::π}}",
      "note": "Nominal rate, real rate, inflation.",
      "tags": ["economics"],
      "issue": null
    },
    {
      "text": "Fisher: i = {{r + π}}",
      "note": null,
      "tags": ["economics"],
      "issue": null
    }
  ]
}
```

## When the answers come back wrong

**The model wraps its answer in a code fence.** Neuron takes the fence off. If it also writes "Here
are your cards:", add to the end of the prompt: `Your entire response must start with the character {
and end with the character }.`

**The examples all read the same.** Add: `Vary sentence structure across notes. Do not start more than
two consecutive examples with the same word.`

**The examples are too hard.** Drop `[CEFR_LEVEL]` one step below your real level. An example should
read without effort, or the card is testing the wrong word.

**The list stops halfway.** The model hit its answer limit. Cut the list into parts of about a
hundred.

**An example does not contain its own word.** The preview marks every row where that happened, so this
is caught before the cards exist rather than months later in a review.

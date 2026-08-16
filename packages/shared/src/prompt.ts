import { LANGUAGE_NAMES } from './languages.js';

import type { CefrLevel, LanguageCode } from './languages.js';

/**
 * The card generation prompt, read out of the document that holds it.
 *
 * `docs/card-generation-prompt.md` is the only copy. The client imports that
 * file as text and this reads the variants out of it, so editing the prompt is
 * editing the document and there is no second version to keep in step.
 *
 * The markers are HTML comments, which are invisible when the document is read
 * as documentation and unambiguous when it is read as data.
 */

export const PROMPT_VARIANTS = ['vocabulary', 'theory', 'cloze'] as const;

export type PromptVariant = (typeof PROMPT_VARIANTS)[number];

/** One variant: the prompt itself, and an example of a good answer. */
export interface Prompt {
  readonly variant: PromptVariant;
  readonly text: string;
  /** What the answer should look like, so a bad one can be spotted early. */
  readonly example: string;
}

/** What gets substituted into a prompt before it is copied. */
export interface PromptContext {
  readonly targetLanguage?: LanguageCode | undefined;
  readonly nativeLanguage?: LanguageCode | undefined;
  readonly level?: CefrLevel | undefined;
  readonly deckName: string;
}

function blockAfter(document: string, marker: string): string {
  const at = document.indexOf(marker);

  if (at === -1) {
    return '';
  }

  const fenced = /```[a-z]*\n([\s\S]*?)\n```/.exec(document.slice(at));

  return fenced?.[1] ?? '';
}

/**
 * Reads the three variants out of the document.
 *
 * @param document the contents of docs/card-generation-prompt.md
 * @returns the prompts, in the order they are offered
 */
export function readPrompts(document: string): Prompt[] {
  return PROMPT_VARIANTS.map((variant) => ({
    variant,
    text: blockAfter(document, `<!-- prompt:${variant} -->`),
    example: blockAfter(document, `<!-- example:${variant} -->`),
  }));
}

/**
 * Fills a prompt in for one deck.
 *
 * A placeholder with nothing to put in it is left as it was written. A prompt
 * saying `[TARGET_LANGUAGE]` reads as a prompt that is not finished, which is
 * true; one saying "undefined" reads as a working prompt that will produce five
 * thousand wrong cards.
 *
 * @param text the prompt as it is written in the document
 * @param context the deck's languages, level and name
 * @returns the prompt ready to paste
 */
export function fillPrompt(text: string, context: PromptContext): string {
  const values: Record<string, string | undefined> = {
    TARGET_LANGUAGE:
      context.targetLanguage === undefined ? undefined : LANGUAGE_NAMES[context.targetLanguage],
    NATIVE_LANGUAGE:
      context.nativeLanguage === undefined ? undefined : LANGUAGE_NAMES[context.nativeLanguage],
    TARGET_CODE: context.targetLanguage,
    NATIVE_CODE: context.nativeLanguage,
    CEFR_LEVEL: context.level,
    DECK_NAME: context.deckName,
  };

  return text.replaceAll(/\[([A-Z_]+)\]/g, (whole, name: string) => values[name] ?? whole);
}

/** Which placeholders a filled prompt still has nothing for. */
export function missingFromPrompt(text: string): string[] {
  return [...new Set([...text.matchAll(/\[([A-Z_]+)\]/g)].map((match) => match[1] ?? ''))];
}

import { readPrompts } from '@neuron/shared';

import document from '../../../../docs/card-generation-prompt.md?raw';

/**
 * The card generation prompt, from the file that holds it.
 *
 * `docs/card-generation-prompt.md` is imported as text and read at build time,
 * so the prompt the app copies to the clipboard is the prompt in the repository
 * rather than a copy of it. Editing the document is the whole of editing the
 * prompt.
 *
 * The alternative was a string in the client and a document beside it, which is
 * two versions of the same thing and a certainty that one of them is out of
 * date within a month.
 */
export const PROMPTS = readPrompts(document);

import type { CardDirection } from '@neuron/core';
import { resolveDeckSettings, templatesFor } from '@neuron/shared';
import type { DeckSettings, NoteFields, NoteTypeName } from '@neuron/shared';

import type { Repositories } from './db/repositories/index.js';

/**
 * Which cards a new note starts with.
 *
 * Not all of them. A vocab note can produce four cards, and creating four on
 * day one triples the work of day one for a note the person has not learned
 * once yet. So directions open one at a time, on the ladder in the deck's
 * settings: recognition first, and the next only once the one before it has
 * proved it stuck.
 *
 * Everything past the first rung is opened later, by the scheduler or by hand
 * through the unlock endpoint. This decides only what exists the moment the
 * note is written.
 */

/**
 * The settings that apply inside one deck.
 *
 * Walks from the root down, nearest opinion winning, which is what people
 * expect from folders and what nobody thanks you for getting wrong.
 *
 * @param repositories the repositories for this user
 * @param deckId which deck
 * @returns the settings with every field filled in
 */
export async function settingsForDeck(repositories: Repositories, deckId: string) {
  const chain = await repositories.decks.chain(deckId);

  return resolveDeckSettings(chain.map((deck) => deck.settings as DeckSettings | null));
}

/**
 * The directions a note starts with.
 *
 * @param noteType which type the note is
 * @param fields the note's fields, which decide what is possible at all
 * @param ladder the rungs from the deck's settings, in order
 * @returns the directions to create cards for, usually one
 */
export function openingDirections(
  noteType: NoteTypeName,
  fields: NoteFields,
  ladder: readonly { readonly direction: CardDirection; readonly opensAtStability: number }[],
): CardDirection[] {
  const possible = new Set(templatesFor(noteType, fields).map((template) => template.direction));
  const opening = ladder
    .filter((rung) => rung.opensAtStability === 0 && possible.has(rung.direction))
    .map((rung) => rung.direction);

  if (opening.length > 0) {
    return opening;
  }

  /**
   * The ladder and the note type do not overlap.
   *
   * A cloze note produces one direction called `cloze`, and the default ladder
   * talks about recognition and recall. Without this the note would be created
   * with no cards at all, which looks exactly like the note not being created.
   * The first thing the type can actually produce is the honest answer.
   */
  const first = templatesFor(noteType, fields)[0];

  return first === undefined ? [] : [first.direction];
}

import { openingCards, reconcileCards, resolveDeckSettings } from '@neuron/shared';
import type {
  CardReconciliation,
  DeckSettings,
  NoteFields,
  NoteTypeName,
  PlannedCard,
} from '@neuron/shared';

import type { Repositories } from './db/repositories/index.js';

/**
 * Which cards a note has, applied to the database.
 *
 * The rules themselves are in `@neuron/shared`, in card-plan.ts, and this file
 * is the only thing in the api that reaches for them. Both ways a note can be
 * made, the editor and the importer, come through here, so there is one answer
 * to "what cards does this produce" and the editor's preview is drawing the
 * same one before anything is saved.
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
 * Creates the cards a new note starts with.
 *
 * @param repositories the repositories, already inside the transaction
 * @param noteId the note just written
 * @param deckId where it landed, for reading the ladder
 * @param noteType which type it is
 * @param fields its fields, which decide which directions are possible
 * @returns the cards written
 */
export async function createOpeningCards(
  repositories: Repositories,
  noteId: string,
  deckId: string,
  noteType: NoteTypeName,
  fields: NoteFields,
) {
  const settings = await settingsForDeck(repositories, deckId);

  return writeCards(repositories, noteId, openingCards(noteType, fields, settings.ladder));
}

/**
 * Writes a planned set of cards.
 *
 * @param repositories the repositories, already inside the transaction
 * @param noteId which note they belong to
 * @param planned what to write
 * @returns the rows written
 */
export async function writeCards(
  repositories: Repositories,
  noteId: string,
  planned: readonly PlannedCard[],
) {
  const now = new Date();

  return repositories.cards.createMany(
    planned.map((card) => ({
      noteId,
      direction: card.direction,
      slot: card.slot,
      due: now,
      unlockedAt: now,
    })),
  );
}

/** What an edit would do to a note's cards, before anything is written. */
export interface CardChange extends CardReconciliation {
  /** The ids of the cards that would go. */
  readonly removeIds: readonly string[];
}

/**
 * Works out what an edit does to a note's cards.
 *
 * Reads the note's cards, asks the shared rules what should exist afterwards,
 * and reports the difference. Nothing is written: the caller decides whether
 * losing what this says would be lost is allowed.
 *
 * @param repositories the repositories, inside the transaction
 * @param noteId which note
 * @param deckId which deck it is in, for the ladder
 * @param noteType the type it will have
 * @param fields the fields it will have
 * @param currentType the stored type before the edit
 * @returns what to keep, remove and create, and how much history it costs
 */
export async function planCardChange(
  repositories: Repositories,
  noteId: string,
  deckId: string,
  noteType: NoteTypeName,
  fields: NoteFields,
  currentType: NoteTypeName,
): Promise<CardChange> {
  const [settings, existing] = await Promise.all([
    settingsForDeck(repositories, deckId),
    repositories.cards.forNote(noteId),
  ]);

  const reconciliation = reconcileCards(
    existing.map((card) => ({
      direction: card.direction as PlannedCard['direction'],
      slot: card.slot,
      reps: card.reps,
    })),
    noteType,
    fields,
    settings.ladder,
    currentType,
  );

  const doomed = new Set(reconciliation.remove.map((card) => `${card.direction}:${card.slot}`));
  const removeIds = existing
    .filter((card) => doomed.has(`${card.direction}:${card.slot}`))
    .map((card) => card.id);

  return {
    ...reconciliation,
    removeIds,
    // Reset cards have reps=0 but still own immutable review history.
    reviewsLost: Math.max(
      reconciliation.reviewsLost,
      await repositories.reviews.countForCards(removeIds),
    ),
  };
}

/**
 * Applies what `planCardChange` worked out.
 *
 * @param repositories the repositories, inside the transaction
 * @param noteId which note
 * @param change what to do
 */
export async function applyCardChange(
  repositories: Repositories,
  noteId: string,
  change: CardChange,
): Promise<void> {
  if (change.removeIds.length > 0) {
    await repositories.cards.softDeleteMany(change.removeIds);
  }

  if (change.create.length > 0) {
    await writeCards(repositories, noteId, change.create);
  }
}

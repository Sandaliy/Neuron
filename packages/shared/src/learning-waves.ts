import { z } from 'zod';

import type { WorkloadCard } from '@neuron/core';

/**
 * Learning waves: a Deck's new material, cut into finite pieces.
 *
 * A Deck's Notes in Study are taken in creation order, which for an import is
 * the order of the file, and cut into waves of {@link WAVE_SIZE}. The wave now
 * entering Study is the first one that still holds a Note with no answered
 * Card. Nothing is stored: every device works the waves out from the Cards it
 * plans with, so the server and an offline plan agree by construction.
 *
 * A wave decides which new Cards fill the places the workload throttle allows,
 * never how many places there are. Inside a wave, Unsure Notes come before New
 * ones, so a quick check settles them early. Nothing moves further than one
 * wave ahead of where the file put it.
 *
 * Known, Set aside and Draft Notes have no Cards in planning, so they are in no
 * wave. A Note started again with Restart learning is back in its own wave and
 * is among the first to return.
 */

/** Notes in one wave. */
export const WAVE_SIZE = 50;

export const deckWaveSchema = z.object({
  deckId: z.string(),
  /** The wave now entering Study, from 1. Zero once every Note has started. */
  number: z.number().int().min(0),
  /** Waves in the Deck, finished ones included. */
  count: z.number().int().min(0),
  /** Notes in the current wave. */
  size: z.number().int().min(0),
  /** Notes of the current wave with an answered Card. */
  started: z.number().int().min(0),
  /** Notes of the current wave not started yet. */
  waiting: z.number().int().min(0),
  /** Of those waiting, the Unsure ones, which start first. */
  unsure: z.number().int().min(0),
  /** Notes not started in the waves after this one. */
  later: z.number().int().min(0),
  /** Notes of this Deck that today's plan starts. */
  today: z.number().int().min(0),
});
export type DeckWave = z.infer<typeof deckWaveSchema>;

/** Admission rank of a Card: its wave first, Unsure before New inside it. */
export function waveRank(wave: number, unsure: boolean): number {
  return wave * 2 + (unsure ? 0 : 1);
}

interface WaveNote {
  readonly id: string;
  started: boolean;
}

/**
 * Ranks every Card by its Note's wave and summarises each Deck's current wave.
 *
 * @param cards the Cards planning sees, Notes in Study only
 * @param unsure Notes marked Unsure in triage
 * @returns the same Cards with an admission rank, and one summary per Deck
 */
export function learningWaves<T extends WorkloadCard>(
  cards: readonly T[],
  unsure: ReadonlySet<string>,
): { cards: T[]; decks: Omit<DeckWave, 'today'>[] } {
  const byDeck = new Map<string, Map<string, WaveNote>>();
  for (const card of cards) {
    const deckId = card.deckId ?? '';
    let notes = byDeck.get(deckId);
    if (!notes) byDeck.set(deckId, (notes = new Map()));
    let note = notes.get(card.noteId);
    if (!note) notes.set(card.noteId, (note = { id: card.noteId, started: false }));
    if (card.scheduling.state !== 'new') note.started = true;
  }

  const waveOf = new Map<string, number>();
  const decks: Omit<DeckWave, 'today'>[] = [];
  for (const [deckId, notes] of [...byDeck].sort(([a], [b]) => a.localeCompare(b))) {
    // Version 7 ids sort as creation time, which is the order of the imported file.
    const ordered = [...notes.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    ordered.forEach((note, index) => waveOf.set(note.id, Math.floor(index / WAVE_SIZE)));
    const firstWaiting = ordered.findIndex((note) => !note.started);
    const current = firstWaiting < 0 ? -1 : Math.floor(firstWaiting / WAVE_SIZE);
    const members =
      current < 0 ? [] : ordered.slice(current * WAVE_SIZE, (current + 1) * WAVE_SIZE);
    const waiting = members.filter((note) => !note.started);
    decks.push({
      deckId,
      number: current + 1,
      count: Math.ceil(ordered.length / WAVE_SIZE),
      size: members.length,
      started: members.length - waiting.length,
      waiting: waiting.length,
      unsure: waiting.filter((note) => unsure.has(note.id)).length,
      later:
        current < 0
          ? 0
          : ordered.slice((current + 1) * WAVE_SIZE).filter((note) => !note.started).length,
    });
  }

  return {
    cards: cards.map((card) => ({
      ...card,
      admissionRank: waveRank(waveOf.get(card.noteId) ?? 0, unsure.has(card.noteId)),
    })),
    decks,
  };
}

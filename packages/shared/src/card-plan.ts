import type { CardDirection } from '@neuron/core';

import { NOTE_TYPE_TEMPLATES, clozeGaps, templatesFor } from './note-types.js';

import type { CardTemplate, ClozeFields, NoteFields, NoteTypeName } from './note-types.js';

/**
 * Which cards a note produces. The only implementation of it.
 *
 * The editor draws its preview from this, the importer creates its cards from
 * it, and the api reconciles an edited note against it. Two implementations
 * would diverge quietly, and the difference would surface months later as
 * cards behaving differently depending on how they were added.
 *
 * It lives in this package rather than in the api because the editor has to
 * show, while somebody is typing and before anything is saved, exactly what
 * the server will create. A copy of the rules in the client is the divergence,
 * one release later.
 *
 * Pure, like packages/core: no clock, no io, nothing injected. What it does not
 * decide is when a direction opens. That is the ladder in the deck settings and,
 * from phase 9, the progressive unlocking rule. This decides what exists.
 */

/** One line of a card, and which field it came from. */
export interface CardFace {
  readonly field: string;
  readonly value: string;
}

/** A card that does not exist yet, described well enough to draw. */
export interface PlannedCard {
  readonly direction: CardDirection;
  /**
   * Which gap this card hides, on a cloze note. Zero everywhere else.
   *
   * A sentence with three gaps is three cards, all of them in the `cloze`
   * direction, so the direction alone cannot tell them apart.
   */
  readonly slot: number;
  readonly front: readonly CardFace[];
  readonly back: readonly CardFace[];
}

/** A card that already exists, as much of it as reconciling needs. */
export interface ExistingCard {
  readonly direction: CardDirection;
  readonly slot: number;
  /** How many times it has been answered. */
  readonly reps: number;
}

/** What has to happen for a note's cards to match its fields again. */
export interface CardReconciliation {
  readonly keep: readonly ExistingCard[];
  /** Cards whose direction or gap the note no longer has. */
  readonly remove: readonly ExistingCard[];
  readonly create: readonly PlannedCard[];
  /** Answers that would be lost with the cards being removed. */
  readonly reviewsLost: number;
}

/** One rung of the ladder, as much of it as this file needs. */
export interface LadderStep {
  readonly direction: CardDirection;
  readonly opensAtStability: number;
}

function text(fields: NoteFields, name: string): string {
  const value = (fields as Record<string, unknown>)[name];

  return typeof value === 'string' ? value : '';
}

function faces(fields: NoteFields, names: readonly string[]): CardFace[] {
  return names
    .map((name) => ({ field: name, value: text(fields, name) }))
    .filter((face) => face.value !== '');
}

/** The blank a gap leaves behind, or the hint the author wrote in it. */
function blank(hint: string | undefined): string {
  return hint === undefined ? '[...]' : `[${hint}]`;
}

/**
 * One cloze card: the text with one number's gaps blanked out.
 *
 * Gaps sharing a number go together, so `{{c1::der}} Hund und {{c1::die}} Katze`
 * hides both articles on one card, which is the reason the numbering exists.
 * The back is the same text with every gap filled in, so the answer reads as a
 * sentence rather than as a word on its own.
 *
 * @param value the text as the author wrote it
 * @param number which gap number this card hides
 * @returns the two sides
 */
function clozeSides(value: string, number: number): { front: CardFace[]; back: CardFace[] } {
  const gaps = clozeGaps(value);
  let front = '';
  let back = '';
  let cursor = 0;

  for (const gap of gaps) {
    const before = value.slice(cursor, gap.start);

    front += before + (gap.number === number ? blank(gap.hint) : gap.answer);
    back += before + gap.answer;
    cursor = gap.end;
  }

  return {
    front: [{ field: 'text', value: front + value.slice(cursor) }],
    back: [{ field: 'text', value: back + value.slice(cursor) }],
  };
}

function plan(noteType: NoteTypeName, fields: NoteFields, template: CardTemplate): PlannedCard[] {
  if (noteType !== 'cloze') {
    return [
      {
        direction: template.direction,
        slot: 0,
        front: faces(fields, template.ask),
        back: faces(fields, template.answer),
      },
    ];
  }

  const value = (fields as ClozeFields).text;
  // Sorted and deduplicated, so the cards come back in the order the numbers
  // read rather than in the order the gaps happen to appear.
  const numbers = [...new Set(clozeGaps(value).map((gap) => gap.number))].sort((a, b) => a - b);

  return numbers.map((number) => ({
    direction: template.direction,
    slot: number,
    ...clozeSides(value, number),
  }));
}

/**
 * Every card this note could ever produce.
 *
 * Not what it starts with. A vocab note can be asked in three directions and
 * begins with one, and this is the list the other two are opened from later.
 *
 * @param noteType which type the note is
 * @param fields its fields
 * @returns every possible card, drawn
 */
export function possibleCards(noteType: NoteTypeName, fields: NoteFields): PlannedCard[] {
  return templatesFor(noteType, fields).flatMap((template) => plan(noteType, fields, template));
}

/**
 * The cards a new note starts with.
 *
 * Not all of them. A vocab note can produce four cards, and creating four on
 * day one triples the work of day one for a word nobody has learned once yet.
 * So directions open one at a time, on the ladder in the deck settings:
 * recognition first, and the next only once the one before it has proved it
 * stuck.
 *
 * @param noteType which type the note is
 * @param fields its fields, which decide what is possible at all
 * @param ladder the rungs from the deck settings, in order
 * @returns the cards to create now, usually one
 */
export function openingCards(
  noteType: NoteTypeName,
  fields: NoteFields,
  ladder: readonly LadderStep[],
): PlannedCard[] {
  const possible = possibleCards(noteType, fields);
  const opening = new Set(
    ladder.filter((rung) => rung.opensAtStability === 0).map((rung) => rung.direction),
  );
  const opened = possible.filter((card) => opening.has(card.direction));

  if (opened.length > 0) {
    return opened;
  }

  /*
   * The ladder and the note type do not overlap.
   *
   * A cloze note produces one direction called `cloze`, and the default ladder
   * talks about recognition and recall. Without this the note would be created
   * with no cards at all, which looks exactly like the note not being created.
   * The first direction the type can actually produce is the honest answer, and
   * every card in it, because a cloze note's cards are one sentence between
   * them rather than three ways of asking the same thing.
   */
  const first = possible[0];

  return first === undefined ? [] : possible.filter((card) => card.direction === first.direction);
}

function key(card: { direction: CardDirection; slot: number }): string {
  return `${card.direction}:${card.slot}`;
}

/**
 * What has to change for an edited note's cards to match it again.
 *
 * The rule this exists to enforce: editing a note does not destroy scheduling
 * state. Fixing a translation on a word answered forty times keeps the forty.
 * Cards are removed only when the note can no longer produce them, which
 * happens when the type changes or when a cloze gap is taken out, and the
 * interface asks before it does that.
 *
 * Nothing here opens a new direction. A note that keeps at least one card keeps
 * exactly the directions it had, because opening the next one is the ladder's
 * decision and it is made from a card's stability rather than from an edit. The
 * one thing it does add is a missing card in a direction that is already there,
 * which is what a fourth gap in a cloze sentence is.
 *
 * @param existing the cards the note has now
 * @param noteType the type it will be after the edit
 * @param fields the fields it will have after the edit
 * @param ladder the rungs from the deck settings
 * @returns what to keep, what to remove, what to create, and what it costs
 */
export function reconcileCards(
  existing: readonly ExistingCard[],
  noteType: NoteTypeName,
  fields: NoteFields,
  ladder: readonly LadderStep[],
): CardReconciliation {
  const possible = possibleCards(noteType, fields);
  const possibleKeys = new Set(possible.map(key));
  const keep = existing.filter((card) => possibleKeys.has(key(card)));
  const remove = existing.filter((card) => !possibleKeys.has(key(card)));

  if (keep.length === 0) {
    return {
      keep,
      remove,
      create: openingCards(noteType, fields, ladder),
      reviewsLost: remove.reduce((total, card) => total + card.reps, 0),
    };
  }

  const present = new Set(keep.map(key));
  const directions = new Set(keep.map((card) => card.direction));

  return {
    keep,
    remove,
    create: possible.filter((card) => directions.has(card.direction) && !present.has(key(card))),
    reviewsLost: remove.reduce((total, card) => total + card.reps, 0),
  };
}

/** Every direction a type can ever be asked in, whatever is filled in. */
export function directionsOf(noteType: NoteTypeName): readonly CardDirection[] {
  return NOTE_TYPE_TEMPLATES[noteType].map((template) => template.direction);
}

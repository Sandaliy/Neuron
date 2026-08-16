import type {
  Card,
  Deck,
  DeckNode,
  ImportBatch,
  Note,
  NoteTypeName,
  StudyPreset,
} from '@neuron/shared';

import type {
  CardRow,
  DeckCount,
  DeckRow,
  ImportBatchRow,
  NoteRow,
  StudyPresetRow,
} from './db/repositories/index.js';

/**
 * Turning database rows into what goes over the wire.
 *
 * Two things happen here and nowhere else. Dates become ISO strings with an
 * offset, because a JSON number of milliseconds is a date that has quietly lost
 * its timezone. And columns that exist only inside the database stay inside it:
 * `user_id` is on every row and is on nothing this returns, since a client that
 * had to be told whose data it was reading would be a client that could ask for
 * somebody else's.
 */

/** A timestamp, or null. */
function moment(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

export function serialiseDeck(row: DeckRow): Deck {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parentId,
    position: row.position,
    path: row.path,
    settings: row.settings ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    rev: row.rev,
  };
}

export function serialiseNote(row: NoteRow, typeNames: Map<string, string>): Note {
  return {
    id: row.id,
    deckId: row.deckId,
    noteType: (typeNames.get(row.noteTypeId) ?? 'basic') as NoteTypeName,
    fields: row.fields as Record<string, unknown>,
    tags: row.tags,
    source: row.source,
    rank: row.rank,
    status: row.status as Note['status'],
    importBatchId: row.importBatchId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    rev: row.rev,
  };
}

export function serialiseCard(row: CardRow): Card {
  return {
    id: row.id,
    noteId: row.noteId,
    deckId: row.deckId,
    direction: row.direction as Card['direction'],
    slot: row.slot,
    state: row.state as Card['state'],
    stability: row.stability,
    difficulty: row.difficulty,
    due: row.due.toISOString(),
    lastReview: moment(row.lastReview),
    reps: row.reps,
    lapses: row.lapses,
    learningStep: row.learningStep,
    suspendedAt: moment(row.suspendedAt),
    unlockedAt: moment(row.unlockedAt),
    updatedAt: row.updatedAt.toISOString(),
    rev: row.rev,
  };
}

export function serialisePreset(row: StudyPresetRow): StudyPreset {
  return {
    id: row.id,
    name: row.name,
    deckId: row.deckId,
    config: row.config,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    rev: row.rev,
  };
}

export function serialiseImportBatch(row: ImportBatchRow): ImportBatch {
  return {
    id: row.id,
    deckId: row.deckId,
    source: row.source,
    format: row.format,
    noteCount: row.noteCount,
    undoneAt: moment(row.undoneAt),
    createdAt: row.createdAt.toISOString(),
    rev: row.rev,
  };
}

/**
 * Builds the library tree, with the counts rolled up.
 *
 * The counts arrive per deck, from one query over the whole collection. Rolling
 * them up the tree happens here, in arithmetic, using the `path` array each
 * deck already carries: every deck adds its own numbers to itself and to every
 * ancestor named in its path. That is one pass over the decks rather than a
 * query per deck, which matters because this is the first screen of the app and
 * the counts query was measured as the slowest one in the schema.
 *
 * @param rows every deck the user has, in sibling order
 * @param counts what each deck holds on its own
 * @returns the roots, each with its children and its totals
 */
export function buildDeckTree(rows: readonly DeckRow[], counts: readonly DeckCount[]): DeckNode[] {
  const own = new Map(counts.map((count) => [count.deckId, count]));
  const totals = new Map<string, { due: number; fresh: number }>();

  for (const deck of rows) {
    totals.set(deck.id, { due: 0, fresh: 0 });
  }

  for (const deck of rows) {
    const mine = own.get(deck.id);

    if (!mine) {
      continue;
    }

    for (const target of [deck.id, ...deck.path]) {
      const running = totals.get(target);

      if (running) {
        running.due += mine.due;
        running.fresh += mine.fresh;
      }
    }
  }

  const nodes = new Map<string, DeckNode & { children: DeckNode[] }>();

  for (const deck of rows) {
    const total = totals.get(deck.id) ?? { due: 0, fresh: 0 };

    nodes.set(deck.id, {
      ...serialiseDeck(deck),
      due: total.due,
      fresh: total.fresh,
      children: [],
    });
  }

  const roots: DeckNode[] = [];

  for (const deck of rows) {
    const node = nodes.get(deck.id);

    if (!node) {
      continue;
    }

    const parent = deck.parentId === null ? undefined : nodes.get(deck.parentId);

    if (parent) {
      parent.children.push(node);
    } else {
      // A deck whose parent is soft deleted is shown at the root rather than
      // hidden. Losing a folder should not lose what was inside it.
      roots.push(node);
    }
  }

  return roots;
}

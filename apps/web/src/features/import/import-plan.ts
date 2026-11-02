import { noteTermKey, rowProblems, termCounts, uuidV7 } from '@neuron/shared';
import type { DuplicateMatch, NoteTypeName, ParsedRow, ParseResult } from '@neuron/shared';

export type Resolution = 'skip' | 'merge' | 'create';
export type Overrides = Readonly<Record<number, Resolution>>;

export function groupMatches(matches: readonly DuplicateMatch[]) {
  const groups = new Map<string, DuplicateMatch[]>();
  const seen = new Map<string, Set<string>>();

  for (const match of matches) {
    const group = groups.get(match.term) ?? [];

    // A term repeated across lookup chunks can return the same note twice.
    const ids = seen.get(match.term) ?? new Set<string>();
    if (!ids.has(match.noteId)) group.push(match);
    ids.add(match.noteId);
    seen.set(match.term, ids);
    groups.set(match.term, group);
  }

  return groups;
}

/** Field diagnostics depend on source rows, never on duplicate choices or save status. */
export function analyseImport(parsed: ParseResult) {
  const counts = termCounts(parsed.rows);
  return parsed.rows.map((row) => ({
    key: noteTermKey(row.fields),
    problems: rowProblems(row, parsed.noteType, counts),
  }));
}

export function resolveDuplicate(
  matches: readonly DuplicateMatch[],
  noteType: NoteTypeName,
  defaultAction: Resolution,
  override?: Resolution,
) {
  const eligible = matches.filter((match) => match.noteType === noteType);
  const target = eligible.length === 1 ? eligible[0] : undefined;
  const requested = override ?? defaultAction;
  const action =
    matches.length === 0 ? 'create' : requested === 'merge' && !target ? 'skip' : requested;

  return { action, target, ambiguous: eligible.length > 1, incompatible: eligible.length === 0 };
}

/** Preview and execution share exactly the same effective row decisions. */
export function planRows(
  parsed: ParseResult,
  duplicates: readonly DuplicateMatch[],
  resolution: Resolution,
  overrides: Overrides = {},
  analysis = analyseImport(parsed),
) {
  const known = groupMatches(duplicates);
  const seen = new Set<string>();
  const create: ParsedRow[] = [];
  const merge: { noteId: string; fields: Record<string, unknown> }[] = [];
  let skipped = 0;

  for (const [index, row] of parsed.rows.entries()) {
    const { key, problems } = analysis[index]!;

    if (problems.missing.length > 0 || (key !== '' && seen.has(key))) {
      skipped += 1;
      continue;
    }

    seen.add(key);
    const decision = resolveDuplicate(
      known.get(key) ?? [],
      parsed.noteType,
      resolution,
      overrides[row.line],
    );

    if (decision.action === 'create') create.push(row);
    else if (decision.action === 'merge' && decision.target) {
      merge.push({ noteId: decision.target.noteId, fields: row.fields });
    } else skipped += 1;
  }

  return { create, merge, skipped };
}

/** IDs and decisions are frozen once, before the first request of this attempt. */
export function createAttempt(
  parsed: ParseResult,
  duplicates: readonly DuplicateMatch[],
  resolution: Resolution,
  overrides: Overrides,
  deckId: string,
) {
  const plan = planRows(parsed, duplicates, resolution, overrides);

  return {
    ...plan,
    create: plan.create.map((row) => ({ ...row, id: uuidV7() })),
    batchId: uuidV7(),
    deckId,
    noteType: parsed.noteType,
    format: parsed.format,
    source: parsed.source ?? `Imported ${parsed.format.toUpperCase()}`,
  };
}

export type ImportAttempt = ReturnType<typeof createAttempt>;

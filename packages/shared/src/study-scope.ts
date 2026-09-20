/** Actual parent links govern live scope. Folders organize, never study. */
export function studyDecks<T extends { id: string; parentId: string | null; kind: string }>(
  rows: readonly T[],
): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return rows.filter((row) => {
    if (row.kind !== 'deck') return false;
    const seen = new Set([row.id]);
    let parent = row.parentId;
    while (parent !== null) {
      const ancestor = byId.get(parent);
      if (!ancestor || ancestor.kind !== 'folder' || seen.has(parent)) return false;
      seen.add(parent);
      parent = ancestor.parentId;
    }
    return true;
  });
}

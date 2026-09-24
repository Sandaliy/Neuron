import type { DeckNode, DeckSettings } from '@neuron/shared';

import type { QueryClient } from '@tanstack/react-query';

type Fields = { name?: string; settings?: DeckSettings | null };
/** Patch only the edited fields, including rollback, preserving sibling changes. */
export function projectDeck(client: QueryClient, id: string, fields: Fields) {
  void client.cancelQueries({ queryKey: ['decks'] });
  let before: Fields | undefined;
  const patch = (rows: readonly DeckNode[], rollback: boolean): DeckNode[] =>
    rows.map((row) => {
      const children = patch(row.children, rollback);
      if (row.id !== id)
        return children.some((child, at) => child !== row.children[at])
          ? { ...row, children }
          : row;
      if (!rollback) {
        before = { name: row.name, settings: row.settings };
        return { ...row, ...fields, children };
      }
      const restored: Fields = {};
      if (fields.name !== undefined && row.name === fields.name && before?.name !== undefined)
        restored.name = before.name;
      if (
        fields.settings !== undefined &&
        JSON.stringify(row.settings) === JSON.stringify(fields.settings) &&
        before?.settings !== undefined
      )
        restored.settings = before.settings;
      return { ...row, ...restored, children };
    });
  client.setQueryData<{ decks: DeckNode[] }>(
    ['decks'],
    (data) => data && { decks: patch(data.decks, false) },
  );
  return () =>
    client.setQueryData<{ decks: DeckNode[] }>(
      ['decks'],
      (data) => data && { decks: patch(data.decks, true) },
    );
}

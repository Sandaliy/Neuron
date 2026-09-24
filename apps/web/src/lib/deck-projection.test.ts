import { QueryClient } from '@tanstack/react-query';
import { expect, it } from 'vitest';

import type { DeckNode } from '@neuron/shared';

import { projectDeck } from './deck-projection';

it('rolls back settings without reverting a concurrent rename or sibling edit', () => {
  const client = new QueryClient();
  const one = { id: 'one', name: 'One', settings: null, children: [] } as unknown as DeckNode;
  const two = { ...one, id: 'two', name: 'Two' };
  client.setQueryData(['decks'], { decks: [one, two] });
  const rollback = projectDeck(client, 'one', { settings: { targetLanguage: 'de' } });
  projectDeck(client, 'one', { name: 'Renamed' });
  projectDeck(client, 'two', { name: 'Kept' });
  rollback();
  const result = client.getQueryData<{ decks: DeckNode[] }>(['decks'])!;
  expect(result.decks[0]).toMatchObject({ name: 'Renamed', settings: null });
  expect(result.decks[1]!.name).toBe('Kept');
});

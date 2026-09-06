import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '../../testing/render';

import { DeletedScreen } from './deleted';

const deck = {
  id: 'deck-1',
  name: 'Lesson 3',
  parentId: 'deck-0',
  position: 0,
  path: ['deck-0'],
  settings: null,
  createdAt: '2026-09-06T00:00:00.000Z',
  updatedAt: '2026-09-06T00:00:00.000Z',
  rev: 1,
  pathNames: ['German'],
  parentDeleted: false,
};

const note = {
  id: 'note-1',
  deckId: 'deck-1',
  noteType: 'basic' as const,
  fields: { front: 'Haus', back: 'House' },
  tags: [],
  source: null,
  rank: null,
  status: 'active' as const,
  importBatchId: null,
  createdAt: '2026-09-06T00:00:00.000Z',
  updatedAt: '2026-09-06T00:00:00.000Z',
  rev: 1,
  deckPath: ['German', 'Lesson 3'],
  deckLive: true,
};

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe('deleted content recovery', () => {
  beforeEach(() => {
    let decks = [deck];
    let notes = [note];

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.endsWith('/decks/deleted')) return Promise.resolve(json({ decks }));
        if (url.endsWith('/notes/deleted')) return Promise.resolve(json({ notes }));
        if (url.endsWith('/decks/deck-1/restore') && init?.method === 'POST') {
          decks = [];
          return Promise.resolve(json({ restored: 1 }));
        }
        if (url.endsWith('/notes/note-1/restore') && init?.method === 'POST') {
          notes = [];
          return Promise.resolve(
            json({ restored: true, cardsRestored: 1, cardsRemainingDeleted: 2 }),
          );
        }

        return Promise.resolve(json({ decks: [] }));
      }),
    );
  });

  it('restores a deck from the row action and removes it only after the response', async () => {
    const user = userEvent.setup();
    renderScreen(<DeletedScreen />);

    expect(await screen.findByText('Lesson 3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Restore' }));

    expect(await screen.findByText('No deleted decks')).toBeInTheDocument();
  });

  it('keeps a blocked deck unavailable and reports partial note recovery honestly', async () => {
    const user = userEvent.setup();
    renderScreen(<DeletedScreen />);

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/decks/deleted'))
          return Promise.resolve(json({ decks: [{ ...deck, parentDeleted: true }] }));
        if (url.endsWith('/notes/deleted')) return Promise.resolve(json({ notes: [note] }));
        if (url.endsWith('/notes/note-1/restore') && init?.method === 'POST') {
          return Promise.resolve(
            json({ restored: true, cardsRestored: 1, cardsRemainingDeleted: 2 }),
          );
        }
        return Promise.resolve(json({ notes: [] }));
      }),
    );

    expect(await screen.findByText('Restore its original parent deck first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore' })).toBeDisabled();

    await user.click(screen.getByLabelText('Notes'));
    expect(await screen.findByText('Haus')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Restore' }));

    expect(await screen.findByText('Note restored. 2 cards remain deleted.')).toBeInTheDocument();
  });
});

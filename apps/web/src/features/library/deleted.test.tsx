import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as offline from '../../lib/offline';
import { renderScreen } from '../../testing/render';

import { DeletedScreen } from './deleted';

const deck = {
  id: 'deck-1',
  kind: 'deck' as const,
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
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    vi.spyOn(offline, 'offlineState').mockReturnValue({
      ...offline.offlineState(),
      validated: true,
    });
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

    expect(await screen.findByText('No deleted folders or decks')).toBeInTheDocument();
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

    expect(await screen.findByText('Restore the parent folder first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore' })).toBeDisabled();

    await user.click(screen.getByLabelText('Notes'));
    expect(await screen.findByText('Haus')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Restore' }));

    expect(await screen.findByText('Note restored. 2 cards remain deleted.')).toBeInTheDocument();
  });

  it('searches content and location without losing input focus and retains category choices', async () => {
    const user = userEvent.setup();
    renderScreen(<DeletedScreen />);
    await screen.findByText('Lesson 3');
    await user.type(screen.getByRole('searchbox'), 'german');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Order' }), 'alpha');
    await user.click(screen.getByLabelText('Notes'));
    await screen.findByText('Haus');
    const search = screen.getByRole('searchbox');
    await user.type(search, 'HOUSE lesson');
    expect(search).toHaveFocus();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 of 1'));
    expect(screen.getByText('Haus')).toBeVisible();
    await user.clear(search);
    await user.type(search, 'missing');
    expect(await screen.findByText('No matches')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Delete permanently' })).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('Folders & decks'));
    await waitFor(() => expect(screen.getByRole('searchbox')).toHaveValue('german'));
    expect(screen.getByRole('combobox')).toHaveValue('alpha');
    await user.click(screen.getByLabelText('Notes'));
    await waitFor(() => expect(screen.getByRole('searchbox')).toHaveValue('missing'));
  });

  it('keeps supporting ancestors and never enables a matched child with a deleted parent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          json({
            decks: [
              { ...deck, id: 'parent', name: 'German', parentId: null, pathNames: [] },
              { ...deck, parentId: 'parent', parentDeleted: true },
              { ...deck, id: 'other', name: 'Unrelated', parentId: null },
            ],
          }),
        ),
      ),
    );
    const user = userEvent.setup();
    renderScreen(<DeletedScreen />);
    await screen.findByText('Lesson 3');
    await user.click(screen.getByRole('button', { expanded: true }));
    expect(screen.queryByText('Lesson 3')).not.toBeInTheDocument();
    await user.type(screen.getByRole('searchbox'), 'lesson');
    const child = (await screen.findByText('Lesson 3')).closest('[role="listitem"]') as HTMLElement;
    expect(within(child).getByRole('button', { name: 'Restore' })).toBeDisabled();
    expect(within(screen.getAllByRole('listitem')[0]!).getByText('German')).toBeVisible();
    expect(screen.queryByText('Unrelated')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 of 3');
    expect(screen.getAllByRole('button', { name: 'Delete permanently' })).toHaveLength(1);
  });

  it('restores a matching Note, retains its query and rolls back a failed recovery with an error', async () => {
    let failed = true;
    let available = true;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/notes/deleted'))
          return Promise.resolve(json({ notes: available ? [note] : [] }));
        if (url.endsWith('/notes/note-1/restore')) {
          if (failed)
            return Promise.resolve(
              new Response(JSON.stringify({ error: { code: 'internal_error' } }), { status: 500 }),
            );
          available = false;
          return Promise.resolve(
            json({ restored: true, cardsRestored: 1, cardsRemainingDeleted: 2 }),
          );
        }
        return Promise.resolve(json({ decks: [deck] }));
      }),
    );
    const user = userEvent.setup();
    renderScreen(<DeletedScreen />);
    await user.click(await screen.findByLabelText('Notes'));
    await screen.findByText('Haus');
    await user.type(screen.getByRole('searchbox'), 'house');
    await waitFor(() =>
      expect(screen.getByRole('searchbox')).toHaveAttribute('aria-busy', 'false'),
    );
    await user.click(screen.getByRole('button', { name: 'Restore' }));
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(screen.getByText('Haus')).toBeVisible();
    failed = false;
    await user.click(screen.getByRole('button', { name: 'Restore' }));
    expect(await screen.findByText('Note restored. 2 cards remain deleted.')).toBeVisible();
    expect(screen.getByRole('searchbox')).toHaveValue('house');
    expect(await screen.findByText('No deleted notes')).toBeVisible();
  });

  it('exposes loading and a retryable read error', async () => {
    let release!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      ),
    );
    const user = userEvent.setup();
    renderScreen(<DeletedScreen />);
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeVisible();
    release(new Response(JSON.stringify({ error: { code: 'internal_error' } }), { status: 500 }));
    expect(await screen.findByRole('alert')).toBeVisible();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(json({ decks: [] }))),
    );
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No deleted folders or decks')).toBeVisible();
  });

  it('does not offer stale collection actions after an acknowledged restore when the read fails', async () => {
    let restored = false;
    let failRefresh = true;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/decks/deck-1/restore')) {
          restored = true;
          return Promise.resolve(json({ restored: 1 }));
        }
        if (url.endsWith('/decks/deleted') && restored && failRefresh)
          return Promise.resolve(
            new Response(JSON.stringify({ error: { code: 'internal_error' } }), { status: 500 }),
          );
        return Promise.resolve(json({ decks: restored ? [] : [deck] }));
      }),
    );
    const user = userEvent.setup();
    renderScreen(<DeletedScreen />);
    await screen.findByText('Lesson 3');
    await user.click(screen.getByRole('button', { name: 'Restore' }));
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Restore' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Delete permanently' })).not.toBeInTheDocument();
    failRefresh = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No deleted folders or decks')).toBeVisible();
  });
});

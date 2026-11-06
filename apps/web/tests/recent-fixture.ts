import {
  compareRecentNotes,
  recentNoteCursor,
  readRecentNoteCursor,
  recentNoteTime,
} from '@neuron/shared';
import type { Note, RecentNoteSort } from '@neuron/shared';

import {
  manyNotes,
  manyDecks,
  useFixtures as installFixtures,
  usePreferences as installPreferences,
} from './fixtures';

import type { Page } from '@playwright/test';

export async function installRecentFixture(page: Page) {
  const base = Date.parse('2026-11-01T00:00:00.000Z');
  const notes = manyNotes(6500).map((note, index) => ({
    ...note,
    id: `01900000-0000-7000-8000-${String(index + 1).padStart(12, '0')}`,
    deckId: `deck_${index % 2}`,
    tags: ['recent'],
    source: 'Lesson',
    createdAt: new Date(base - Math.floor(index / 2) * 1000).toISOString(),
    updatedAt: new Date(base + Math.floor(index / 2) * 1000).toISOString(),
    status: index % 2 ? 'known' : 'active',
  })) as Note[];
  const requests: URL[] = [];
  await installPreferences(page, { theme: 'dark', locale: 'en', glass: 'off' });
  await installFixtures(page, { notes: [], decks: manyDecks(2) });
  await page.route('**/api/notes?*', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const params = url.searchParams;
    const sort = params.get('sort') as RecentNoteSort;
    const boundary = params.get('cursor') ? readRecentNoteCursor(params.get('cursor')!) : undefined;
    const anchor = boundary
      ? { id: boundary.id, createdAt: boundary.timestamp, updatedAt: boundary.timestamp }
      : undefined;
    const matching = notes.filter(
      (note) =>
        (!params.has('status') || note.status === params.get('status')) &&
        (!params.has('tag') || note.tags.includes(params.get('tag')!)) &&
        (!params.has('source') || note.source === params.get('source')) &&
        (!params.has('search') ||
          JSON.stringify(note.fields).toLowerCase().includes(params.get('search')!.toLowerCase())),
    );
    matching.sort((a, b) => compareRecentNotes(a, b, sort));
    const after = matching.filter((note) => !anchor || compareRecentNotes(note, anchor, sort) > 0);
    const items = after.slice(0, 1000);
    await route.fulfill({
      json: {
        items,
        ...(after.length > 1000
          ? {
              nextCursor: recentNoteCursor(
                sort,
                recentNoteTime(items.at(-1)!, sort),
                items.at(-1)!.id,
              ),
            }
          : {}),
      },
    });
  });
  await page.route(/\/api\/notes\/[0-9a-f-]{36}$/, (route) =>
    route.fulfill({
      json: {
        note: notes.find((note) =>
          route
            .request()
            .url()
            .endsWith('/' + note.id),
        ),
        cards: [],
      },
    }),
  );
  return { notes, requests };
}

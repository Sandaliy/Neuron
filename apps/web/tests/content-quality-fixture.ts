import { expect } from '@playwright/test';

import { CONTENT_CHECKS, contentChecks, contentQualitySearchText } from '@neuron/shared';
import type { ContentCheck, Deck, Note } from '@neuron/shared';

import { useFixtures as installFixtures, usePreferences as installPreferences } from './fixtures';

import type { Page } from '@playwright/test';

export const qualityId = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`;
export const qualityDeckId = qualityId(2);
const date = '2026-11-05T00:00:00.000Z';
const folder: Deck = {
  id: qualityId(1),
  name: 'Imported vocabulary / Слова',
  kind: 'folder',
  parentId: null,
  position: 0,
  settings: null,
  path: [],
  createdAt: date,
  updatedAt: date,
  rev: 1,
};
const decks: Deck[] = [
  folder,
  {
    ...folder,
    id: qualityDeckId,
    name: 'Lesson A with a long collection name',
    kind: 'deck',
    parentId: folder.id,
    rev: 2,
  },
  { ...folder, id: qualityId(3), name: 'Lesson B', kind: 'deck', rev: 3 },
];
export const qualityPath = (deckId: string) =>
  deckId === qualityDeckId ? [folder.name, decks[1]!.name] : ['Lesson B'];

export async function installQualityFixture(page: Page, size = 6500, complete = true) {
  await installPreferences(page, { locale: 'en', theme: 'dark', glassScope: 'floating' });
  await installFixtures(page);
  const vocabulary = Math.max(0, size - (size >= 6000 ? 1000 : 0));
  const notes: Note[] = Array.from({ length: size }, (_, at) => ({
    id: qualityId(100 + at),
    deckId: at % 2 ? qualityId(3) : qualityDeckId,
    noteType: at < vocabulary ? 'vocab' : at < vocabulary + 500 ? 'basic' : 'cloze',
    fields:
      at < vocabulary
        ? {
            term: `Word ${String(at).padStart(4, '0')}`,
            translation: `Значение / meaning ${at}`,
            ...(at % 4 < 2 ? { example: 'A useful example sentence.' } : {}),
            ...(at % 4 === 0 || at % 4 === 2
              ? { exampleTranslation: 'Полезный перевод примера.' }
              : {}),
            ...(at % 4 === 0 ? { definition: 'A saved definition.' } : {}),
          }
        : at < vocabulary + 500
          ? { front: `Question ${at}`, back: 'Answer' }
          : { text: `A {{gap ${at}}}.` },
    tags: ['imported', `topic ${at % 50}`],
    source: 'Source 100%_literal',
    rank: null,
    status: 'active',
    importBatchId: null,
    createdAt: date,
    updatedAt: date,
    rev: 4 + at,
  }));
  const state = {
    notes,
    who: 'quality-reader',
    offline: false,
    complete,
    acceptEdits: true,
    requests: [] as { url: URL; method: string }[],
    writes: 0,
    revision: 4 + size,
  };
  const account = {
    id: state.who,
    name: 'Reader',
    email: 'reader@example.test',
    image: null,
    locale: 'en',
    theme: 'system',
    timezone: 'Europe/Minsk',
    dayCutoffHour: 4,
    plan: 'free',
    settings: {},
    twoFactorEnabled: false,
  };
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      state.requests.push({ url, method });
      if (method !== 'GET') state.writes++;
      if (state.offline) return route.abort('internetdisconnected');
      if (url.pathname === '/api/account')
        return route.fulfill({ json: { ...account, id: state.who, revision: state.revision } });
      const own = state.who === account.id;
      const visible = own ? state.notes : [];
      if (url.pathname === '/api/decks')
        return route.fulfill({
          json: {
            decks: own
              ? [
                  {
                    ...folder,
                    due: 0,
                    fresh: 0,
                    noteCount: Math.ceil(size / 2),
                    children: [
                      {
                        ...decks[1],
                        path: [folder.id],
                        due: 0,
                        fresh: 0,
                        noteCount: Math.ceil(size / 2),
                        children: [],
                      },
                    ],
                  },
                  { ...decks[2], due: 0, fresh: 0, noteCount: Math.floor(size / 2), children: [] },
                ]
              : [],
          },
        });
      if (url.pathname === '/api/sync') {
        if (!state.complete)
          return route.fulfill({ status: 503, json: { error: { code: 'internal_error' } } });
        const since = Number(url.searchParams.get('since') ?? 0);
        const remaining = (
          own
            ? [
                ...decks.map(({ path: _path, ...row }) => ({
                  entity: 'decks',
                  id: row.id,
                  rev: row.rev,
                  deleted: false,
                  purged: false,
                  row,
                })),
                ...visible.map((row) => ({
                  entity: 'notes',
                  id: row.id,
                  rev: row.rev,
                  deleted: false,
                  purged: false,
                  row,
                })),
              ]
            : []
        )
          .filter((row) => row.rev > since)
          .sort((a, b) => a.rev - b.rev);
        const changes = remaining.slice(0, 200);
        return route.fulfill({
          json: {
            since,
            revision: changes.at(-1)?.rev ?? since,
            hasMore: remaining.length > changes.length,
            changes,
          },
        });
      }
      if (url.pathname === '/api/notes/content-quality') {
        const search = url.searchParams.get('search')?.toLowerCase() ?? '';
        const scoped = visible.filter(
          (note) =>
            note.noteType === 'vocab' &&
            (!url.searchParams.has('deckId') || note.deckId === url.searchParams.get('deckId')) &&
            (!search ||
              contentQualitySearchText(
                note.fields,
                note.tags,
                note.source,
                qualityPath(note.deckId),
              ).includes(search)),
        );
        const counts = Object.fromEntries(
          CONTENT_CHECKS.map((check) => [
            check,
            scoped.filter((note) => contentChecks(note.noteType, note.fields).includes(check))
              .length,
          ]),
        );
        const category = url.searchParams.get('category') as ContentCheck | null;
        const cursor = url.searchParams.get('cursor');
        const limit = Number(url.searchParams.get('limit') ?? 100);
        const after = !category
          ? []
          : scoped
              .filter(
                (note) =>
                  contentChecks(note.noteType, note.fields).includes(category) &&
                  (!cursor || note.id > cursor),
              )
              .sort((a, b) => (a.id < b.id ? -1 : 1));
        return route.fulfill({
          json: {
            counts,
            vocabularyCount: scoped.length,
            items: after
              .slice(0, limit)
              .map((note) => ({ ...note, deckPath: qualityPath(note.deckId) })),
            ...(after.length > limit ? { nextCursor: after[limit - 1]!.id } : {}),
          },
        });
      }
      const id = url.pathname.split('/')[3];
      const found = visible.find((note) => note.id === id);
      if (found && (method === 'PATCH' || url.pathname.endsWith('/offline-edit'))) {
        if (!state.acceptEdits)
          return route.fulfill({ status: 409, json: { error: { code: 'conflict' } } });
        const body = route.request().postDataJSON() as {
          fields?: Note['fields'];
          tags?: string[];
          operationId?: string;
        };
        if (body.fields) found.fields = body.fields;
        if (body.tags) found.tags = body.tags;
        found.rev = ++state.revision;
        return route.fulfill({
          json: url.pathname.endsWith('/offline-edit')
            ? { operationId: body.operationId, status: 'applied', revision: found.rev }
            : { note: found, cards: [] },
        });
      }
      if (found) return route.fulfill({ json: { note: found, cards: [] } });
      if (url.pathname === '/api/notes')
        return route.fulfill({
          json: {
            items: visible
              .filter(
                (note) =>
                  !url.searchParams.has('deckId') || note.deckId === url.searchParams.get('deckId'),
              )
              .slice(0, 1000),
          },
        });
      return route.fallback();
    },
  );
  return state;
}

export async function qualityDownloaded(page: Page) {
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'What works offline', exact: true }).click();
  await expect(
    page.getByText('Collection downloaded for offline reading.', { exact: true }),
  ).toBeVisible({ timeout: 180_000 });
  await page.goBack();
}

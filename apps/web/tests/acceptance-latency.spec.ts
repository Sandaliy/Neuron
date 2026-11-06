import { expect, test } from '@playwright/test';

import { manyDecks, manyNotes, useFixtures, usePreferences } from './fixtures';

import type { Locator } from '@playwright/test';

test('matched interaction probe separates transport and repeated readiness', async ({
  page,
}, info) => {
  await usePreferences(page, { locale: 'en', theme: 'dark', glass: 'off' });
  await useFixtures(page);
  const reads: string[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/study/session') || path.endsWith('/practice') || path.endsWith('/notes')) {
      reads.push(path);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (path.endsWith('/practice')) return route.fulfill({ json: { run: null, version: 0 } });
    return route.fallback();
  });
  const started = performance.now();
  await page.goto('/');
  const study = page.getByRole('button', { name: 'Study', exact: true });
  await expect(study).toBeEnabled();
  const firstReadyMs = performance.now() - started;
  const returns: number[] = [];
  for (let n = 0; n < 3; n++) {
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    const at = performance.now();
    await page.getByRole('link', { name: 'Today', exact: true }).click();
    await expect(study).toBeEnabled();
    returns.push(performance.now() - at);
  }
  await page.getByRole('button', { name: 'Study setup', exact: true }).click();
  await page.getByRole('combobox', { name: 'Study mode' }).selectOption('recognition');
  await expect(study).toBeEnabled();
  const modeAt = performance.now();
  await page.getByRole('combobox', { name: 'Study mode' }).selectOption('');
  await expect(study).toBeEnabled();
  const modeReturnMs = performance.now() - modeAt;
  await page.goto('/notes?deckId=d3');
  await expect(page.getByRole('button', { name: 'Start practice', exact: true })).toBeVisible();
  await expect(page.locator('[data-row]').first()).toBeVisible();
  const practiceAt = performance.now();
  await page.getByRole('button', { name: 'Start practice', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Practice', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start practice', exact: true })).toBeVisible();
  const result = {
    transportMs: 250,
    firstReadyMs,
    returns,
    modeReturnMs,
    practiceSetupMs: performance.now() - practiceAt,
    reads,
  };
  console.info('acceptance-latency', JSON.stringify(result));
  await info.attach('interaction-latency', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
});

test('repeated Library, search, Note and primary navigation stays responsive at 4x CPU', async ({
  page,
  browserName,
}, info) => {
  test.skip(
    browserName !== 'chromium' || info.project.name !== 'phone-interaction',
    'Controlled Chromium phone measurement',
  );
  await usePreferences(page, { locale: 'en', theme: 'dark', glass: 'off' });
  const notes = manyNotes(6000).map((note) => ({ ...note, deckId: 'deck_0' }));
  await useFixtures(page, { decks: manyDecks(60), notes, collectionDownload: false });
  const requests: string[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    if (path === '/api/notes/note_0') return route.fulfill({ json: { note: notes[0], cards: [] } });
    if (path.endsWith('/notes') || path.endsWith('/decks'))
      await new Promise((resolve) => setTimeout(resolve, 250));
    return route.fallback();
  });
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Deck 1', exact: true })).toBeVisible();
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const timings: Record<string, number[]> = {};
  async function measure(
    name: string,
    action: Locator,
    ready: { heading?: string; notes?: boolean; editor?: boolean },
  ) {
    const elapsed = await action.evaluate(async (node, ready) => {
      const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const visible = () => {
        if (ready.heading)
          return [...document.querySelectorAll('h1')].some(
            (node) => node.textContent?.trim() === ready.heading,
          );
        if (ready.editor)
          return [...document.querySelectorAll('input')].some((node) => node.value === 'Wort 1');
        return [...document.querySelectorAll('button')].some(
          (node) => node.textContent?.includes('Wort 1') && node.textContent.includes('word 1'),
        );
      };
      const at = performance.now();
      (node as HTMLElement).click();
      while (!visible()) await frame();
      await frame();
      await frame();
      return performance.now() - at;
    }, ready);
    (timings[name] ??= []).push(elapsed);
  }
  for (let round = 0; round < 3; round++) {
    const control = (role: 'button' | 'link', name: string) =>
      page.getByRole(role, { name, exact: true });
    await measure('collection search', control('button', 'Find Folders & Decks'), {
      heading: 'Find Folders & Decks',
    });
    await measure('Library return', control('button', 'Library'), { heading: 'Library' });
    await measure('Find Notes', control('button', 'Find Notes'), { notes: true });
    await measure('Note open', page.getByRole('button', { name: /^Wort 1 word 1/ }), {
      editor: true,
    });
    await measure('Note return', control('button', 'Find Notes'), { notes: true });
    await measure('Settings', control('link', 'Settings'), { heading: 'Settings' });
    await measure('Today', control('link', 'Today'), { heading: 'Today' });
    await measure('Library', control('link', 'Library'), { heading: 'Library' });
  }
  await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await session.detach();
  console.log(
    'Repeated navigation, 6000 Notes, 60 Decks, 4x CPU, 250ms cold transport:',
    JSON.stringify({ timings, requests }),
  );
  await info.attach('repeated-navigation', {
    body: JSON.stringify({ timings, requests }, null, 2),
    contentType: 'application/json',
  });
  // Warm navigation must not request the collection or Note list again.
  expect(requests.filter((path) => path === '/api/decks')).toHaveLength(1);
  expect(requests.filter((path) => path === '/api/notes')).toHaveLength(1);
  for (const values of Object.values(timings))
    for (const warm of values.slice(1)) expect(warm).toBeLessThan(500);
});

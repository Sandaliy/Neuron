import { expect, test } from '@playwright/test';

import { useFixtures, usePreferences } from './fixtures';

const stamp = '2026-01-01T00:00:00.000Z';
const deck = {
  id: '01900000-0000-7000-8000-000000000901',
  name: 'German words',
  kind: 'deck',
  parentId: null,
  path: [],
  children: [],
  due: 0,
  fresh: 1,
  noteCount: 1,
  position: 0,
  rev: 1,
  createdAt: stamp,
  updatedAt: stamp,
  settings: { targetLanguage: 'de', ladder: [{ direction: 'recognition', opensAtStability: 0 }] },
};

test('collection creation separates acknowledgement from refresh latency', async ({
  page,
}, info) => {
  await usePreferences(page, { locale: 'en', theme: 'dark' });
  await useFixtures(page, { decks: [] });
  let created: Record<string, unknown> | undefined;
  let acknowledgedMs = 0;
  let started = 0;
  let refreshed = false;
  await page.route('**/api/decks', async (route) => {
    if (route.request().method() === 'POST') {
      await new Promise((resolve) => setTimeout(resolve, 250));
      created = { ...deck, ...route.request().postDataJSON(), due: 0, fresh: 0, noteCount: 0 };
      acknowledgedMs = performance.now() - started;
      await route.fulfill({ json: { deck: created } });
    } else {
      if (created) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        refreshed = true;
      }
      await route.fulfill({ json: { decks: created ? [created] : [] } });
    }
  });
  await page.goto('/library');
  await page.getByRole('button', { name: 'New deck', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').fill('New collection');
  started = performance.now();
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('button', { name: /^New collection/ }).first()).toBeVisible();
  expect(refreshed).toBe(false);
  const measurement = { transportMs: 250, acknowledgedMs, visibleMs: performance.now() - started };
  console.info('refinement-create', JSON.stringify(measurement));
  await info.attach('creation', {
    body: JSON.stringify(measurement, null, 2),
    contentType: 'application/json',
  });
});

test('Study skill save measures feedback, transport and authoritative readiness', async ({
  page,
}, info) => {
  await usePreferences(page, { locale: 'en', theme: 'light' });
  await useFixtures(page, { decks: [deck] });
  let measuring = false;
  let acknowledged = false;
  const requests: { at: number; beforeAcknowledgement: boolean }[] = [];
  const transportMs = 250;
  let started = 0;
  let writeMs = 0;
  let treeReads = 0;
  await page.route('**/api/decks', async (route) => {
    if (measuring) {
      treeReads++;
      await new Promise((resolve) => setTimeout(resolve, transportMs));
    }
    await route.fulfill({ json: { decks: [deck] } });
  });
  await page.route(`**/api/decks/${deck.id}`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, transportMs));
    deck.settings = route.request().postDataJSON().settings;
    acknowledged = true;
    writeMs = performance.now() - started;
    await route.fulfill({ json: { deck } });
  });
  await page.route('**/api/study/session', async (route) => {
    if (measuring) {
      requests.push({ at: performance.now() - started, beforeAcknowledgement: !acknowledged });
      await new Promise((resolve) => setTimeout(resolve, transportMs));
    }
    await route.fallback();
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Study', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Study setup', exact: true }).click();
  await page.getByRole('combobox', { name: 'Study mode' }).selectOption('production');
  await page.getByRole('button', { name: 'Enable', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await dialog.getByRole('switch', { name: 'Typing', exact: true }).click();
  const save = dialog.getByRole('button', { name: 'Save', exact: true });
  await save.evaluate((element) => {
    element.addEventListener(
      'click',
      () => {
        const start = performance.now();
        const sample = () => {
          if (element.getAttribute('aria-busy') === 'true')
            (window as unknown as { feedbackMs: number }).feedbackMs = performance.now() - start;
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      },
      { once: true },
    );
  });
  measuring = true;
  started = performance.now();
  await save.click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Study', exact: true })).toBeEnabled();
  const readyMs = performance.now() - started;
  const feedbackMs = await page.evaluate(
    () => (window as unknown as { feedbackMs: number }).feedbackMs,
  );
  const measurement = { transportMs, feedbackMs, writeMs, readyMs, requests };
  expect(requests).toHaveLength(1);
  expect(requests[0]?.beforeAcknowledgement).toBe(false);
  expect(treeReads).toBe(0);
  console.info('refinement-readiness', JSON.stringify(measurement));
  await info.attach('readiness', {
    body: JSON.stringify(measurement, null, 2),
    contentType: 'application/json',
  });
});

test('failed collection creation stays editable and never fabricates a row', async ({ page }) => {
  await usePreferences(page, { locale: 'en', theme: 'light' });
  await useFixtures(page, { decks: [] });
  await page.route('**/api/decks', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 500, json: { error: 'internal_error' } })
      : route.fulfill({ json: { decks: [] } }),
  );
  await page.goto('/library');
  await page.getByRole('button', { name: 'New folder', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').fill('Not confirmed');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(dialog.getByRole('textbox')).toHaveValue('Not confirmed');
  await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: /^Not confirmed/ })).toHaveCount(0);
});

for (const theme of ['dark', 'light'] as const)
  test(`refinement journey captures in ${theme}`, async ({ page }, info) => {
    await usePreferences(page, { locale: 'en', theme });
    await useFixtures(page);
    await page.route('**/api/decks/*/practice', (route) =>
      route.fulfill({ json: { run: null, version: 0 } }),
    );
    const capture = async (name: string) => {
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: info.outputPath(`${name}.png`),
        fullPage: true,
        animations: 'disabled',
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    };
    await page.goto('/library');
    await page.getByRole('button', { name: 'Show what is inside', exact: true }).first().click();
    await page.getByRole('button', { name: 'Show what is inside', exact: true }).first().click();
    await capture('hierarchy');
    await page.getByRole('button', { name: /^Verben mit Dativ/ }).click();
    await expect(page.getByRole('heading', { name: 'Verben mit Dativ' })).toBeVisible();
    await capture('deck');
    await page.getByRole('button', { name: 'Select notes', exact: true }).click();
    await page.locator('[data-row]').first().click();
    await capture('selection');
    await page.getByRole('button', { name: 'Exit selection', exact: true }).click();
    await page.getByRole('button', { name: 'Practice setup', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Practice setup' })).toBeVisible();
    await capture('practice-setup');
    await page.getByRole('button', { name: 'Exit Practice', exact: true }).click();
    await page.getByRole('button', { name: 'New note', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Word', exact: true })).toBeVisible();
    await capture('note');
    await page.getByRole('link', { name: 'Library', exact: true }).click();
    await page.goto('/import');
    await expect(page.getByRole('heading', { name: 'Import', exact: true })).toBeVisible();
    await capture('import');
    await page.getByRole('button', { name: 'Example and its cards', exact: true }).click();
    await expect(page.getByRole('table')).toBeVisible();
    await capture('import-example');
    await page.getByRole('button', { name: 'Import into', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await capture('destination');
    await page.keyboard.press('Escape');
    await page.getByRole('link', { name: 'Today', exact: true }).click();
    await page.getByRole('button', { name: 'Study setup', exact: true }).click();
    await capture('today-setup');
    await page.getByRole('button', { name: /^\d+ selected$/ }).click();
    await capture('study-picker');
  });

for (const { glass, reduced } of [
  { glass: 'off', reduced: true },
  { glass: 'subtle', reduced: false },
  { glass: 'full', reduced: false },
])
  test(`narrow disclosures remain accessible with ${glass} glass, reduced=${reduced}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await usePreferences(page, {
      theme: glass === 'subtle' ? 'dark' : 'light',
      locale: 'en',
      glass,
      glassScope: 'all',
    });
    await useFixtures(page);
    await page.goto('/');
    const setup = page.getByRole('button', { name: 'Study setup', exact: true });
    const controls = page.locator(`#${await setup.getAttribute('aria-controls')}`);
    await expect(page.getByRole('button', { name: 'Study', exact: true })).toBeEnabled();
    await expect(controls).toHaveAttribute('inert', '');
    await setup.press('Enter');
    await expect(controls).toBeVisible();
    await expect(controls).not.toHaveAttribute('inert');
    await setup.press('Enter');
    await expect(controls).not.toBeVisible();
    await setup.press('Tab');
    await expect(page.getByRole('button', { name: 'Study', exact: true })).toBeFocused();
    await page.screenshot({ path: info.outputPath('narrow-today.png'), animations: 'disabled' });
    await page.goto('/library');
    await page.getByRole('button', { name: 'Show what is inside', exact: true }).first().click();
    await page.screenshot({ path: info.outputPath('narrow-library.png'), animations: 'disabled' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });

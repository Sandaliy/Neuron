import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import {
  EXPORT_ENTITIES,
  EXPORT_FORMAT,
  emptyExportCounts,
  exportUtf8Length,
} from '@neuron/shared';

import { useFixtures, usePreferences } from './fixtures';

function archive(accountId = 'user_1', count = 1) {
  const exportId = '019a0000-0000-7000-8000-000000000001';
  const header =
    JSON.stringify({
      type: 'manifest',
      format: EXPORT_FORMAT,
      version: 1,
      exportId,
      accountId,
      snapshotAt: '2026-11-01T10:00:00Z',
      revision: 5,
      entities: EXPORT_ENTITIES,
      guide: {},
    }) + '\n';
  let text =
    header +
    JSON.stringify({ type: 'record', entity: 'preferences', data: { id: accountId } }) +
    '\n';
  for (let i = 0; i < count; i++)
    text +=
      JSON.stringify({
        type: 'record',
        entity: 'notes',
        data: { id: `note-${i}`, fields: { front: 'Wort 👋', back: 'Слово' } },
      }) + '\n';
  const counts = { ...emptyExportCounts(), preferences: 1, notes: count };
  return (
    text +
    JSON.stringify({
      type: 'complete',
      exportId,
      records: count + 1,
      counts,
      bytes: exportUtf8Length(text),
    }) +
    '\n'
  );
}

test.beforeEach(async ({ page }) => {
  await usePreferences(page, { theme: 'dark' });
  await useFixtures(page);
});

test('prepares and downloads the exact documented archive, with local-only scope visible', async ({
  page,
}) => {
  const text = archive();
  await page.route('**/api/account/export', (route) =>
    route.fulfill({ contentType: 'application/x-ndjson', body: text }),
  );
  await page.goto('/settings');
  const section = page.getByRole('region', { name: 'Export your data' });
  await expect(section.getByText(/Pending changes, drafts/)).toBeVisible();
  await expect(section.getByText(/Importing or restoring/)).toBeVisible();
  await section.getByRole('button', { name: 'Prepare export', exact: true }).click();
  await expect(section.getByRole('status')).toContainText('Your file is ready');
  const downloadEvent = page.waitForEvent('download');
  await section.getByRole('link', { name: 'Save file', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('neuron-export-2026-11-01.jsonl');
  expect(await download.failure()).toBeNull();
  expect(await readFile((await download.path())!, 'utf8')).toBe(text);
  await expect(section.getByText(/Saving is finished/)).toBeVisible();
});

test('shows busy feedback, allows cancellation, and retries without offering a partial file', async ({
  page,
}) => {
  let release: (() => void) | undefined;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  await page.route('**/api/account/export', async (route) => {
    if (first) {
      first = false;
      await wait;
      await route.abort().catch(() => undefined);
    } else await route.fulfill({ contentType: 'application/x-ndjson', body: archive() });
  });
  await page.goto('/settings');
  const section = page.getByRole('region', { name: 'Export your data' });
  await section.getByRole('button', { name: 'Prepare export', exact: true }).click();
  await expect(section.getByRole('status')).toContainText('Preparing your file');
  await expect(section.getByRole('link', { name: 'Save file', exact: true })).toHaveCount(0);
  await section.getByRole('button', { name: 'Cancel', exact: true }).click();
  release!();
  await expect(section.getByRole('alert')).toContainText('did not finish');
  await section.getByRole('button', { name: 'Try export again' }).click();
  await expect(section.getByRole('link', { name: 'Save file', exact: true })).toBeVisible();
});

for (const scenario of ['expired', 'interrupted', 'wrong-account', 'invalid', 'limit'] as const) {
  test(`refuses ${scenario} delivery and explains retry`, async ({ page }) => {
    await page.route('**/api/account/export', (route) =>
      route.fulfill(
        scenario === 'expired'
          ? {
              status: 401,
              contentType: 'application/json',
              body: JSON.stringify({
                error: { code: 'not_authenticated', status: 401, correlationId: 'export-expired' },
              }),
            }
          : {
              contentType: 'application/x-ndjson',
              body:
                scenario === 'interrupted'
                  ? archive().split('\n').slice(0, -2).join('\n') + '\n'
                  : scenario === 'wrong-account'
                    ? archive('other')
                    : scenario === 'limit'
                      ? archive().split('\n')[0] + '\n{"type":"error","code":"export_limit"}\n'
                      : '<html>proxy failure</html>',
            },
      ),
    );
    await page.goto('/settings');
    const section = page.getByRole('region', { name: 'Export your data' });
    await section.getByRole('button', { name: 'Prepare export', exact: true }).click();
    await expect(section.getByRole('alert')).toBeVisible();
    await expect(section.getByRole('link', { name: 'Save file', exact: true })).toHaveCount(0);
    await expect(section.getByRole('button', { name: 'Try export again' })).toBeEnabled();
  });
}

test('shares a prepared file through the platform menu and retains Save after cancellation', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(navigator, 'share', {
      value: async (data: ShareData) => {
        (window as Window & { sharedName?: string }).sharedName = data.files?.[0]?.name;
        throw new DOMException('Cancelled', 'AbortError');
      },
      configurable: true,
    });
  });
  await page.route('**/api/account/export', (route) =>
    route.fulfill({ contentType: 'application/x-ndjson', body: archive() }),
  );
  await page.goto('/settings');
  const section = page.getByRole('region', { name: 'Export your data' });
  await section.getByRole('button', { name: 'Prepare export', exact: true }).click();
  await section.getByRole('button', { name: 'Share file', exact: true }).click();
  expect(await page.evaluate(() => (window as Window & { sharedName?: string }).sharedName)).toBe(
    'neuron-export-2026-11-01.jsonl',
  );
  await expect(section.getByRole('alert')).toHaveCount(0);
  await expect(section.getByRole('link', { name: 'Save file', exact: true })).toBeVisible();
});

test('downloads a substantial collection without parsing it into an in-memory collection', async ({
  page,
}) => {
  const text = archive('user_1', 15000);
  await page.route('**/api/account/export', (route) =>
    route.fulfill({ contentType: 'application/x-ndjson', body: text }),
  );
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Prepare export', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Save file', exact: true })).toBeVisible();
});

test('discards the completed bytes when the final session check belongs to another account', async ({
  page,
}) => {
  let exported = false;
  await page.route('**/api/account', async (route) => {
    if (!exported) return route.fallback();
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ id: 'other-account' }),
    });
  });
  await page.route('**/api/account/export', async (route) => {
    exported = true;
    await route.fulfill({ contentType: 'application/x-ndjson', body: archive() });
  });
  await page.goto('/settings');
  const section = page.getByRole('region', { name: 'Export your data' });
  await section.getByRole('button', { name: 'Prepare export', exact: true }).click();
  await expect(section.getByRole('alert')).toBeVisible();
  await expect(section.getByRole('link', { name: 'Save file', exact: true })).toHaveCount(0);
});

test('saves an already prepared file after losing the network without changing account visits', async ({
  page,
  context,
}) => {
  await page.route('**/api/account/export', (route) =>
    route.fulfill({ contentType: 'application/x-ndjson', body: archive() }),
  );
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Prepare export', exact: true }).click();
  const save = page.getByRole('link', { name: 'Save file', exact: true });
  await expect(save).toBeVisible();
  await context.setOffline(true);
  const receiving = page.waitForEvent('download');
  await save.click();
  const download = await receiving;
  expect(await download.failure()).toBeNull();
  expect(await readFile((await download.path())!, 'utf8')).toBe(archive());
});

test('checks session expiry after delivery before offering Save', async ({ page }) => {
  let exported = false;
  await page.route('**/api/account', async (route) => {
    if (!exported) return route.fallback();
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'not_authenticated', status: 401, correlationId: 'expired-after-export' },
      }),
    });
  });
  await page.route('**/api/account/export', async (route) => {
    exported = true;
    await route.fulfill({ contentType: 'application/x-ndjson', body: archive() });
  });
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Prepare export', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Save file', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
});

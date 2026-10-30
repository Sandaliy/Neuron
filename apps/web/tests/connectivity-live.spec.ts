import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { usePreferences } from './fixtures';

// Real built shell, service worker, HTTP, account validation and PostgreSQL/RLS.
// The established test server substitutes only authentication session lookup.
test('the built PWA separates latency, endpoint errors, silence and confirmed loss, then recovers with one joined check', async ({
  browser,
}, info) => {
  test.skip(
    process.env['OFFLINE_DATABASE_E2E'] !== 'true' || !process.env['CI'],
    'Requires the guarded throwaway database and built PWA.',
  );
  test.setTimeout(180_000);
  const { serve } = await import('../../api/node_modules/@hono/node-server/dist/index.mjs');
  const { testDatabase, createUser, appClient } =
    await import('../../api/src/db/testing/database.js');
  const { createRepositories } = await import('../../api/src/db/repositories/index.js');
  const { testServer } = await import('../../api/src/testing/server.js');
  const database = testDatabase();
  if (!database) throw new Error('Throwaway database required');
  const accountId = `connection-pwa-${info.project.name}-${Date.now()}`;
  await createUser(database, accountId);
  const connection = appClient(database);
  const repo = createRepositories(connection, accountId);
  const app = testServer(database, accountId, connection);
  const deck = await repo.decks.create({ name: 'Connection continuity' });
  const seeded = await app.request('/api/notes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      deckId: deck.id,
      noteType: 'basic',
      fields: { front: 'Connection question', back: 'Connection answer' },
    }),
  });
  expect(seeded.status).toBe(201);
  let heldAccount: Promise<void> | undefined;
  let heldAPI: Promise<void> | undefined;
  let releaseAccount = () => {};
  let releaseAPI = () => {};
  let failNotes = false;
  let failAPI = false;
  let accountReads = 0;
  const fetch = async (request: Request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/account') {
        accountReads++;
        await heldAccount;
      }
      await heldAPI;
      if (failAPI || (failNotes && url.pathname === '/api/notes'))
        return Response.json(
          { error: { code: 'internal_error', status: 503, correlationId: 'isolated-endpoint' } },
          { status: 503 },
        );
      return app.fetch(request);
    }
    const asset =
      url.pathname.startsWith('/assets/') ||
      ['/sw.js', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'].includes(
        url.pathname,
      )
        ? url.pathname.slice(1)
        : 'index.html';
    const type = asset.endsWith('.js')
      ? 'application/javascript'
      : asset.endsWith('.css')
        ? 'text/css'
        : asset.endsWith('.png')
          ? 'image/png'
          : asset.endsWith('.svg')
            ? 'image/svg+xml'
            : asset.endsWith('.webmanifest')
              ? 'application/manifest+json'
              : 'text/html';
    try {
      return new Response(await readFile(path.join(process.cwd(), 'dist', asset)), {
        headers: { 'content-type': type },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  };
  let server = serve({ fetch, hostname: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve) =>
    server.listening ? resolve() : server.once('listening', resolve),
  );
  const port = (server.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${port}`;
  const context = await browser.newContext({
    serviceWorkers: 'allow',
    baseURL: origin,
    viewport: info.project.use.viewport ?? { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await usePreferences(page, { locale: 'en', theme: 'dark', motion: 'reduce' });
    await page.goto('/settings');
    await expect(
      page.getByText('Collection downloaded for offline reading.', { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText('Study works offline on this device.', { exact: true }),
    ).toBeVisible();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await page.goto(`/notes?deckId=${deck.id}`);
    const practice = page.getByRole('button', { name: 'Start practice', exact: true });
    await expect(practice).toBeEnabled();
    await page
      .locator('main section[data-screen]')
      .evaluate((el) => el.setAttribute('data-connection-visit', 'retained'));
    const geometry = () => page.locator('main header').boundingBox();
    const before = await geometry();
    await page.clock.install();

    // A six-second account response stays eligible. Other successful API work
    // supplies observable progress, without authenticating this validation.
    heldAccount = new Promise<void>((resolve) => {
      releaseAccount = resolve;
    });
    let reads = accountReads;
    await page.clock.fastForward(31_000);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('pageshow'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => accountReads).toBe(reads + 1);
    await page.clock.runFor(2600);
    await expect(practice).toBeEnabled();
    const searched = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/notes');
    await page.getByRole('searchbox').fill('Connection');
    await page.clock.runFor(500);
    await (await searched).finished();
    await page.clock.runFor(3000);
    await expect(practice).toBeEnabled();
    await expect(page.getByText('Offline', { exact: true })).toHaveCount(0);
    expect(await geometry()).toEqual(before);
    const slowAccepted = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/account' && response.ok(),
    );
    releaseAccount();
    heldAccount = undefined;
    await (await slowAccepted).finished();
    await page.clock.runFor(10);
    await expect.poll(() => accountReads).toBe(reads + 1);

    // An HTTP failure at one endpoint never declares the API disconnected.
    failNotes = true;
    const rejected = page.waitForResponse((r) => r.status() === 503);
    await page.getByRole('searchbox').fill('isolated');
    await page.clock.runFor(500);
    await (await rejected).finished();
    // This failed search has no authoritative result pool. Keep the ordinary
    // label and screen, while refusing Practice until its required data is confirmed.
    await expect(practice).toHaveText('Start practice');
    await expect(practice).toBeDisabled();
    await expect(page.getByText('Offline', { exact: true })).toHaveCount(0);
    // One bounded verification can confirm that this endpoint failure is
    // isolated. It must not replace the screen or declare offline.
    await expect.poll(() => accountReads).toBe(reads + 2);
    // Finish the failed read's React commit before the next simulated input.
    // A paused WebKit clock can otherwise let that commit overwrite the driver's fill.
    await expect(page.getByRole('searchbox')).not.toHaveAttribute('aria-busy', 'true');
    failNotes = false;
    await page.getByRole('searchbox').fill('Connection');
    await expect(page.getByRole('searchbox')).toHaveValue('Connection');
    await page.clock.runFor(500);
    await expect(practice).toBeEnabled();

    // Indefinite API silence permits local access before the bounded check
    // completes, without presenting a latency observation as confirmed offline.
    heldAPI = new Promise<void>((resolve) => {
      releaseAPI = resolve;
    });
    reads = accountReads;
    await page.clock.fastForward(31_000);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => accountReads).toBe(reads + 1);
    await page.clock.runFor(4100);
    await expect(page.getByRole('button', { name: 'Start practice', exact: true })).toBeDisabled();
    await expect(page.getByText('Offline', { exact: true })).toHaveCount(0);
    await expect(page.locator('[data-connection-visit="retained"]')).toHaveCount(1);
    expect(await geometry()).toEqual(before);
    releaseAPI();
    heldAPI = undefined;
    await expect(practice).toBeEnabled();
    expect(accountReads).toBe(reads + 1);

    // The hard request bound ends a permanently suspended validation. Recovery
    // retries automatically without requiring another tap or foreground event.
    heldAPI = new Promise<void>((resolve) => {
      releaseAPI = resolve;
    });
    reads = accountReads;
    await page.clock.fastForward(31_000);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => accountReads).toBe(reads + 1);
    await page.clock.runFor(8100);
    await expect(page.getByRole('button', { name: 'Start practice', exact: true })).toBeDisabled();
    releaseAPI();
    heldAPI = undefined;
    await page.clock.runFor(1600);
    await expect(practice).toBeEnabled();
    expect(accountReads).toBe(reads + 2);

    // A responsive proxy can return errors for every API endpoint. This is
    // server uncertainty, not proof that the network is disconnected, and
    // must still allow the complete downloaded Study plan.
    failAPI = true;
    reads = accountReads;
    await page.clock.fastForward(31_000);
    await page.getByRole('searchbox').fill('server unavailable');
    await page.clock.runFor(500);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => accountReads).toBeGreaterThan(reads);
    await expect(page.getByRole('button', { name: 'Start practice', exact: true })).toBeDisabled();
    await expect(page.getByText('Offline', { exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: 'Today', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Study', exact: true })).toBeEnabled();
    failAPI = false;
    await page.clock.runFor(3100);
    await page.getByRole('link', { name: 'Library', exact: true }).click();
    await expect(page.getByRole('button', { name: 'New deck', exact: true })).toBeEnabled();

    // Actual server loss retains the worker-controlled download. One explicit
    // check and foreground bursts all join the same useful recovery request.
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(page.getByText('Offline', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Today', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Study', exact: true })).toBeEnabled();
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(
      page.getByText('Study works offline on this device.', { exact: true }),
    ).toBeVisible();
    heldAccount = new Promise<void>((resolve) => {
      releaseAccount = resolve;
    });
    server = serve({ fetch, hostname: '127.0.0.1', port });
    await new Promise<void>((resolve) =>
      server.listening ? resolve() : server.once('listening', resolve),
    );
    reads = accountReads;
    await page.getByRole('button', { name: 'Offline details', exact: true }).click();
    const check = page.getByRole('button', { name: 'Check connection', exact: true });
    await check.evaluate((el) => (el as HTMLButtonElement).click());
    await expect.poll(() => accountReads).toBe(reads + 1);
    await expect(check).toHaveAttribute('aria-busy', 'true');
    for (let i = 0; i < 5; i++) await check.evaluate((el) => (el as HTMLButtonElement).click());
    await page.evaluate(() => {
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('pageshow'));
    });
    releaseAccount();
    heldAccount = undefined;
    await expect(page.getByText('Offline', { exact: true })).toHaveCount(0);
    await expect(check).toBeEnabled();
    await expect(check).toHaveAttribute('aria-busy', 'false');
    await page.getByRole('link', { name: 'Library', exact: true }).click();
    await expect(page.getByRole('button', { name: 'New deck', exact: true })).toBeEnabled();
    expect(accountReads).toBe(reads + 1);
    await page.screenshot({ path: info.outputPath('connection-recovered.png') });
  } finally {
    releaseAccount();
    releaseAPI();
    await context.close();
    server.close();
    server.closeAllConnections();
    await connection.$client.end();
  }
});

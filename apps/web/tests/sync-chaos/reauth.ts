import { expect, test } from '@playwright/test';

import '../../../api/src/db/testing/ws-proxy.js';
import { GOOD_PASSWORD, harnessFor, registerFresh } from '../../../api/src/auth/testing/harness.js';
import { rawOwnerPool, testDatabase } from '../../../api/src/db/testing/database.js';
import { usePreferences as setDevicePreferences } from '../fixtures';
import { builtShell } from '../live-shell';

import { snapshot } from './fixture';

import type { Server } from 'node:http';

// Real authentication cookies and credentials stay out of trace archives.
test.use({ trace: 'off' });

test('fresh credentials reach the app after session expiry', async ({ page, context }, info) => {
  const database = testDatabase();
  if (!database?.authUrl)
    throw new Error('The reauthentication regression needs DATABASE_URL_AUTH.');
  const harness = harnessFor(database);
  const first = await registerFresh(harness, 'chaos-expired');
  const second = await registerFresh(harness, 'chaos-replacement');
  const { serve } = await import('../../../api/node_modules/@hono/node-server/dist/index.mjs');
  const canonical = harness.env.APP_ORIGIN.canonical;
  const statuses: Array<{ path: string; status: number }> = [];
  const validationReached = Promise.withResolvers<number>();
  const releaseValidation = Promise.withResolvers<void>();
  let holdValidation = false;
  const server = serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request) => {
      const { pathname, search } = new URL(request.url);
      if (!pathname.startsWith('/api/')) return builtShell(pathname);

      // Keep the existing auth harness's trusted origin while serving the
      // browser on an ephemeral port.
      const headers = new Headers(request.headers);
      if (headers.has('origin')) headers.set('origin', canonical);
      const response = await harness.app.fetch(
        new Request(new URL(pathname + search, canonical), {
          method: request.method,
          headers,
          ...(request.method === 'GET' ? {} : { body: await request.text() }),
        }),
      );
      if (pathname === '/api/account' || pathname === '/api/auth/sign-in/email')
        statuses.push({ path: pathname, status: response.status });
      if (holdValidation && pathname === '/api/account' && !headers.has('x-test-cookie-check')) {
        validationReached.resolve(response.status);
        await releaseValidation.promise;
      }
      return response;
    },
  }) as Server;
  const pool = rawOwnerPool(database);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      if (server.listening) resolve();
      else server.once('listening', resolve);
    });
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    await context.addCookies(
      first.jar
        .header()
        .split('; ')
        .map((pair) => {
          const equal = pair.indexOf('=');
          return { url, name: pair.slice(0, equal), value: pair.slice(equal + 1) };
        }),
    );
    await setDevicePreferences(page, { locale: 'en', motion: 'reduce' });
    await page.goto(`${url}/settings`);
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    await expect(page.getByText(first.email, { exact: true })).toBeVisible();
    await expect.poll(async () => (await snapshot(page, first.userId))?.sync?.complete).toBe(true);
    // Simulate a reload before the learner confirmed the displayed codes.
    await page.evaluate(() => {
      sessionStorage.setItem('neuron.account-codes.pending', '["SYNTHETIC"]');
      sessionStorage.setItem('neuron.two-factor-codes.pending', '["SYNTHETIC"]');
    });
    const documentRequests: string[] = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'document')
        documentRequests.push(new URL(request.url()).pathname);
    });
    await page.getByRole('button', { name: 'What works offline', exact: true }).click();
    await pool.query(
      `update "session" set expires_at = now() - interval '1 minute' where user_id = $1`,
      [first.userId],
    );
    await page.getByRole('button', { name: 'Check connection', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    expect(statuses).toContainEqual({ path: '/api/account', status: 401 });
    await expect(page.getByRole('link', { name: 'Library', exact: true })).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        ['neuron.account-codes.pending', 'neuron.two-factor-codes.pending'].every(
          (key) => sessionStorage.getItem(key) === null,
        ),
      ),
      'revocation discards unconfirmed credentials from the old visit',
    ).toBe(true);

    holdValidation = true;
    await page.getByLabel('Email', { exact: true }).fill(second.email);
    await page.getByLabel('Password', { exact: true }).fill(GOOD_PASSWORD);
    const response = page.waitForResponse(
      (reply) => new URL(reply.url()).pathname === '/api/auth/sign-in/email',
    );
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    expect((await response).status(), 'fresh credentials were accepted').toBe(200);
    const account = await context.request.get(`${url}/api/account`, {
      headers: { 'x-test-cookie-check': 'true' },
    });
    expect(
      account.ok() && (await account.json()).id === second.userId,
      'new cookie has account authority',
    ).toBe(true);
    expect(await validationReached.promise).toBe(200);
    await expect(page).toHaveURL(`${url}/`);
    await expect(page.getByRole('link', { name: 'Library', exact: true })).toHaveCount(0);
    releaseValidation.resolve();
    await expect(
      page.getByRole('link', { name: 'Library', exact: true }),
      'the validated session opens the app',
    ).toBeVisible({ timeout: 5_000 });
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page.getByText(second.email, { exact: true })).toBeVisible();
    await expect(page.getByText(first.email, { exact: true })).toHaveCount(0);
    expect(documentRequests, 'reauthentication stays in the same document').toEqual([]);
  } finally {
    releaseValidation.resolve();
    await info.attach('reauth-http-statuses', {
      contentType: 'application/json',
      body: JSON.stringify({ statuses, page: new URL(page.url()).pathname }, null, 2),
    });
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeAllConnections();
    await closed;
    await pool.end();
  }
});

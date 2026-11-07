import { expect, test } from '@playwright/test';

import { EXPECTED_ACCOUNT_HEADER } from '@neuron/shared';

import '../../../api/src/db/testing/ws-proxy.js';
import { GOOD_PASSWORD, harnessFor, registerFresh } from '../../../api/src/auth/testing/harness.js';
import { testDatabase } from '../../../api/src/db/testing/database.js';
import { usePreferences as setDevicePreferences } from '../fixtures';
import { builtShell } from '../live-shell';

import { snapshot } from './fixture';

import type { Server } from 'node:http';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test('another tab cannot put replacement-account rows in the original offline collection', async ({
  page,
  context,
}) => {
  const database = testDatabase();
  if (!database?.authUrl) throw new Error('A disposable authentication database is required.');
  const harness = harnessFor(database);
  const first = await registerFresh(harness, 'review-first-tab');
  const second = await registerFresh(harness, 'review-second-tab');
  const name = 'Replacement account test deck';
  const created = await harness.post<{ deck: { id: string } }>(
    '/api/decks',
    { name, kind: 'deck', parentId: null },
    { jar: second.jar },
  );
  expect(created.status).toBe(201);
  const foreignDeck = created.body.deck.id;
  const baseline = await harness.get<{ changes: { id: string }[] }>('/api/sync?since=0&limit=200', {
    jar: first.jar,
  });
  expect(baseline.status).toBe(200);
  expect(baseline.body.changes.some((row) => row.id === foreignDeck)).toBe(false);

  const { serve } = await import('../../../api/node_modules/@hono/node-server/dist/index.mjs');
  const canonical = harness.env.APP_ORIGIN.canonical;
  const releaseAccount = Promise.withResolvers<void>();
  let holdAccount = false;
  const server = serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request) => {
      const { pathname, search } = new URL(request.url);
      if (!pathname.startsWith('/api/')) return builtShell(pathname);
      const headers = new Headers(request.headers);
      if (headers.has('origin')) headers.set('origin', canonical);
      const response = await harness.app.fetch(
        new Request(new URL(pathname + search, canonical), {
          method: request.method,
          headers,
          ...(request.method === 'GET' ? {} : { body: await request.text() }),
        }),
      );
      if (holdAccount && pathname === '/api/account' && !headers.has('x-test-cookie-check'))
        await releaseAccount.promise;
      return response;
    },
  }) as Server;

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
    await expect(page.getByText(first.email, { exact: true })).toBeVisible();
    await expect
      .poll(async () => (await snapshot(page, first.userId))?.sync)
      .toEqual({
        cursor: 0,
        complete: true,
        format: expect.any(Number),
      });

    const replacement = await context.newPage();
    await setDevicePreferences(replacement, { locale: 'en', motion: 'reduce' });
    // Pause the caller after the browser has applied the real Set-Cookie header.
    // The two tabs can now proceed in a deterministic order.
    await replacement.addInitScript(() => {
      const nativeFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const reply = await nativeFetch(input, init);
        if (new URL(reply.url).pathname === '/api/auth/sign-in/email') {
          await new Promise<void>((resolve) => {
            window.addEventListener('release-review-sign-in', () => resolve(), { once: true });
          });
        }
        return reply;
      };
    });
    await replacement.goto(`${url}/sign-in`);
    await replacement.getByLabel('Email', { exact: true }).fill(second.email);
    await replacement.getByLabel('Password', { exact: true }).fill(GOOD_PASSWORD);
    const signedIn = replacement.waitForResponse(
      (reply) => new URL(reply.url()).pathname === '/api/auth/sign-in/email',
    );
    holdAccount = true;
    await replacement.getByRole('button', { name: 'Sign in', exact: true }).click();
    expect((await signedIn).status()).toBe(200);
    const authority = await context.request.get(`${url}/api/account`, {
      headers: { 'x-test-cookie-check': 'true' },
    });
    expect(authority.ok() && (await authority.json()).id === second.userId).toBe(true);
    expect(
      (await page.evaluate(() => localStorage.getItem('neuron.offline.account'))) === first.userId,
    ).toBe(true);
    await expect(page.getByText(first.email, { exact: true })).toBeVisible();

    const deckRead = page.waitForResponse(
      (reply) => new URL(reply.url()).pathname === '/api/decks',
    );
    await page.getByRole('link', { name: 'Library', exact: true }).click();
    const refused = await deckRead;
    expect(refused.status()).toBe(409);
    expect((await refused.json()).error.code).toBe('account_changed');
    await expect(page.getByText(name, { exact: true })).toBeHidden();

    const headers = { [EXPECTED_ACCOUNT_HEADER]: first.userId };
    const pull = await context.request.get(`${url}/api/sync?since=0&limit=200`, { headers });
    expect(pull.status()).toBe(409);
    const attemptedName = 'Stale tab write';
    const write = await context.request.post(`${url}/api/decks`, {
      headers,
      data: { name: attemptedName, kind: 'deck', parentId: null },
    });
    expect(write.status()).toBe(409);
    const credentialWrite = await context.request.post(`${url}/api/auth/change-password`, {
      headers,
      data: { currentPassword: GOOD_PASSWORD, newPassword: 'another test password' },
    });
    expect(credentialWrite.status()).toBe(409);
    const secondDecks = await context.request.get(`${url}/api/decks`);
    expect(secondDecks.ok()).toBe(true);
    expect(await secondDecks.text()).not.toContain(attemptedName);
    const original = await snapshot(page, first.userId);
    expect(original?.sync?.cursor).toBe(0);
    expect(original?.rows.some((row) => row.id === foreignDeck)).toBe(false);

    releaseAccount.resolve();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  } finally {
    releaseAccount.resolve();
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeAllConnections();
    await closed;
  }
});

test('cross-tab sign-out removes displayed registration recovery codes', async ({
  page,
  context,
}) => {
  const database = testDatabase();
  if (!database?.authUrl) throw new Error('A disposable authentication database is required.');
  const harness = harnessFor(database);
  const { serve } = await import('../../../api/node_modules/@hono/node-server/dist/index.mjs');
  const canonical = harness.env.APP_ORIGIN.canonical;
  const server = serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request) => {
      const { pathname, search } = new URL(request.url);
      if (!pathname.startsWith('/api/')) return builtShell(pathname);
      const headers = new Headers(request.headers);
      if (headers.has('origin')) headers.set('origin', canonical);
      return harness.app.fetch(
        new Request(new URL(pathname + search, canonical), {
          method: request.method,
          headers,
          ...(request.method === 'GET' ? {} : { body: await request.text() }),
        }),
      );
    },
  }) as Server;

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      if (server.listening) resolve();
      else server.once('listening', resolve);
    });
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const email = `recovery-review-${crypto.randomUUID()}@neuron.test`;
    await setDevicePreferences(page, { locale: 'en', motion: 'reduce' });
    await page.goto(`${url}/sign-up`);
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(GOOD_PASSWORD);
    await page.getByLabel('Type the password again', { exact: true }).fill(GOOD_PASSWORD);
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    const codes = page.getByRole('heading', { name: 'Your recovery codes', exact: true });
    await expect(codes).toBeVisible();
    const hasStoredCodes = () =>
      page.evaluate(() => sessionStorage.getItem('neuron.account-codes.pending') !== null);
    expect(await hasStoredCodes()).toBe(true);

    const settings = await context.newPage();
    await setDevicePreferences(settings, { locale: 'en', motion: 'reduce' });
    await settings.goto(`${url}/settings`);
    await expect(settings.getByText(email, { exact: true })).toBeVisible();
    await page.reload();
    await expect(codes).toBeVisible();
    await settings.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(settings.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    expect((await context.request.get(`${url}/api/account`)).status()).toBe(401);
    await expect.poll(hasStoredCodes).toBe(false);
    await expect(codes, 'revocation must also clear the mounted credential view').toBeHidden();
  } finally {
    await page.close();
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeAllConnections();
    await closed;
  }
});

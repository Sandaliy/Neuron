import { afterEach, describe, expect, it, vi } from 'vitest';

import { preferencesSynced, syncPreferences } from './sync';

/**
 * The defect these cover: two switches inside one round trip used to finish out
 * of order, and the older answer won. Sending one request at a time is what
 * makes the order the person chose the order the server sees.
 */
function deferred() {
  let release: (value: unknown) => void = () => undefined;
  const promise = new Promise((resolve) => {
    release = resolve;
  });

  return { promise, release: () => release(undefined) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetch(handler: (body: unknown) => Promise<unknown>) {
  const sent: unknown[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const body: unknown = JSON.parse(String(init.body));

      sent.push(body);
      await handler(body);

      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );

  return sent;
}

describe('syncing preferences to the account', () => {
  it('sends one request at a time', async () => {
    const first = deferred();
    let call = 0;
    const sent = stubFetch(async () => {
      call += 1;

      if (call === 1) {
        await first.promise;
      }
    });

    syncPreferences({ theme: 'dark' });
    syncPreferences({ theme: 'light' });

    // The second is still held: only the first has gone out.
    expect(sent).toEqual([{ theme: 'dark' }]);

    first.release();
    await preferencesSynced();

    expect(sent).toEqual([{ theme: 'dark' }, { theme: 'light' }]);
  });

  it('sends only the newest values when several pile up behind one request', async () => {
    const first = deferred();
    let call = 0;
    const sent = stubFetch(async () => {
      call += 1;

      if (call === 1) {
        await first.promise;
      }
    });

    syncPreferences({ theme: 'dark' });
    syncPreferences({ theme: 'light' });
    syncPreferences({ theme: 'system' });
    syncPreferences({ locale: 'ru' });

    first.release();
    await preferencesSynced();

    // Three changes behind the first became one request carrying the last of
    // each, rather than three requests racing each other.
    expect(sent).toEqual([{ theme: 'dark' }, { theme: 'system', locale: 'ru' }]);
  });

  it('swallows a failure, because the device already has the value', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    syncPreferences({ theme: 'dark' });

    await expect(preferencesSynced()).resolves.toBeUndefined();
  });

  it('carries on after a failure', async () => {
    let call = 0;
    const sent: unknown[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        call += 1;
        sent.push(JSON.parse(String(init.body)));

        if (call === 1) {
          throw new TypeError('Failed to fetch');
        }

        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      }),
    );

    syncPreferences({ theme: 'dark' });
    await preferencesSynced();

    syncPreferences({ theme: 'light' });
    await preferencesSynced();

    expect(sent).toEqual([{ theme: 'dark' }, { theme: 'light' }]);
  });
});

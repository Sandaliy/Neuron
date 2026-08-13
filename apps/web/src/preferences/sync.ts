import type { UpdatePreferencesBody } from '@neuron/shared';

import { request } from '../lib/api';

/**
 * Telling the server what this device chose, without anything waiting on it.
 *
 * Nothing here feeds back into the interface. The answer is discarded, not
 * written into any cache, because a response that arrives after the person has
 * changed their mind again would otherwise put the older value back on screen.
 * That is what used to happen: two switches inside one round trip finished out
 * of order and the device ended up on the value nobody picked.
 *
 * Requests are also sent one at a time. While one is in flight the next change
 * is held, and when the first finishes only the newest values are sent. The
 * server therefore receives them in the order they were chosen, whatever the
 * network does with them.
 *
 * A failure is swallowed. The device already has the value and already shows
 * it; the account row catching up is not something to interrupt anybody over.
 * Because each send carries the full set rather than a delta, the next
 * successful send repairs whatever the failed one did not deliver.
 */
let pending: UpdatePreferencesBody | undefined;
let inFlight = false;

/** Test seam: resolves when nothing is queued or in flight. */
let idle: (() => void)[] = [];

function settle(): void {
  if (!inFlight && pending === undefined) {
    for (const resolve of idle) {
      resolve();
    }

    idle = [];
  }
}

async function drain(): Promise<void> {
  if (inFlight || pending === undefined) {
    settle();

    return;
  }

  const body = pending;

  pending = undefined;
  inFlight = true;

  try {
    await request('/account', { method: 'PATCH', body });
  } catch {
    // Silent on purpose. See the note above.
  } finally {
    inFlight = false;
  }

  await drain();
}

/**
 * Queues the device's preferences for the account row.
 *
 * @param body the full set of values this device is on, not a delta
 */
export function syncPreferences(body: UpdatePreferencesBody): void {
  pending = { ...pending, ...body };

  void drain();
}

/** Resolves once every queued sync has finished. For tests only. */
export function preferencesSynced(): Promise<void> {
  if (!inFlight && pending === undefined) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    idle.push(resolve);
  });
}

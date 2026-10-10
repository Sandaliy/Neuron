import { beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
  offline: false,
  visit: 1,
  confirm: vi.fn<() => Promise<void>>(),
}));
vi.mock('./offline', () => ({
  accountEpoch: () => boundary.visit,
  connectionEpoch: () => 0,
  offlineState: () => ({ offline: boundary.offline }),
  confirmConnection: boundary.confirm,
  networkLost: vi.fn(),
  revokeOffline: vi.fn(),
}));

import { ApiFailure } from './api';
import { collectionRead } from './collection-transport';

describe('collection transport authority', () => {
  beforeEach(() => {
    boundary.offline = false;
    boundary.visit = 1;
    boundary.confirm.mockReset().mockResolvedValue(undefined);
    vi.unstubAllGlobals();
  });
  it('confirms an unreachable browse read before returning completed local data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    boundary.confirm.mockImplementation(async () => {
      boundary.offline = true;
    });
    const local = vi.fn().mockResolvedValue({ items: ['persisted'] });
    expect(await collectionRead('/notes', new AbortController().signal, local)).toEqual({
      items: ['persisted'],
    });
    expect(boundary.confirm).toHaveBeenCalledOnce();
    expect(local).toHaveBeenCalledOnce();
  });
  it('does not call an available account endpoint proof of an outage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const local = vi.fn();
    await expect(
      collectionRead('/notes', new AbortController().signal, local),
    ).rejects.toMatchObject({ code: 'network_unreachable' });
    expect(boundary.confirm).toHaveBeenCalledOnce();
    expect(local).not.toHaveBeenCalled();
  });
  it('keeps HTTP errors separate from transport loss', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'service_unavailable', status: 503, correlationId: 'test' },
          }),
          { status: 503 },
        ),
      ),
    );
    await expect(
      collectionRead('/notes', new AbortController().signal, vi.fn()),
    ).rejects.toBeInstanceOf(ApiFailure);
    expect(boundary.confirm).not.toHaveBeenCalled();
  });
  it('ignores an aborted fetch even when WebKit reports TypeError', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        controller.abort();
        throw new TypeError('cancelled');
      }),
    );
    await expect(collectionRead('/notes', controller.signal, vi.fn())).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(boundary.confirm).not.toHaveBeenCalled();
  });
  it('classifies interrupted response bodies as transport loss', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        text: async () => {
          throw new TypeError('stream interrupted');
        },
      }),
    );
    await expect(
      collectionRead('/notes', new AbortController().signal, vi.fn()),
    ).rejects.toMatchObject({ code: 'network_unreachable' });
    expect(boundary.confirm).toHaveBeenCalledOnce();
  });
  it('cannot deliver a failed read or local fallback to an ended account visit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    boundary.confirm.mockImplementation(async () => {
      boundary.visit++;
      boundary.offline = true;
    });
    const local = vi.fn();
    await expect(
      collectionRead('/notes', new AbortController().signal, local),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(local).not.toHaveBeenCalled();
  });
});

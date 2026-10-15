import { ApiFailure, request } from './api';
import { lifecycle } from './lifecycle';
import { accountEpoch, confirmConnection, offlineState, onOfflineChange } from './offline';

/** Browse reads can use local content after session validation confirms an outage. */
export async function collectionRead<T>(
  path: string,
  signal: AbortSignal,
  local: () => Promise<T>,
  publish?: (value: T) => void,
  needsSeed: () => boolean = () => true,
): Promise<T> {
  const visit = accountEpoch();
  const abort = () => {
    if (signal.aborted || visit !== accountEpoch())
      throw new DOMException('Collection read ended', 'AbortError');
  };
  abort();
  const localRead = async () => {
    lifecycle('read-start');
    const value = await local();
    abort();
    lifecycle('read-ready');
    return value;
  };
  if (offlineState().offline) return localRead();
  // Local content is a provisional browse answer, never account validation.
  // The original request remains authoritative and is never cancelled by a timer.
  let seeded = false;
  let settled = false;
  const seed = () => {
    if (
      seeded ||
      settled ||
      !needsSeed() ||
      !offlineState().available ||
      !publish ||
      signal.aborted ||
      visit !== accountEpoch()
    )
      return;
    seeded = true;
    void localRead()
      .then((value) => {
        abort();
        if (!settled && needsSeed()) publish(value);
      })
      .catch(() => undefined);
  };
  seed();
  const unsubscribe = onOfflineChange(seed);
  try {
    const value = await request<T>(path, { signal });
    abort();
    return offlineState().offline ? localRead() : value;
  } catch (error) {
    abort();
    if (error instanceof ApiFailure && error.code === 'network_unreachable') {
      await confirmConnection();
      abort();
      if (offlineState().offline) return localRead();
    }
    throw error;
  } finally {
    settled = true;
    unsubscribe();
  }
}

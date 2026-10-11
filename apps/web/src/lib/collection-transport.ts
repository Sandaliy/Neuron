import { ApiFailure, request } from './api';
import { accountEpoch, confirmConnection, offlineState, onOfflineChange } from './offline';

/** Only browse reads may confirm a transport outage. Mutations and sync keep their own failures. */
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
  if (offlineState().offline) return local();
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
    void local()
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
    return offlineState().offline ? local() : value;
  } catch (error) {
    abort();
    if (error instanceof ApiFailure && error.code === 'network_unreachable') {
      await confirmConnection();
      abort();
      if (offlineState().offline) return local();
    }
    throw error;
  } finally {
    settled = true;
    unsubscribe();
  }
}

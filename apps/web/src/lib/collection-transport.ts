import { ApiFailure, request } from './api';
import { accountEpoch, confirmConnection, offlineState } from './offline';

/** Only browse reads may confirm a transport outage. Mutations and sync keep their own failures. */
export async function collectionRead<T>(
  path: string,
  signal: AbortSignal,
  local: () => Promise<T>,
): Promise<T> {
  const visit = accountEpoch();
  const abort = () => {
    if (signal.aborted || visit !== accountEpoch())
      throw new DOMException('Collection read ended', 'AbortError');
  };
  abort();
  if (offlineState().offline) return local();
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
  }
}

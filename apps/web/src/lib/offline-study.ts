import type { DailyStudySessionRequest, Me } from '@neuron/shared';

import { accountEpoch, offlineState, onOfflineChange } from './offline';

import type { OfflineStudyPlan } from './offline-study-snapshot';

let worker: Worker | undefined;
let identity: string | undefined;
let nextId = 0;
const requests = new Map<
  number,
  { resolve: (plan: OfflineStudyPlan) => void; reject: (error: Error) => void }
>();
function release(error = new Error('offline_study_account')) {
  worker?.terminate();
  worker = undefined;
  identity = undefined;
  for (const request of requests.values()) request.reject(error);
  requests.clear();
}
onOfflineChange(() => {
  if (
    identity &&
    (identity !== `${accountEpoch()}:${offlineState().accountId}` || !offlineState().offline)
  )
    release();
});

/** A deliberate local plan is distinct from a provisional collection browse answer. */
export function localStudyPlan(
  body: Partial<DailyStudySessionRequest>,
  signal?: AbortSignal,
  knownAccount?: Me,
): Promise<OfflineStudyPlan> {
  const state = offlineState();
  const visit = accountEpoch();
  if (!state.offline || !state.available || !state.accountId || state.signedOut)
    return Promise.reject(new Error('offline_study_incomplete'));
  const own = `${visit}:${state.accountId}`;
  if (identity && identity !== own) release();
  if (!worker) {
    identity = own;
    worker = new Worker(new URL('./offline-study-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (
      event: MessageEvent<{ id: number; plan?: OfflineStudyPlan; error?: string }>,
    ) => {
      const pending = requests.get(event.data.id);
      if (!pending) return;
      requests.delete(event.data.id);
      if (identity !== `${accountEpoch()}:${offlineState().accountId}` || !offlineState().offline)
        pending.reject(new Error('offline_study_account'));
      else if (event.data.plan) pending.resolve(event.data.plan);
      else pending.reject(new Error(event.data.error ?? 'offline_study_unavailable'));
    };
    worker.onerror = () => release(new Error('offline_study_unavailable'));
  }
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const abort = () => {
      requests.delete(id);
      signal?.removeEventListener('abort', abort);
      reject(new DOMException('Study planning ended', 'AbortError'));
      if (!requests.size) release();
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    requests.set(id, {
      resolve: (plan) => {
        signal?.removeEventListener('abort', abort);
        resolve(plan);
      },
      reject: (error) => {
        signal?.removeEventListener('abort', abort);
        reject(error);
      },
    });
    worker!.postMessage({
      id,
      accountId: state.accountId,
      request: body,
      knownAccount,
      now: new Date().toISOString(),
    });
  });
}

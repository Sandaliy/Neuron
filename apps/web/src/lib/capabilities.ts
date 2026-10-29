import { offlineState, useOffline } from './offline';

/** Presentation is independent of authority. Entity validity is checked by each write path. */
export function capabilities(state: ReturnType<typeof offlineState>, confirmed = true) {
  const account = !!state.accountId && !state.signedOut;
  return {
    localCollection: account && state.available,
    localEdits: account && state.available,
    localStudy: account && state.available,
    server: account && state.validated && !state.offline && confirmed,
    uncertain: account && !state.signedOut && (!state.validated || state.offline),
  };
}

export function useCapabilities(confirmed = true) {
  return capabilities(useOffline(), confirmed);
}

/** Recheck at invocation; an open dialog never retains an earlier permission. */
export function hasServerAuthority() {
  return capabilities(offlineState()).server;
}

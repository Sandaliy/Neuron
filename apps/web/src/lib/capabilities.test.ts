import { describe, expect, it } from 'vitest';

import { capabilities } from './capabilities';
import { offlineState } from './offline';

describe('local and server capabilities', () => {
  const downloaded = { ...offlineState(), accountId: 'owner', signedOut: false, available: true };
  it('keeps completed local access across transport uncertainty without granting authority', () => {
    for (const connectivity of ['unknown', 'reachable', 'unreachable'] as const) {
      const access = capabilities({ ...downloaded, connectivity, offline: true, validated: false });
      expect(access.localCollection).toBe(true);
      expect(access.localEdits).toBe(true);
      expect(access.localStudy).toBe(true);
      expect(access.server).toBe(false);
    }
  });
  it('requires validation and confirmed entity provenance for server operations', () => {
    const validated = { ...downloaded, offline: false, validated: true };
    expect(capabilities(validated).server).toBe(true);
    expect(capabilities(validated, false).server).toBe(false);
    expect(capabilities({ ...validated, validated: false }).server).toBe(false);
    expect(capabilities({ ...validated, available: false }).localEdits).toBe(false);
  });
  it('revokes all access on sign-out or absent account', () => {
    for (const state of [
      { ...downloaded, signedOut: true },
      { ...downloaded, accountId: null },
    ]) {
      const access = capabilities(state);
      expect(
        access.localCollection || access.localEdits || access.localStudy || access.server,
      ).toBe(false);
    }
  });
});

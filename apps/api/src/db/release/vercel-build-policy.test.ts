import { describe, expect, it, vi } from 'vitest';

import { SchemaCompatibilityError } from '../compatibility.js';

import { shouldVerifyLiveSchema, waitForProductionSchema } from './vercel-build-policy.js';

describe('Vercel schema policy', () => {
  it('keeps Preview owner-free and independent of its shared database', () => {
    expect(shouldVerifyLiveSchema('preview')).toBe(false);
    expect(shouldVerifyLiveSchema('development')).toBe(false);
    expect(shouldVerifyLiveSchema('production')).toBe(true);
  });

  it('waits for a trusted migration and then accepts the production schema', async () => {
    const compatible = { applicationRole: 'neuron_app', authenticationRole: 'neuron_auth' };
    const verify = vi
      .fn<() => Promise<typeof compatible>>()
      .mockRejectedValueOnce(new SchemaCompatibilityError(['missing cards.future_column']))
      .mockResolvedValueOnce(compatible);
    const pause = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    await expect(waitForProductionSchema(verify, { pause })).resolves.toEqual(compatible);
    expect(verify).toHaveBeenCalledTimes(2);
    expect(pause).toHaveBeenCalledWith(10_000);
  });

  it('fails immediately for an unexpected or privileged runtime role', async () => {
    const error = new SchemaCompatibilityError(['connected as neondb_owner, expected neuron_app']);
    const pause = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    await expect(waitForProductionSchema(() => Promise.reject(error), { pause })).rejects.toBe(
      error,
    );
    expect(pause).not.toHaveBeenCalled();
  });

  it('fails closed when the trusted migration does not finish in time', async () => {
    const error = new SchemaCompatibilityError(['missing cards.future_column']);
    const pause = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    await expect(
      waitForProductionSchema(() => Promise.reject(error), { pause, timeoutMs: 0 }),
    ).rejects.toBe(error);
    expect(pause).not.toHaveBeenCalled();
  });
});

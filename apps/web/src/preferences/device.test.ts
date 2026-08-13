import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDevicePreference } from './device';

/**
 * The rule these prove is the one the old code broke: a value this device has
 * chosen is this device's, and nothing arriving later may overwrite it.
 */
function preference(key = 'neuron.test') {
  const applied: string[] = [];

  const value = createDevicePreference<string>({
    key,
    fallback: () => 'default',
    parse: (raw) => (['a', 'b', 'default'].includes(raw) ? raw : undefined),
    serialise: (raw) => raw,
    apply: (raw) => applied.push(raw),
  });

  return { value, applied };
}

describe('a device preference', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reads local storage while it is being created, not in an effect', () => {
    localStorage.setItem('neuron.test', 'b');

    const { value, applied } = preference();

    expect(value.get()).toBe('b');
    // Applied during creation, which is before React renders anything.
    expect(applied).toEqual(['b']);
  });

  it('falls back when this device has never chosen', () => {
    const { value } = preference();

    expect(value.get()).toBe('default');
    expect(value.chosen()).toBe(false);
  });

  it('falls back when what is stored is not a value it knows', () => {
    localStorage.setItem('neuron.test', 'sepia');

    const { value } = preference();

    expect(value.get()).toBe('default');
    expect(value.chosen()).toBe(false);
  });

  it('remembers that this device chose, so nothing later may overwrite it', () => {
    const { value } = preference();

    value.set('a');

    expect(value.chosen()).toBe(true);
    expect(localStorage.getItem('neuron.test')).toBe('a');
  });

  it('counts choosing the value already on screen as a choice', () => {
    const { value } = preference();

    value.set('default');

    expect(value.chosen()).toBe(true);
  });

  it('applies and tells its subscribers before set returns', () => {
    const { value, applied } = preference();
    const listener = vi.fn();

    value.subscribe(listener);
    value.set('a');

    expect(applied).toEqual(['default', 'a']);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(value.get()).toBe('a');
  });

  it('says nothing when the value did not move', () => {
    const { value } = preference();
    const listener = vi.fn();

    value.set('a');
    value.subscribe(listener);
    value.set('a');

    expect(listener).not.toHaveBeenCalled();
  });

  it('drops the subscriber it is asked to drop', () => {
    const { value } = preference();
    const listener = vi.fn();

    const drop = value.subscribe(listener);

    drop();
    value.set('a');

    expect(listener).not.toHaveBeenCalled();
  });

  it('still works when storage refuses, because Safari private mode does', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    const { value, applied } = preference();

    expect(() => value.set('a')).not.toThrow();
    expect(value.get()).toBe('a');
    expect(applied).toEqual(['default', 'a']);

    setItem.mockRestore();
  });
});

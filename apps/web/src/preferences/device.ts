import { read, write } from '../lib/storage';

/**
 * A preference that belongs to this device rather than to the account.
 *
 * The theme and the language are the two the interface is drawn from, and both
 * have to be settled before the first frame. That rules out anything that waits
 * on a request: the value is read out of local storage while this module is
 * evaluated, which is before React exists, and applied to the document there
 * and then.
 *
 * A change follows the same path. Write storage, put it on the document, tell
 * whoever is subscribed, all synchronously in the click handler. The server
 * hears about it afterwards and nothing on screen depends on the answer. With
 * the network off, switching the theme still works, because the network was
 * never in the path.
 *
 * The store is deliberately outside React. A value read through
 * `useSyncExternalStore` re-renders the components that actually read it, and a
 * value that only ends up as an attribute on the html element re-renders
 * nothing at all.
 */
export interface DevicePreference<T> {
  /** What this device has chosen, or the default when it never has. */
  readonly get: () => T;
  /** Whether this device has ever chosen, as opposed to running on a default. */
  readonly chosen: () => boolean;
  /** Chooses, applies and remembers. Never waits on anything. */
  readonly set: (value: T) => void;
  readonly subscribe: (listener: () => void) => () => void;
}

export interface DevicePreferenceOptions<T> {
  /** The local storage key. */
  readonly key: string;
  /** The value to use when this device has never chosen. */
  readonly fallback: () => T;
  /** Reads a stored string back, or returns undefined when it is not a value. */
  readonly parse: (raw: string) => T | undefined;
  /** How the value is written to storage. */
  readonly serialise: (value: T) => string;
  /** Puts the value on the document. Runs at import time and on every change. */
  readonly apply?: (value: T) => void;
}

export function createDevicePreference<T>(
  options: DevicePreferenceOptions<T>,
): DevicePreference<T> {
  const raw = read(options.key);
  const stored = raw === undefined ? undefined : options.parse(raw);

  let current = stored ?? options.fallback();
  let everChosen = stored !== undefined;

  const listeners = new Set<() => void>();

  options.apply?.(current);

  return {
    get: () => current,
    chosen: () => everChosen,

    set(value) {
      if (Object.is(value, current) && everChosen) {
        return;
      }

      current = value;
      everChosen = true;

      write(options.key, options.serialise(value));
      options.apply?.(value);

      for (const listener of listeners) {
        listener();
      }
    },

    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
}

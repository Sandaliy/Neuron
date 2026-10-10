import { useSyncExternalStore } from 'react';

let shell = { ready: false, waiting: false };
const listeners = new Set<() => void>();
const snapshot = () => shell;
export function useShellCache() {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, snapshot);
}
const emit = (patch: Partial<typeof shell>) => {
  shell = { ...shell, ...patch };
  listeners.forEach((listener) => listener());
};
export function registerShell() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  void navigator.serviceWorker
    .register('/sw.js', { updateViaCache: 'none' })
    .then((registration) => {
      const waiting = () => emit({ waiting: Boolean(registration.waiting) });
      waiting();
      registration.addEventListener('updatefound', () => {
        registration.installing?.addEventListener('statechange', waiting);
      });
      return navigator.serviceWorker.ready;
    })
    .then((registration) => {
      if (!registration.active) return;
      const channel = new MessageChannel();
      channel.port1.onmessage = (event) => {
        emit({ ready: event.data === __SHELL_VERSION__ });
        channel.port1.close();
      };
      registration.active.postMessage('shell-version', [channel.port2]);
    })
    .catch(() => emit({ ready: false }));
}

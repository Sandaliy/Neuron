/** Only build-owned shell URLs are cached. API/auth responses never enter Cache Storage. */
export function shellWorker(version, files) {
  return `
const VERSION = ${JSON.stringify(version)};
const CACHE = 'neuron.shell:' + VERSION;
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try { const cache = await caches.open(CACHE); await cache.addAll(FILES); }
    catch (error) { await caches.delete(CACHE); throw error; }
  })());
});
// No skipWaiting or clients.claim: an active visit keeps its matching shell.
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('neuron.shell:') && name !== CACHE) await caches.delete(name);
    }
  })());
});
self.addEventListener('message', event => {
  if (event.data === 'shell-version') event.ports[0]?.postMessage(VERSION);
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname === '/api' || url.pathname.startsWith('/api/')) return;
  const key = event.request.mode === 'navigate' ? '/index.html' : url.pathname;
  if (!FILES.includes(key)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(key);
    return cached ?? fetch(event.request);
  })());
});
`;
}

// Offline support. Only caches named with CACHE_PREFIX are created or deleted,
// and only requests inside this app's scope are handled.

const CACHE_PREFIX = 'jjmap-static-';
const VERSION = '1.0.0';
const CACHE = CACHE_PREFIX + VERSION;

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/store.js',
  './js/ui.js',
  './js/graph.js',
  './js/print.js',
  './js/share.js',
  './js/sample.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((a) => new Request(a, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'jjmap:skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.registration.scope)) return;

  if (req.mode === 'navigate') {
    // App shell: share links differ only by #fragment / query, so always serve index.
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      return (await cache.match('./index.html')) || fetch(req);
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    return hit || fetch(req);
  })());
});

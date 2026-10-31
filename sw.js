// Service worker. Bump CACHE_VERSION when the shell list changes.
// All URLs are relative to the SW scope, so it works under /Omri-Valdman/.
const CACHE_VERSION = 'v5';
const CACHE_NAME = 'omri-study-' + CACHE_VERSION;

const PRECACHE = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'js/app.js',
  'js/check.js',
  'js/store.js',
  'js/answersets.js',
  'js/bidi.js',
  'js/progress.js',
  'js/sanitize.js',
  'js/pwa.js',
  'js/dom.js',
  'js/exam.js',
  'js/exam-ui.js',
  'js/guided.js',
  'js/examples.js',
  'js/sheet.js',
  'js/srs.js',
  'js/workout.js',
  'data/math.json',
  'data/physics.json',
  'data/formulas.json',
  'data/examples.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // One bad URL must not abort the whole install.
    await Promise.allSettled(PRECACHE.map((u) => cache.add(new Request(u, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('omri-study-') && k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    if (request.mode === 'navigate') {
      const shell = await cache.match('index.html');
      if (shell) return shell;
    }
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (/\/icons\//.test(url.pathname)) {
    event.respondWith(cacheFirst(req));
  } else {
    // html, css, js, json, manifest: fresh when online, cached when offline
    event.respondWith(networkFirst(req));
  }
});

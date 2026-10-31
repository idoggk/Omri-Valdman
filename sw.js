// Service worker. Bump CACHE_VERSION when the shell list changes.
// All URLs are relative to the SW scope, so it works under /Omri-Valdman/.
const CACHE_VERSION = 'v27';
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
  'js/practice-ui.js',
  'js/drills-ui.js',
  'js/findmistake-ui.js',
  'js/summary.js',
  'js/backup.js',
  'js/variants.js',
  'js/endless-ui.js',
  'js/order-ui.js',
  'js/checkpoints-ui.js',
  'js/methods-ui.js',
  'js/edgecases-ui.js',
  'js/reverse-ui.js',
  'js/ladder.js',
  'js/ladder-ui.js',
  'js/fullsolve-ui.js',
  'js/fading-ui.js',
  'js/feedback.js',
  'js/feedback-ui.js',
  'js/skills.js',
  'js/skills-ui.js',
  'js/nav.js',
  'js/exercise-view.js',
  'data/drills.json',
  'data/checkpoints.json',
  'data/methods.json',
  'data/edgecases.json',
  'data/reverse.json',
  'data/ladder.json',
  'data/fading.json',
  'data/skills.json',
  'data/findmistake.json',
  'data/math.json',
  'data/physics.json',
  'data/formulas.json',
  'data/examples.json',
  'icons/icon-v3-180.png',
  'icons/icon-v3-192.png',
  'icons/icon-v3-512.png',
  'icons/icon-v3-maskable-512.png',
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

// Online visits get the newest files; a slow or dead network falls back to the cache after this long.
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const net = fetch(request, { cache: 'no-cache' }).then((res) => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    });
    const cached = await cache.match(request, { ignoreSearch: true });
    if (!cached) return await net;
    net.catch(() => {});
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(cached), NETWORK_TIMEOUT_MS); });
    try { return await Promise.race([net, timeout]); } finally { clearTimeout(timer); }
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

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // html, css, js, json, manifest, icons: fresh when online, cached only when offline
  event.respondWith(networkFirst(req));
});

// Service worker. Bump CACHE_VERSION when the shell list changes.
// All URLs are relative to the SW scope, so it works under /Omri-Valdman/.
const CACHE_VERSION = 'v62';
const CACHE_NAME = 'omri-study-' + CACHE_VERSION;
const BUILD_HASH = '97573fdaf420fae8'; // written by tools/stamp-version.mjs; do not edit by hand

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
  'js/eqblocks.js',
  'js/math.js',
  'js/mathtex.js',
  'js/mathdir.js',
  'vendor/katex/katex.min.js',
  'vendor/katex/katex.min.css',
  'vendor/katex/fonts/KaTeX_AMS-Regular.woff2',
  'vendor/katex/fonts/KaTeX_Caligraphic-Bold.woff2',
  'vendor/katex/fonts/KaTeX_Caligraphic-Regular.woff2',
  'vendor/katex/fonts/KaTeX_Fraktur-Bold.woff2',
  'vendor/katex/fonts/KaTeX_Fraktur-Regular.woff2',
  'vendor/katex/fonts/KaTeX_Main-Bold.woff2',
  'vendor/katex/fonts/KaTeX_Main-BoldItalic.woff2',
  'vendor/katex/fonts/KaTeX_Main-Italic.woff2',
  'vendor/katex/fonts/KaTeX_Main-Regular.woff2',
  'vendor/katex/fonts/KaTeX_Math-BoldItalic.woff2',
  'vendor/katex/fonts/KaTeX_Math-Italic.woff2',
  'vendor/katex/fonts/KaTeX_SansSerif-Bold.woff2',
  'vendor/katex/fonts/KaTeX_SansSerif-Italic.woff2',
  'vendor/katex/fonts/KaTeX_SansSerif-Regular.woff2',
  'vendor/katex/fonts/KaTeX_Script-Regular.woff2',
  'vendor/katex/fonts/KaTeX_Size1-Regular.woff2',
  'vendor/katex/fonts/KaTeX_Size2-Regular.woff2',
  'vendor/katex/fonts/KaTeX_Size3-Regular.woff2',
  'vendor/katex/fonts/KaTeX_Size4-Regular.woff2',
  'vendor/katex/fonts/KaTeX_Typewriter-Regular.woff2',
  'js/progress.js',
  'js/sanitize.js',
  'js/pwa.js',
  'js/runroutes.js',
  'js/dom.js',
  'js/signkey.js',
  'js/storage.js',
  'js/engine.js',
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
  'js/multipart.js',
  'js/trig.js',
  'js/trig-data.js',
  'js/trig-ui.js',
  'js/mathhard.js',
  'js/mathhard-ui.js',
  'js/ceiling.js',
  'js/transfer.js',
  'js/transfer-ui.js',
  'js/recover.js',
  'js/recover-ui.js',
  'js/notebook.js',
  'js/notebook-ui.js',
  'js/writing.js',
  'js/writing-ui.js',
  'js/booklet.js',
  'js/booklet-ui.js',
  'js/replay.js',
  'js/replay-ui.js',
  'js/blind.js',
  'js/blind-ui.js',
  'js/recovery.js',
  'js/recovery-ui.js',
  'js/pressure.js',
  'js/pressure-ui.js',
  'js/fbuilder.js',
  'js/fbuilder-ui.js',
  'js/sprint.js',
  'js/sprint-ui.js',
  'js/units.js',
  'js/units-data.js',
  'js/units-ui.js',
  'js/estimate.js',
  'js/estimate-data.js',
  'js/estimate-ui.js',
  'js/plan.js',
  'js/plan-ui.js',
  'js/tryfirst.js',
  'js/tryfirst-ui.js',
  'js/logs.js',
  'js/logs-ui.js',
  'js/notes.js',
  'js/notes-ui.js',
  'js/derive.js',
  'js/derive-ui.js',
  'js/calibration.js',
  'js/calibration-ui.js',
  'js/journal.js',
  'js/journal-ui.js',
  'js/examday.js',
  'js/examday-ui.js',
  'js/counter.js',
  'js/counter-data.js',
  'js/counter-ui.js',
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
  'js/boot.js',
  'js/exercise-view.js',
  'data/drills.json',
  'data/checkpoints.json',
  'data/methods.json',
  'data/edgecases.json',
  'data/reverse.json',
  'data/ladder.json',
  'data/ladder-math.json',
  'data/fading.json',
  'data/skills.json',
  'data/findmistake.json',
  'data/multipart.json',
  'data/transfer.json',
  'data/recover.json',
  'data/writing.json',
  'data/booklet.json',
  'data/recovery-hard.json',
  'data/formula-catalogue.json',
  'data/logs-lessons.json',
  'data/logs-ex-1.json',
  'data/logs-ex-2.json',
  'data/logs-ex-3.json',
  'data/notes.json',
  'data/derive-math.json',
  'data/derive-physics.json',
  'data/mathhard-radical.json',
  'data/mathhard-exponent.json',
  'data/mathhard-rational.json',
  'data/mathhard-param.json',
  'data/mathhard-circle.json',
  'data/math.json',
  'data/physics.json',
  'data/formulas.json',
  'data/examples.json',
  'icons/icon-v3-180.png',
  'icons/icon-v3-192.png',
  'icons/icon-v3-512.png',
  'icons/icon-v3-maskable-512.png',
];

// Fetches one shell file, retrying once. Resolves true when it is stored in `cache`.
async function precacheEntry(cache, url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(new Request(url, { cache: 'reload' }));
      if (res && res.ok) { await cache.put(url, res); return true; }
    } catch (err) { /* retried once below */ }
  }
  return false;
}

// Copies a file from the newest previous omri-study-* cache that has it.
async function copyFromOldCaches(cache, url, oldNames) {
  for (const name of oldNames) {
    try {
      const old = await caches.open(name);
      const hit = await old.match(url);
      if (hit) { await cache.put(url, hit); return true; }
    } catch (err) { /* try the next old cache */ }
  }
  return false;
}

// Atomic install: either every shell file is in the new cache (fetched, or carried over from the previous
// version) or install rejects, so the old worker and its cache keep serving. Old caches are only deleted in
// activate, which never runs after a rejected install.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const versionOf = (k) => Number(k.slice('omri-study-'.length).replace(/\D/g, '')) || 0;
    const oldNames = (await caches.keys())
      .filter((k) => k.startsWith('omri-study-') && k !== CACHE_NAME)
      .sort((a, b) => versionOf(b) - versionOf(a));
    const results = await Promise.allSettled(PRECACHE.map(async (u) =>
      (await precacheEntry(cache, u)) || (await copyFromOldCaches(cache, u, oldNames))));
    const missing = PRECACHE.filter((u, i) => !(results[i].status === 'fulfilled' && results[i].value));
    if (missing.length) {
      try { await caches.delete(CACHE_NAME); } catch (err) { /* partial cache is harmless */ }
      throw new Error('precache incomplete: ' + missing.join(', '));
    }
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
// Shell assets (js, css, fonts, icons, html) are precached, so they give up quickly; data JSON waits longer.
const STATIC_TIMEOUT_MS = 1500;
const NETWORK_TIMEOUT_MS = 4000;
const timeoutFor = (url) => (/\.json$/.test(url.pathname) ? NETWORK_TIMEOUT_MS : STATIC_TIMEOUT_MS);

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

async function networkFirst(request, event) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: true });
  const net = fetch(request, { cache: 'no-cache' }).then((res) => {
    if (res && res.status === 200) { // only a plain 200 may replace the cached copy (never 404/5xx/opaque)
      const saving = Promise.resolve(cache.put(request, res.clone())).catch(() => {});
      if (event && typeof event.waitUntil === 'function') event.waitUntil(saving);
    }
    return res;
  });
  if (!cached) {
    try { return await net; } catch (err) {
      if (request.mode === 'navigate') {
        const shell = await cache.match('index.html');
        if (shell) return shell;
      }
      throw err;
    }
  }
  net.catch(() => {});
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(cached), timeoutFor(new URL(request.url))); });
  try {
    const res = await Promise.race([net, timeout]);
    return res && res.ok ? res : cached; // a failed response never hides a good cached copy
  } catch (err) {
    return cached;
  } finally { clearTimeout(timer); }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // html, css, js, json, manifest, icons: fresh when online, cached only when offline
  event.respondWith(networkFirst(req, event));
});

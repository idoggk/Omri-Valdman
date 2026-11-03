// Offline hardening: atomic SW install, networkFirst fallbacks, attempts-log guards, boot retry, version stamp.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './fake-dom.mjs';

const dom = installFakeDom();
const SRS = await import('../js/srs.js');
const ST = await import('../js/storage.js');
const BK = await import('../js/backup.js');
const BOOT = await import('../js/boot.js');
const NAV = await import('../js/nav.js');
const STAMP = await import('../tools/stamp-version.mjs');

const swSrc = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const URLS = STAMP.precacheFiles(swSrc);
const NEW = 'omri-study-v' + /CACHE_VERSION = 'v(\d+)'/.exec(swSrc)[1];
const tick =(ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- service worker harness ---------- */
function makeSw({ fetchImpl, caches: initial = {}, src = swSrc }) {
  const store = new Map(Object.entries(initial).map(([k, v]) => [k, new Map(Object.entries(v))]));
  const handlers = {};
  const key = (r) => (typeof r === 'string' ? r : r.url);
  const mkCache = (m) => ({
    match: async (r) => m.get(key(r).replace(/^https:\/\/h\//, '')),
    put: async (r, res) => { m.set(key(r).replace(/^https:\/\/h\//, ''), res); },
  });
  const ctx = {
    skipped: false,
    self: { addEventListener: (t, f) => { handlers[t] = f; }, location: { origin: 'https://h' }, skipWaiting() { ctx.skipped = true; }, clients: { claim: async () => {} } },
    caches: {
      open: async (n) => { if (!store.has(n)) store.set(n, new Map()); return mkCache(store.get(n)); },
      keys: async () => [...store.keys()],
      delete: async (n) => store.delete(n),
    },
    fetch: fetchImpl, URL, Request: class { constructor(url) { this.url = url; } }, Promise, setTimeout, clearTimeout, Error,
  };
  vm.runInNewContext(src, ctx);
  const install = async () => {
    const waits = [];
    handlers.install({ waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
  };
  return { ctx, store, handlers, install };
}
const okRes = (tag) => ({ ok: true, status: 200, tag, clone() { return this; } });

/* ---------- (1) atomic install ---------- */
test('install: one permanent 404 rejects, skipWaiting is not called and the old cache survives', async () => {
  const bad = URLS[3];
  const sw = makeSw({
    caches: { 'omri-study-v2': { 'index.html': okRes('old-index') } }, // the old cache lacks the bad file
    fetchImpl: async (req) => (req.url === bad ? { ok: false, status: 404 } : okRes('new')),
  });
  await assert.rejects(sw.install(), /precache incomplete.*/);
  assert.equal(sw.ctx.skipped, false);
  assert.ok(sw.store.has('omri-study-v2'));
  assert.equal(sw.store.get('omri-study-v2').get('index.html').tag, 'old-index');
  assert.equal(sw.store.has(NEW), false, 'partial new cache is dropped');
});

test('install: flaky once -> retried and succeeds, then skipWaiting', async () => {
  const flaky = URLS[5];
  const calls = {};
  const sw = makeSw({
    fetchImpl: async (req) => {
      calls[req.url] = (calls[req.url] || 0) + 1;
      if (req.url === flaky && calls[req.url] === 1) throw new TypeError('network');
      return okRes('new');
    },
  });
  await sw.install();
  assert.equal(calls[flaky], 2);
  assert.equal(sw.ctx.skipped, true);
  assert.equal(sw.store.get(NEW).size, URLS.length);
});

test('install: a file that fails twice is copied from the previous cache instead of failing the install', async () => {
  const bad = URLS[7];
  const sw = makeSw({
    caches: { 'omri-study-v1': { [bad]: okRes('v1') }, 'omri-study-v2': { [bad]: okRes('v2') } },
    fetchImpl: async (req) => (req.url === bad ? { ok: false, status: 404 } : okRes('new')),
  });
  await sw.install();
  assert.equal(sw.ctx.skipped, true);
  assert.equal(sw.store.get(NEW).get(bad).tag, 'v2', 'newest old cache wins');
  assert.ok(sw.store.has('omri-study-v2') && sw.store.has('omri-study-v1'),'old caches are not deleted by install');
});

test('install: skipWaiting is only called after every entry is stored', () => {
  const body = swSrc.slice(swSrc.indexOf("addEventListener('install'"), swSrc.indexOf("addEventListener('activate'"));
  assert.ok(body.indexOf('throw new Error') < body.indexOf('skipWaiting'));
  assert.doesNotMatch(body, /caches\.delete\((?!CACHE_NAME)/);
});

/* ---------- (2) networkFirst ---------- */
function fetchSw({ fetchImpl, cached, staticMs = 20, dataMs = 200 }) {
  const src = swSrc.replace('STATIC_TIMEOUT_MS = 1500', `STATIC_TIMEOUT_MS = ${staticMs}`).replace('NETWORK_TIMEOUT_MS = 4000', `NETWORK_TIMEOUT_MS = ${dataMs}`);
  const sw = makeSw({ fetchImpl, src });
  const puts = []; const waits = [];
  sw.ctx.caches.open = async () => ({
    match: async (k) => (k === 'index.html' ? { tag: 'shell' } : cached),
    put: async (...a) => { puts.push(a); },
  });
  const get = (url, extra = {}) => new Promise((resolve, reject) => {
    sw.handlers.fetch({
      request: { method: 'GET', url: 'https://h/' + url, mode: 'cors', ...extra },
      respondWith: (p) => p.then(resolve, reject),
      waitUntil: (p) => waits.push(p),
    });
  });
  return { get, puts, waits };
}

test('networkFirst: 503 with a cached copy returns the cache and does not overwrite it', async () => {
  const s = fetchSw({ fetchImpl: async () => ({ ok: false, status: 503 }), cached: { ok: true, tag: 'cache' } });
  assert.equal((await s.get('js/app.js')).tag, 'cache');
  assert.equal(s.puts.length, 0);
});

test('networkFirst: 404 without a cached copy returns the 404 itself', async () => {
  const res = { ok: false, status: 404 };
  const s = fetchSw({ fetchImpl: async () => res, cached: undefined });
  assert.equal(await s.get('js/missing.js'), res);
  assert.equal(s.puts.length, 0);
});

test('networkFirst: opaque response never replaces a good cached copy', async () => {
  const s = fetchSw({ fetchImpl: async () => ({ ok: false, status: 0, type: 'opaque' }), cached: { tag: 'cache' } });
  assert.equal((await s.get('js/app.js')).tag, 'cache');
  assert.equal(s.puts.length, 0);
});

test('networkFirst: a 200 is stored through event.waitUntil', async () => {
  const s = fetchSw({ fetchImpl: async () => okRes('net'), cached: { tag: 'cache' } });
  assert.equal((await s.get('js/app.js')).tag, 'net');
  assert.equal(s.puts.length, 1);
  assert.equal(s.waits.length, 1);
  await Promise.all(s.waits);
});

test('networkFirst: static assets fall back after the short timeout, data json waits for the long one', async () => {
  const slow = () => new Promise((r) => setTimeout(() => r(okRes('net')), 80));
  const s = fetchSw({ fetchImpl: slow, cached: { tag: 'cache' }, staticMs: 20, dataMs: 300 });
  assert.equal((await s.get('js/app.js')).tag, 'cache');
  assert.equal((await s.get('data/math.json')).tag, 'net');
  assert.match(swSrc, /STATIC_TIMEOUT_MS = 1500/);
  assert.match(swSrc, /NETWORK_TIMEOUT_MS = 4000/);
});

test('networkFirst: a rejected fetch with a cache still serves the cache', async () => {
  const s = fetchSw({ fetchImpl: async () => { throw new TypeError('offline'); }, cached: { tag: 'cache' } });
  assert.equal((await s.get('js/app.js')).tag, 'cache');
});

/* ---------- (3) attempts log ---------- */
const memStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, v); } };
};
const bannerCount = () => document.body.children.filter((n) => n.getAttribute && n.getAttribute('role') === 'alert').length;

test('attempts log: a quota error on save shows the banner once and keeps the log in memory', () => {
  ST.resetStorageBanner();
  document.body.children.length = 0;
  const st = memStorage();
  st.setItem = () => { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; };
  const log = SRS.createLog(st);
  assert.ok(log.add({ exerciseId: 'a', outcome: 'alone', ts: 1 }));
  assert.ok(log.add({ exerciseId: 'b', outcome: 'alone', ts: 2 }));
  assert.equal(bannerCount(), 1);
  assert.equal(log.all().length, 2);
});

test('attempts log: corrupt raw is stashed and the first add() does not destroy it', () => {
  const raw = '[{"exerciseId":"a","ts":1,"outcome":"alone"';
  const st = memStorage({ [SRS.LOG_KEY]: raw });
  const log = SRS.createLog(st);
  assert.deepEqual(log.all(), []);
  assert.equal(st.m.get(SRS.LOG_KEY + '-corrupt'), raw);
  assert.ok(log.add({ exerciseId: 'c', outcome: 'alone', ts: 5 }));
  assert.equal(st.m.get(SRS.LOG_KEY + '-corrupt'), raw);
  assert.equal(JSON.parse(st.m.get(SRS.LOG_KEY)).length, 1);
});

test('attempts log: if the stash cannot be written the corrupt value is never overwritten', () => {
  const raw = '{broken';
  const st = memStorage({ [SRS.LOG_KEY]: raw });
  const set = st.setItem;
  st.setItem = (k, v) => { if (k.endsWith('-corrupt')) throw new Error('nope'); set(k, v); };
  const log = SRS.createLog(st);
  log.add({ exerciseId: 'c', outcome: 'alone', ts: 5 });
  assert.equal(st.m.get(SRS.LOG_KEY), raw);
  assert.equal(log.all().length, 1, 'still usable in memory');
});

test('attempts-log corrupt stash key is excluded from backups', () => {
  assert.ok(BK.EXCLUDED_KEYS.includes('omri-study-attempts-v1-corrupt'));
  assert.ok(!('omri-study-attempts-v1-corrupt' in BK.KNOWN_KEYS));
  assert.equal(SRS.LOG_KEY + '-corrupt', 'omri-study-attempts-v1-corrupt');
});

/* ---------- (4) boot retry ---------- */
const exOk = { id: 'x1', topic: 't' };
const json = (body) => ({ ok: true, status: 200, json: async () => body });
const goodFetch = async (u) => {
  if (u.endsWith('ladder.json')) return json({ stages: [{ id: 's' }] });
  return json([exOk]);
};
const loaders = (over = {}) => ({
  mathhard: async () => ({ ok: true, data: [{ id: 'mh' }] }),
  multipart: async () => ({ ok: true, data: [{ id: 'mp' }] }),
  logs: async () => ({ ok: true, exercises: [{ id: 'lg' }] }),
  ...over,
});
const boot = (fetchFn, l = loaders(), resets = []) => BOOT.loadBootData({ fetchFn, validExercise: () => true, loaders: l, resets });

test('boot: everything loads -> nothing failed', async () => {
  const r = await boot(goodFetch);
  assert.deepEqual(r.failed, []);
  assert.equal(r.exercises.length, 2);
  assert.equal(r.ladder.length, 1);
  assert.equal(r.hard.logs[0].id, 'lg');
});

for (const file of ['math', 'physics', 'ladder']) {
  test(`boot: failing ${file}.json is recorded by name`, async () => {
    const r = await boot(async (u) => (u.endsWith(`${file}.json`) ? { ok: false, status: 404 } : goodFetch(u)));
    assert.deepEqual(r.failed, [file]);
    assert.equal(BOOT.onlyHardFailed(r.failed), false);
  });
}

for (const name of ['mathhard', 'multipart', 'logs']) {
  test(`boot: failing ${name} loader is recorded and its slot is empty`, async () => {
    const r = await boot(goodFetch, loaders({ [name]: async () => ({ ok: false, data: null }) }));
    assert.deepEqual(r.failed, [name]);
    assert.equal(BOOT.onlyHardFailed(r.failed), true);
    assert.deepEqual(r.hard[name], []);
  });
}

test('boot: a throwing fetch never throws out of loadBootData', async () => {
  const r = await boot(async () => { throw new TypeError('offline'); }, loaders({ mathhard: async () => { throw new Error('x'); } }));
  assert.deepEqual(r.failed.sort(), ['ladder', 'math', 'mathhard', 'physics']);
});

test('boot: retry with a working network clears the failures and runs the cache resets', async () => {
  let online = false; let resets = 0;
  const fetchFn = (u) => (online ? goodFetch(u) : Promise.resolve({ ok: false, status: 503 }));
  const bad = { mathhard: async () => ({ ok: false }) };
  const first = await boot(fetchFn, loaders(bad), [() => { resets++; }]);
  assert.ok(first.failed.includes('math') && first.failed.includes('mathhard'));
  online = true;
  const second = await boot(fetchFn, loaders(), [() => { resets++; }]);
  assert.deepEqual(second.failed, []);
  assert.equal(resets, 2);
  assert.equal(second.exercises.length, 2);
});

test('home notice: core failure shows the Hebrew message and a retry button that calls retry', () => {
  let called = 0;
  const p = NAV.bootNotice(['math'], () => { called++; });
  assert.match(p.textContent, /לא הצלחנו לטעון חלק מהתרגילים/);
  const btn = p.byText('button', 'נסו שוב');
  btn.dispatch('click');
  assert.equal(called, 1);
  assert.equal(p.className, 'error');
});

test('home notice: only hard sets failing -> one-line notice about hard slots, nothing when all loaded', () => {
  const p = NAV.bootNotice(['logs', 'multipart'], () => {});
  assert.match(p.textContent, /התרגילים הקשים לא נטענו/);
  assert.equal(p.className, 'notice');
  assert.ok(p.byText('button', 'נסו שוב'));
  assert.equal(NAV.bootNotice([], () => {}), null);
});

test('app.js wires retry to loadData + route and resets the hard-set caches', () => {
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(app, /retry: async \(\) => \{ await loadData\(\); route\(\); \}/);
  assert.match(app, /resets: \[resetMathHardCache, multipart\.resetMultipartCache, resetLogsCache\]/);
});

/* ---------- (5) version stamp ---------- */
test('BUILD_HASH matches the precached files (run: node tools/stamp-version.mjs, then bump CACHE_VERSION/APP_VERSION)', () => {
  const stamped = STAMP.stampedHash(swSrc);
  const fresh = STAMP.computeHash();
  assert.ok(stamped, 'sw.js has no BUILD_HASH line; run node tools/stamp-version.mjs');
  assert.equal(stamped, fresh,
    `Precached files changed since the last stamp (${stamped} != ${fresh}). Run "node tools/stamp-version.mjs", then bump CACHE_VERSION in sw.js, APP_VERSION in js/pwa.js and the version in tests/sw.test.mjs.`);
});

test('stamp hash covers every precache entry and is stable', () => {
  assert.ok(STAMP.precacheFiles(swSrc).includes('js/boot.js'));
  assert.equal(STAMP.computeHash(), STAMP.computeHash());
  assert.match(STAMP.computeHash(), /^[0-9a-f]{16}$/);
});

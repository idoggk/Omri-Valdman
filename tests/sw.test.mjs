import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const list = sw.match(/PRECACHE = \[([\s\S]*?)\]/)[1];
const files = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);

const OPTIONAL = ['data/formulas.json', 'data/examples.json'];

test('every precached file exists', () => {
  for (const f of files) {
    if (f === './' || OPTIONAL.includes(f)) continue; // data created by other jobs; sw tolerates absence
    assert.ok(existsSync(new URL('../' + f, import.meta.url)), f);
  }
});

test('every js module is precached', () => {
  for (const f of readdirSync(new URL('../js/', import.meta.url)).filter((n) => n.endsWith('.js'))) {
    assert.ok(files.includes('js/' + f), f);
  }
});

test('optional data files are precached and install uses allSettled', () => {
  for (const f of OPTIONAL) assert.ok(files.includes(f), f);
  assert.match(sw, /Promise.allSettled/);
});

import vm from 'node:vm';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('sw: skipWaiting, clients.claim, old caches deleted, network-first, version bumped', () => {
  assert.match(sw, /skipWaiting\(\)/);
  assert.match(sw, /clients\.claim\(\)/);
  assert.match(sw, /caches\.delete/);
  assert.doesNotMatch(sw, /cacheFirst/);
  assert.match(sw, /event\.respondWith\(networkFirst\(req\)\)/);
  assert.ok(Number(sw.match(/CACHE_VERSION = 'v(\d+)'/)[1]) >= 6);
});

test('new versioned icons exist, are precached and referenced by html + manifest', () => {
  const html = read('index.html');
  const manifest = JSON.parse(read('manifest.webmanifest'));
  const used = [...html.matchAll(/(?:apple-touch-icon|rel="icon")[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  used.push(...manifest.icons.map((i) => i.src));
  assert.ok(used.length >= 4);
  for (const u of used) {
    assert.match(u, /icon-v3-/);
    assert.ok(files.includes(u), 'precached: ' + u);
    assert.ok(existsSync(new URL('../' + u, import.meta.url)), u);
  }
});

test('titles: Brain Gains, apple title unchanged', () => {
  const html = read('index.html');
  assert.match(html, /<title>Brain Gains<\/title>/);
  assert.match(html, /name="apple-mobile-web-app-title" content="Brain Gains"/);
  for (const f of ['app.js', 'exam-ui.js']) {
    for (const m of read('js/' + f).matchAll(/document\.title = [`'](.*?)[`']/g)) assert.match(m[1], /Brain Gains/, f);
  }
});

function runPwa({ controller, reloaded }) {
  const appended = [];
  const listeners = {};
  const store = { s: reloaded ? { 'omri-sw-reloaded-7': '1' } : {} };
  let reloads = 0;
  const el = () => ({ append(...k) { this.kids = k; }, addEventListener() {}, setAttribute() {}, style: {}, hidden: false });
  const document = {
    readyState: 'complete', head: { append() {} }, body: { append: (x) => appended.push(x) },
    createElement: (tag) => ({ tag, ...el() }), querySelector: () => null, addEventListener() {},
  };
  const sessionStorage = { getItem: (k) => store.s[k] ?? null, setItem: (k, v) => { store.s[k] = v; } };
  const sw = { controller, register: async () => ({ addEventListener() {} }), addEventListener: (t, f) => { listeners[t] = f; } };
  const ctx = {
    document, sessionStorage, localStorage: { getItem: () => '1', setItem() {} }, console,
    navigator: { serviceWorker: sw, userAgent: 'x', platform: 'x' },
    location: { protocol: 'https:', hostname: 'h', reload: () => { reloads++; }, href: 'https://h/' },
    window: { addEventListener() {} }, setTimeout, clearTimeout,
  };
  ctx.window.matchMedia = undefined;
  vm.runInNewContext(read('js/pwa.js'), ctx);
  return { appended, listeners, reloads: () => reloads };
}

test('pwa: version label in footer matches sw cache version', async () => {
  const r = runPwa({ controller: null });
  const label = r.appended.find((x) => x.className === 'app-version');
  assert.equal(label.textContent, 'גרסה ' + sw.match(/CACHE_VERSION = 'v(\d+)'/)[1]);
});

test('pwa: reloads once when a new worker takes control of a stale page', async () => {
  const r = runPwa({ controller: {} });
  await new Promise((res) => setTimeout(res, 10));
  r.listeners.controllerchange();
  r.listeners.controllerchange();
  assert.equal(r.reloads(), 1);
  const again = runPwa({ controller: {}, reloaded: true });
  await new Promise((res) => setTimeout(res, 10));
  again.listeners.controllerchange();
  assert.equal(again.reloads(), 0);
  const first = runPwa({ controller: null });
  await new Promise((res) => setTimeout(res, 10));
  first.listeners.controllerchange();
  assert.equal(first.reloads(), 0);
});

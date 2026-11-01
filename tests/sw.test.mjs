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
  assert.equal(sw.match(/CACHE_VERSION = 'v(\d+)'/)[1], '38');
  assert.ok(files.includes('js/summary.js'));
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

function runPwa({ controller, reloaded, healed, reg }) {
  const appended = [];
  const listeners = {};
  const store = { s: reloaded ? { ['omri-sw-reloaded-' + read('sw.js').match(/CACHE_VERSION = 'v(\d+)'/)[1]]: '1' } : {} };
  if (healed) store.s['omri-selfheal-reloaded'] = '1';
  let reloads = 0;
  const el = () => ({ append(...k) { this.kids = k; }, addEventListener() {}, setAttribute() {}, style: {}, hidden: false });
  const document = {
    readyState: 'complete', head: { append() {} }, body: { append: (x) => appended.push(x) },
    createElement: (tag) => ({ tag, ...el() }), querySelector: () => null, addEventListener() {},
  };
  const sessionStorage = { getItem: (k) => store.s[k] ?? null, setItem: (k, v) => { store.s[k] = v; } };
  const sw = { controller, register: async () => ({ addEventListener() {}, update: async () => {}, ...reg }), addEventListener: (t, f) => { listeners[t] = f; } };
  const ctx = {
    document, sessionStorage, localStorage: { getItem: () => '1', setItem() {} }, console,
    navigator: { serviceWorker: sw, userAgent: 'x', platform: 'x' },
    location: { protocol: 'https:', hostname: 'h', reload: () => { reloads++; }, href: 'https://h/' },
    window: { addEventListener() {} }, setTimeout, clearTimeout,
  };
  ctx.window.matchMedia = undefined;
  vm.runInNewContext(read('js/pwa.js'), ctx);
  return { appended, listeners, ctx, reloads: () => reloads };
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

test('self-heal: update finds a waiting worker -> skip-waiting message and ONE reload, no loop', async () => {
  const posted = [];
  const r = runPwa({ controller: {}, reg: { waiting: { state: 'installed', postMessage: (m) => posted.push(m), addEventListener() {} } } });
  await new Promise((res) => setTimeout(res, 10));
  assert.equal(await r.ctx.window.omriSelfHeal(), true);
  assert.deepEqual(posted, ['skip-waiting']);
  assert.equal(r.reloads(), 1);
  assert.equal(await r.ctx.window.omriSelfHeal(), false);
  assert.equal(r.reloads(), 1);
});

test('self-heal: genuinely missing route (no newer worker) never reloads', async () => {
  const r = runPwa({ controller: {}, reg: {} });
  await new Promise((res) => setTimeout(res, 10));
  assert.equal(await r.ctx.window.omriSelfHeal(), false);
  assert.equal(r.reloads(), 0);
});

test('self-heal: already-healed session does not reload again', async () => {
  const r = runPwa({ controller: {}, healed: true, reg: { waiting: { state: 'installed', postMessage() {}, addEventListener() {} } } });
  await new Promise((res) => setTimeout(res, 10));
  assert.equal(await r.ctx.window.omriSelfHeal(), false);
  assert.equal(r.reloads(), 0);
});

test('app.js calls self-heal from not-found and render-error paths', () => {
  const app = read('js/app.js');
  assert.match(app, /function viewNotFound\(\) \{\s*if \(window\.omriSelfHeal\) window\.omriSelfHeal\(\)/);
  assert.match(app, /route failed for[^\n]*\n\s*if \(window\.omriSelfHeal\) window\.omriSelfHeal\(\)/);
});

// Run sw.js in a fake worker scope to exercise fetch behaviour.
function loadSw({ fetchImpl, cached }) {
  const handlers = {};
  const puts = [];
  const cache = { match: async () => cached, put: async (...a) => { puts.push(a); }, add: async () => {} };
  const ctx = {
    self: { addEventListener: (t, f) => { handlers[t] = f; }, location: { origin: 'https://h' }, skipWaiting() { ctx.skipped = true; } },
    caches: { open: async () => cache, keys: async () => [], delete: async () => true },
    fetch: fetchImpl, URL, Request: class {}, Promise, setTimeout, clearTimeout,
  };
  vm.runInNewContext(sw.replace('NETWORK_TIMEOUT_MS = 4000', 'NETWORK_TIMEOUT_MS = 30'), ctx);
  const fetchReq = (req) => new Promise((resolve, reject) => {
    handlers.fetch({ request: { method: 'GET', url: 'https://h/js/app.js', mode: 'cors', ...req }, respondWith: (p) => p.then(resolve, reject) });
  });
  return { ctx, handlers, fetchReq, puts };
}

test('sw fetch: online gets fresh network response over cache', async () => {
  const { fetchReq, puts } = loadSw({ fetchImpl: async () => ({ ok: true, tag: 'net', clone() { return this; } }), cached: { tag: 'cache' } });
  assert.equal((await fetchReq({})).tag, 'net');
  assert.equal(puts.length, 1);
});

test('sw fetch: slow network falls back to cache after the timeout', async () => {
  const { fetchReq } = loadSw({ fetchImpl: () => new Promise(() => {}), cached: { tag: 'cache' } });
  assert.equal((await fetchReq({})).tag, 'cache');
});

test('sw fetch: offline serves cache, and index.html shell for navigations', async () => {
  const off = async () => { throw new TypeError('offline'); };
  assert.equal((await loadSw({ fetchImpl: off, cached: { tag: 'cache' } }).fetchReq({})).tag, 'cache');
  const nav = loadSw({ fetchImpl: off, cached: undefined });
  nav.ctx.caches.open = async () => ({ match: async (k) => (k === 'index.html' ? { tag: 'shell' } : undefined), put() {} });
  assert.equal((await nav.fetchReq({ mode: 'navigate', url: 'https://h/x' })).tag, 'shell');
});

test('sw: skip-waiting message triggers skipWaiting', () => {
  const s = loadSw({ fetchImpl: async () => ({}), cached: undefined });
  s.handlers.message({ data: 'skip-waiting' });
  assert.equal(s.ctx.skipped, true);
});

test('sw.js CACHE_VERSION equals pwa.js APP_VERSION', () => {
  const swV = /CACHE_VERSION = 'v(\d+)'/.exec(read('sw.js'))[1];
  const pwaV = /APP_VERSION = '(\d+)'/.exec(read('js/pwa.js'))[1];
  assert.equal(pwaV, swV);
});

/* ---------- difficulty feedback (kept here to stay within the change-size limit) ---------- */
const { installFakeDom } = await import('./fake-dom.mjs');
const fdom = installFakeDom();
const F = await import('../js/feedback.js');
const FU = await import('../js/feedback-ui.js');
const NAV = await import('../js/nav.js');
const BK = await import('../js/backup.js');
const STORE = await import('../js/store.js');
const resetFb = () => { fdom.store.clear(); STORE.resetCache(); };
const base = { id: 'a', exerciseId: 'm-1', mode: 'exercise', topic: 'math-3', level: 2, rating: 5 };

test('feedback: record validation clamps rating, drops unknown tags, rejects junk', () => {
  assert.equal(F.sanitizeRecord({ ...base, rating: 99 }).rating, 10);
  assert.equal(F.sanitizeRecord({ ...base, rating: -3 }).rating, 1);
  assert.equal(F.sanitizeRecord({ ...base, rating: 6.6 }).rating, 7);
  assert.equal(F.sanitizeRecord({ ...base, rating: 'x' }), null);
  assert.equal(F.sanitizeRecord({ ...base, rating: null }), null);
  assert.equal(F.sanitizeRecord({ ...base, exerciseId: '' }), null);
  assert.equal(F.sanitizeRecord(null), null);
  const r = F.sanitizeRecord({ ...base, hardTags: ['calc', 'calc', 'bogus', 7], mode: 'zzz', note: 'x'.repeat(500), correct: 'yes' });
  assert.deepEqual(r.hardTags, ['calc']);
  assert.equal(r.mode, 'exercise');
  assert.equal(r.note.length, 200);
  assert.equal(r.correct, null);
  assert.equal(r.secondsSpent, null);
  assert.equal(F.sanitizeRecord({ ...base, note: '   ' }).note, undefined);
});

test('feedback: same id updates instead of duplicating; storage is capped; junk storage reads empty', () => {
  resetFb();
  F.saveFeedback({ ...base, rating: 3 }, 100);
  F.saveFeedback({ ...base, rating: 8, hardTags: ['units'] }, 200);
  F.saveFeedback({ ...base, id: 'b', rating: 4 }, 300);
  const all = F.loadFeedback();
  assert.equal(all.length, 2);
  assert.equal(all[0].rating, 8);
  assert.deepEqual(all[0].hardTags, ['units']);
  assert.equal(F.saveFeedback({ ...base, rating: 0.2 }, 1).rating, 1);
  let list = [];
  for (let i = 0; i < F.FEEDBACK_CAP + 50; i++) list = F.upsert(list, F.sanitizeRecord({ ...base, id: 'r' + i }, 1));
  assert.equal(list.length, F.FEEDBACK_CAP);
  assert.equal(list[list.length - 1].id, 'r' + (F.FEEDBACK_CAP + 49));
  fdom.store.set(F.FEEDBACK_KEY, '{not json');
  assert.deepEqual(F.loadFeedback(), []);
  fdom.store.set(F.FEEDBACK_KEY, JSON.stringify({ records: [{ nope: 1 }, { ...base, ts: 5 }] }));
  assert.equal(F.loadFeedback().length, 1);
});

test('feedback: export JSON shape and summary aggregation', () => {
  const ex = [{ id: 'e1', topic: 'math-3', level: 1 }, { id: 'e2', topic: 'phys-vertical', level: 1 }];
  const log = [
    { exerciseId: 'e1', ts: 10, outcome: 'alone', hintsUsed: 0, seconds: 5 },
    { exerciseId: 'e1', ts: 20, outcome: 'wrong', hintsUsed: 0, seconds: 5, errorReason: 'sign' },
    { exerciseId: 'e2', ts: 30, outcome: 'hinted', hintsUsed: 1, seconds: 5 },
  ];
  const recs = [
    F.sanitizeRecord({ ...base, id: '1', exerciseId: 'e1', rating: 9, hardTags: ['calc', 'signs'] }),
    F.sanitizeRecord({ ...base, id: '2', exerciseId: 'e1', rating: 7, hardTags: ['calc'] }),
    F.sanitizeRecord({ ...base, id: '3', exerciseId: 'e2', topic: 'phys-vertical', rating: 2 }),
  ];
  const out = JSON.parse(JSON.stringify(F.buildExport(recs, log, ex, Date.UTC(2026, 9, 31, 12))));
  assert.deepEqual(Object.keys(out), ['app', 'version', 'exportedAt', 'summary', 'records']);
  assert.equal(out.app, 'brain-gains');
  assert.equal(out.version, 1);
  assert.equal(out.exportedAt, '2026-10-31T12:00:00.000Z');
  assert.equal(out.records.length, 3);
  const s = out.summary;
  assert.equal(s.ratings, 3);
  assert.equal(s.avgRating, 6);
  assert.deepEqual(s.hardTags[0], { tag: 'calc', count: 2 });
  assert.equal(s.hardestExercises[0].exerciseId, 'e1');
  assert.equal(s.hardestExercises[0].avgRating, 8);
  const m3 = s.topics.find((t) => t.topic === 'math-3');
  assert.equal(m3.attempts, 2);
  assert.equal(m3.accuracy, 0.5);
  assert.equal(m3.avgRating, 8);
  assert.deepEqual(s.mistakeReasons, [{ reason: 'sign', count: 1 }]);
  assert.ok(Array.isArray(s.weakTopics) && s.weakTopics.length <= 3);
  assert.equal(F.exportFilename(Date.UTC(2026, 9, 31, 12)), 'brain-gains-feedback-2026-10-31.json');
  const empty = F.buildExport([], [], []);
  assert.equal(empty.summary.ratings, 0);
  assert.deepEqual(empty.records, []);
});

test('feedback: backup allowlist and route table', () => {
  assert.ok(F.FEEDBACK_KEY in BK.KNOWN_KEYS);
  assert.equal(F.FEEDBACK_KEY, 'omri-study-feedback-v1');
  assert.equal(NAV.resolveRoute('#/feedback').name, 'feedback');
  assert.equal(NAV.activeTab('#/feedback'), 'practice');
  assert.equal(NAV.tabsHidden('#/feedback'), false);
  assert.ok(files.includes('js/feedback.js') && files.includes('js/feedback-ui.js'));
});

test('feedback card: rating saves once per attempt, edits update, skip removes, no rating means no record', () => {
  resetFb();
  const card = FU.feedbackCard({ exerciseId: 'm-1', mode: 'workout', topic: 'math-3', level: 2, attemptId: 77, context: () => ({ correct: true, hintsUsed: 1, solutionViewed: false, secondsSpent: 12 }) });
  fdom.show(card);
  card.byText('button', 'שמירה').click();
  assert.equal(F.loadFeedback().length, 0);
  card.all((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'קושי 7')[0].click();
  card.byText('button', 'חישובים').click();
  card.all((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'קושי 9')[0].click();
  const recs = F.loadFeedback();
  assert.equal(recs.length, 1);
  assert.equal(recs[0].rating, 9);
  assert.equal(recs[0].mode, 'workout');
  assert.deepEqual(recs[0].hardTags, ['calc']);
  assert.equal(recs[0].correct, true);
  assert.equal(recs[0].hintsUsed, 1);
  assert.equal(recs[0].secondsSpent, 12);
  card.byText('button', 'שמירה').click();
  assert.equal(F.loadFeedback().length, 1);
  assert.match(fdom.root.textContent, /תודה/);
  const card2 = FU.feedbackCard({ exerciseId: 'm-2', mode: 'exercise', topic: 'math-3', attemptId: 1 });
  fdom.show(card2);
  card2.byText('button', 'דלג').click();
  assert.equal(card2.children.length, 0);
  assert.equal(F.loadFeedback().length, 1);
});

test('feedback export actions: share file, text fallback, cancel, missing APIs never throw', async () => {
  class FakeFile { constructor(parts, name, o) { this.parts = parts; this.name = name; this.type = o.type; } }
  const calls = [];
  let r = await FU.shareExport('{}', 'f.json', { canShare: () => true, share: async (d) => { calls.push(d); } }, FakeFile);
  assert.ok(r.ok);
  assert.equal(calls[0].files[0].name, 'f.json');
  assert.equal(calls[0].files[0].type, 'application/json');
  r = await FU.shareExport('{"a":1}', 'f.json', { canShare: () => false, share: async (d) => { calls.push(d); } }, FakeFile);
  assert.ok(r.ok);
  assert.equal(calls[1].text, '{"a":1}');
  await FU.shareExport('{}', 'f.json', { share: async (d) => { calls.push(d); } }, undefined);
  assert.equal(calls[2].text, '{}');
  r = await FU.shareExport('{}', 'f.json', { share: async () => { const e = new Error('x'); e.name = 'AbortError'; throw e; } }, FakeFile);
  assert.equal(r.ok, false);
  assert.match(r.msg, /בוטל/);
  r = await FU.shareExport('{}', 'f.json', { share: async () => { throw new Error('boom'); } }, FakeFile);
  assert.equal(r.ok, false);
  r = await FU.shareExport('{}', 'f.json', undefined, FakeFile);
  assert.equal(r.ok, false);
  assert.match(r.msg, /לא נתמך/);
  // download
  const made = [];
  function FakeEl(t) { this.tag = t; this.attrs = {}; this.setAttribute = (k, v) => { this.attrs[k] = v; }; this.click = () => { this.clicked = true; }; }
  const doc = { createElement: (t) => { const e = new FakeEl(t); made.push(e); return e; }, body: { append() {} } };
  r = FU.downloadExport('{}', 'f.json', doc, { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, class { constructor(p, o) { this.o = o; } });
  assert.ok(r.ok && made[0].clicked && made[0].attrs.download === 'f.json');
  assert.equal(FU.downloadExport('{}', 'f.json', doc, null, null).ok, false);
  // copy
  let written = '';
  r = await FU.copyExport('{}', { clipboard: { writeText: async (t) => { written = t; } } }, doc);
  assert.ok(r.ok && written === '{}');
  r = await FU.copyExport('{}', { clipboard: { writeText: async () => { throw new Error('denied'); } } }, { createElement: () => ({ select() {}, remove() {} }), body: { append() {} }, execCommand: () => true });
  assert.ok(r.ok);
  r = await FU.copyExport('{}', {}, { createElement: () => ({}), body: { append() {} } });
  assert.equal(r.ok, false);
  assert.equal(r.manual, true);
});

test('feedback screen renders empty and filled states with export buttons', () => {
  resetFb();
  const ctx = { topics: [{ id: 'math-3', title: 'שלושה נעלמים' }], exercises: [], byId: () => null, show: (...n) => fdom.show(...n) };
  FU.viewFeedback(ctx);
  assert.match(fdom.root.textContent, /עדיין אין דירוגים/);
  assert.ok(fdom.root.byText('button', 'שתף בוואטסאפ') && fdom.root.byText('button', 'הורדת קובץ') && fdom.root.byText('button', 'העתקה'));
  F.saveFeedback({ ...base, rating: 8, hardTags: ['calc'] });
  FU.viewFeedback(ctx);
  assert.match(fdom.root.textContent, /קושי ממוצע 8/);
  assert.match(fdom.root.textContent, /שלושה נעלמים: 8/);
  assert.match(fdom.root.textContent, /חישובים: 1/);
});

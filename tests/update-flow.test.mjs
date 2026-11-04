import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(fileURLToPath(new URL('../js/pwa.js', import.meta.url)), 'utf8');
const runSrc = readFileSync(fileURLToPath(new URL('../js/runroutes.js', import.meta.url)), 'utf8');
const MIN = 60_000;

// Runs pwa.js in a fake browser. `fields` = current text inputs ({value, disabled?}); hash can change per test.
function boot({ controller = {}, standalone = false, fields = [], hash = '#/', storage } = {}) {
  const listeners = { win: {}, doc: {}, sw: {} };
  const store = {};
  const local = { ...(storage || {}) };
  let reloads = 0;
  let updates = 0;
  const banners = [];
  const state = { fields, hash };
  const mk = (tag) => ({ tag, append(...k) { this.kids = k; }, addEventListener() {}, setAttribute() {}, style: {}, hidden: false });
  const document = {
    readyState: 'complete', visibilityState: 'visible', head: { append() {} },
    body: { append: (x) => { if (x.className === 'pwa-banner') banners.push(x); } },
    createElement: mk, querySelector: () => null,
    querySelectorAll: () => state.fields,
    addEventListener: (t, f) => { listeners.doc[t] = f; },
  };
  const persist = { calls: 0 };
  const ctx = {
    document, console, setTimeout, clearTimeout,
    sessionStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
    localStorage: { getItem: (k) => local[k] ?? null, setItem: (k, v) => { local[k] = String(v); } },
    navigator: {
      userAgent: 'x', platform: 'x',
      storage: { persisted: async () => false, persist: async () => { persist.calls++; return true; } },
      serviceWorker: {
        controller,
        register: async () => ({ addEventListener() {}, update: async () => { updates++; } }),
        addEventListener: (t, f) => { listeners.sw[t] = f; },
      },
    },
    location: { protocol: 'https:', hostname: 'h', get hash() { return state.hash; }, reload: () => { reloads++; }, href: 'https://h/' },
    window: { addEventListener: (t, f) => { listeners.win[t] = f; }, matchMedia: standalone ? () => ({ matches: true }) : undefined },
  };
  ctx.matchMedia = ctx.window.matchMedia;
  vm.createContext(ctx);
  vm.runInContext(runSrc, ctx); // like index.html: the shared run-screen predicate loads before pwa.js
  vm.runInContext(src, ctx);
  return { ctx, listeners, local, state, banners, persist, reloads: () => reloads, updates: () => updates };
}
const settle = () => new Promise((r) => setTimeout(r, 15));

test('persist() is requested only in the installed app and fails soft', async () => {
  const web = boot({ standalone: false });
  await settle();
  assert.equal(web.persist.calls, 0);
  const app = boot({ standalone: true });
  await settle();
  assert.equal(app.persist.calls, 1);
  const bad = boot({ standalone: true });
  bad.ctx.navigator.storage.persist = async () => { throw new Error('denied'); };
  assert.equal(await bad.ctx.window.omriRequestPersist(), false);
  bad.ctx.navigator.storage = undefined;
  assert.equal(await bad.ctx.window.omriRequestPersist(), false);
});

test('reg.update() runs on load and on visibilitychange, at most once per 30 minutes', async () => {
  const r = boot();
  await settle();
  assert.equal(r.updates(), 1, 'on load');
  const t = Number(r.local['omri-sw-lastcheck']);
  assert.ok(t > 0);
  r.listeners.doc.visibilitychange();
  await settle();
  assert.equal(r.updates(), 1, 'throttled');
  assert.equal(await r.ctx.window.omriCheckForUpdate(t + 29 * MIN), false);
  assert.equal(await r.ctx.window.omriCheckForUpdate(t + 31 * MIN), true);
  assert.equal(r.updates(), 2);
  r.ctx.document.visibilityState = 'hidden';
  r.listeners.doc.visibilitychange();
  await settle();
  assert.equal(r.updates(), 2, 'hidden does not check');
});

test('visibilitychange to visible checks again once the 30 minutes have passed', async () => {
  const r = boot({ storage: { 'omri-sw-lastcheck': String(Date.now() - 31 * MIN) } });
  await settle();
  assert.equal(r.updates(), 1);
});

test('takeover with nothing open reloads immediately, once', async () => {
  const r = boot();
  await settle();
  r.listeners.sw.controllerchange();
  r.listeners.sw.controllerchange();
  assert.equal(r.reloads(), 1);
  assert.equal(r.banners.length, 0);
});

test('takeover while an answer is typed: banner instead, reload on the next route change once the input is gone', async () => {
  const r = boot({ fields: [{ value: '3.5' }] });
  await settle();
  r.listeners.sw.controllerchange();
  assert.equal(r.reloads(), 0);
  assert.equal(r.banners.length, 1);
  assert.equal(r.ctx.window.omriPwa.isReloadPending(), true);
  r.listeners.win.hashchange(); // still typed text on the new page
  assert.equal(r.reloads(), 0);
  r.state.fields = [];
  r.state.hash = '#/';
  r.listeners.win.hashchange();
  assert.equal(r.reloads(), 1);
  r.listeners.win.hashchange();
  assert.equal(r.reloads(), 1, 'reload-once guard');
});

test('takeover during a timed exam or transfer test is deferred; submitted/disabled/readonly/empty inputs do not block', async () => {
  for (const hash of ['#/exam/run', '#/transfer/run']) {
    const r = boot({ hash });
    await settle();
    r.listeners.sw.controllerchange();
    assert.equal(r.reloads(), 0, hash);
    r.state.hash = '#/';
    r.listeners.win.hashchange();
    assert.equal(r.reloads(), 1, hash);
  }
  const idle = boot({ fields: [{ value: '' }, { value: '  ' }, { value: '5', disabled: true }, { value: '5', readOnly: true }], hash: '#/transfer/result' });
  await settle();
  assert.equal(idle.ctx.window.omriPwa.isBusy(), false);
  idle.listeners.sw.controllerchange();
  assert.equal(idle.reloads(), 1);
});

const RUN_HASHES = ['#/exam/run', '#/transfer/run', '#/blind/run', '#/recovery/run', '#/pressure/run', '#/sprint/run/120/mixed', '#/sprint/run/300/fractions',
  '#/workout/1', '#/workout/10', '#/booklet/paper/math/4/17', '#/booklet/enter/physics/3/9'];

test('every run screen is busy and defers the controllerchange reload until the learner leaves', async () => {
  for (const hash of RUN_HASHES) {
    const r = boot({ hash });
    await settle();
    assert.equal(r.ctx.window.omriPwa.isBusy(), true, hash);
    r.listeners.sw.controllerchange();
    assert.equal(r.reloads(), 0, hash);
    assert.equal(r.ctx.window.omriPwa.isReloadPending(), true, hash);
    r.state.hash = '#/';
    r.listeners.win.hashchange();
    assert.equal(r.reloads(), 1, hash);
  }
  for (const hash of ['#/', '#/blind', '#/blind/result', '#/sprint', '#/workout/summary', '#/booklet', '#/pressure']) {
    const r = boot({ hash });
    await settle();
    assert.equal(r.ctx.window.omriPwa.isBusy(), false, hash);
  }
});

test('nav.tabsHidden and pwa.isBusy share one predicate: every tab-hidden hash is busy', async () => {
  const nav = await import('../js/nav.js');
  for (const hash of RUN_HASHES) {
    const r = boot({ hash });
    if (nav.tabsHidden(hash)) assert.equal(r.ctx.window.omriPwa.isBusy(), true, hash);
  }
  assert.equal(nav.tabsHidden('#/sprint/run/120/mixed'), true);
  assert.equal(nav.tabsHidden('#/booklet/paper/math/4/17'), false);
});

test('first install (no controller at load) never reloads, even when deferred logic exists', async () => {
  const r = boot({ controller: null, fields: [{ value: 'x' }] });
  await settle();
  r.listeners.sw.controllerchange();
  assert.equal(r.reloads(), 0);
  assert.equal(r.banners.length, 0);
});

test('help dialog starts with the backup-first step and links to #/backup', () => {
  assert.match(src, /צרו גיבוי \(/);
  assert.match(src, /הדפדפן והאייקון שומרים נתונים בנפרד/);
  assert.match(src, /href: '#\/backup'/);
  assert.ok(src.indexOf('pwa-first-step') < src.indexOf("'אייפון (Safari)'"));
});

test('boot: items dropped by the validator are counted, logged and summarised in Hebrew', async () => {
  const { loadBootData, droppedNote } = await import('../js/boot.js');
  const warns = [];
  const realWarn = console.warn;
  console.warn = (m) => warns.push(m);
  try {
    const fetchFn = async (u) => ({ ok: true, json: async () => (u.includes('ladder') ? { stages: [] } : [{ id: 'a' }, { id: 'b' }, { bad: 1 }]) });
    const ok = async () => ({ ok: true, data: [], exercises: [] });
    const r = await loadBootData({ fetchFn, validExercise: (e) => !!e.id, loaders: { mathhard: ok, multipart: ok, logs: ok } });
    assert.deepEqual(r.dropped, { math: 1, physics: 1 });
    assert.equal(warns.length, 2);
    assert.match(droppedNote(r.dropped), /^2 תרגילים לא נטענו/);
    const clean = await loadBootData({ fetchFn, validExercise: () => true, loaders: { mathhard: ok, multipart: ok, logs: ok } });
    assert.deepEqual(clean.dropped, {});
    assert.equal(droppedNote(clean.dropped), '');
  } finally { console.warn = realWarn; }
});

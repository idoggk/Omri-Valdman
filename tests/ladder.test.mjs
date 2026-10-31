import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './fake-dom.mjs';

const dom = installFakeDom();
const L = await import('../js/ladder.js');
const U = await import('../js/ladder-ui.js');
const B = await import('../js/backup.js');
const nav = await import('../js/nav.js');
const { renderExercise } = await import('../js/exercise-view.js');
const store = await import('../js/store.js');

const read = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const ladder = read('ladder.json');
const physics = read('physics.json');
const stages = ladder.stages;

// the shared fake DOM's replaceChildren() rejects plain strings, which the real DOM (and exercise-view.js) accepts
const Proto = Object.getPrototypeOf(document.createElement('x'));
const realReplace = Proto.replaceChildren;
Proto.replaceChildren = function (...kids) { return realReplace.apply(this, kids.map((k) => (typeof k === 'string' ? document.createTextNode(k) : k))); };

const mk = (id, n) => ({ id, items: Array.from({ length: n }, (_, i) => ({ ref: `${id}-${i}` })) });
const alone = (ids) => (id) => (ids.includes(id) ? 'alone' : null);

test('ladder.json: six Hebrew stages, every ref resolves to a physics exercise, no duplicate ids per stage', () => {
  assert.equal(ladder.v, 1);
  assert.equal(ladder.g, 10);
  assert.deepEqual(stages.map((s) => s.id), ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
  const ids = new Set(physics.map((e) => e.id));
  for (const s of stages) {
    assert.match(s.title, /[א-ת]/);
    assert.match(s.intro, /[א-ת]/);
    const refs = s.items.map((it) => it.ref);
    assert.equal(new Set(refs).size, refs.length, `duplicate in ${s.id}`);
    for (const r of refs) assert.ok(ids.has(r), `${s.id}: unknown ref ${r}`);
    if (!refs.length) assert.match(s.soon, /בקרוב/);
  }
  const all = L.allRefs(stages);
  assert.equal(new Set(all).size, all.length, 'an exercise appears in two stages');
  assert.deepEqual(stages.map((s) => s.items.length), [12, 22, 0, 0, 30, 0]);
});

test('needed(): ceil of 70%', () => {
  assert.deepEqual([0, 1, 2, 3, 5, 10, 12, 22, 30].map(L.needed), [0, 1, 2, 3, 4, 7, 9, 16, 21]);
});

test('unlock rule: first stage open, next opens at the ceil threshold, only "alone" counts', () => {
  const st = [mk('a', 10), mk('b', 3)];
  const status = (ids) => L.ladderStatus(st, alone(ids), {}).map((e) => e.status);
  assert.deepEqual(status([]), ['unlocked', 'locked']);
  assert.deepEqual(status(['a-0', 'a-1', 'a-2', 'a-3', 'a-4', 'a-5']), ['unlocked', 'locked']); // 6/10 < 7
  assert.deepEqual(status(['a-0', 'a-1', 'a-2', 'a-3', 'a-4', 'a-5', 'a-6']), ['done', 'unlocked']); // 7/10
  const hinted = (id) => (id.startsWith('a-') ? 'hinted' : null);
  assert.deepEqual(L.ladderStatus(st, hinted, {}).map((e) => e.status), ['unlocked', 'locked']);
  assert.equal(L.ladderStatus(st, alone(['a-0']), {})[0].alone, 1);
});

test('unlock rule: empty stages are skipped, never block, and show as soon', () => {
  const st = [mk('a', 2), mk('b', 0), mk('c', 0), mk('d', 4)];
  assert.deepEqual(L.ladderStatus(st, alone([]), {}).map((e) => e.status), ['unlocked', 'soon', 'soon', 'locked']);
  assert.deepEqual(L.ladderStatus(st, alone(['a-0', 'a-1']), {}).map((e) => e.status), ['done', 'soon', 'soon', 'unlocked']);
  assert.deepEqual(L.ladderStatus([mk('x', 0), mk('y', 3)], alone([]), {}).map((e) => e.status), ['soon', 'unlocked']);
  assert.deepEqual(L.ladderStatus([], alone([]), {}), []);
});

test('skip flag opens exactly that stage, and is stored in its own key', () => {
  const st = [mk('a', 5), mk('b', 5), mk('c', 5)];
  assert.deepEqual(L.ladderStatus(st, alone([]), { b: true }).map((e) => e.status), ['unlocked', 'unlocked', 'locked']);
  assert.equal(L.ladderStatus(st, alone([]), { b: true })[1].skipped, true);
  L.setSkip('b');
  assert.deepEqual(JSON.parse(localStorage.getItem(L.LADDER_KEY)), { v: 1, skip: { b: true } });
  assert.deepEqual(L.loadLadder().skip, { b: true });
  L.setSkip('b', false);
  assert.deepEqual(L.loadLadder().skip, {});
  assert.deepEqual(L.sanitizeLadder({ skip: { a: true, b: 1, c: 'x' }, junk: 1 }), { v: 1, skip: { a: true } });
  assert.deepEqual(L.sanitizeLadder('garbage'), { v: 1, skip: {} });
  localStorage.setItem(L.LADDER_KEY, '{not json');
  assert.deepEqual(L.loadLadder(), { v: 1, skip: {} });
  localStorage.removeItem(L.LADDER_KEY);
});

test('backup: ladder key is allowlisted and round-trips', () => {
  assert.equal(L.LADDER_KEY, 'omri-study-ladder-v1');
  assert.ok(L.LADDER_KEY in B.KNOWN_KEYS);
  const v = JSON.stringify({ v: 1, skip: { S2: true } });
  const m = new Map([[L.LADDER_KEY, v], ['unrelated', 'x']]);
  const src = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, x) => m.set(k, String(x)) };
  const res = B.parseBackup(B.buildBackup(src, 3));
  assert.equal(res.ok, true);
  const dstMap = new Map();
  const dst = { getItem: (k) => (dstMap.has(k) ? dstMap.get(k) : null), setItem: (k, x) => dstMap.set(k, String(x)) };
  assert.equal(B.applyBackup(dst, res), true);
  assert.equal(dst.getItem(L.LADDER_KEY), v);
  assert.equal(dstMap.size, 1);
});

test('routes: #/ladder resolves, hub shows the ladder card first', () => {
  for (const h of ['#/ladder', '#/ladder/S1', '#/ladder/S1/3']) assert.equal(nav.resolveRoute(h).name, 'ladder');
  assert.deepEqual(nav.resolveRoute('#/ladder/S2/4').args, ['S2', '4']);
  assert.equal(nav.activeTab('#/ladder/S1'), 'practice');
  nav.viewHub({ topics: [], exercises: [], show: dom.show });
  const links = dom.root.all((n) => n.tagName === 'A');
  assert.equal(links[0].getAttribute('href'), '#/ladder');
  assert.match(links[0].textContent, /הסלם לרמת מבחן/);
});

const ctx = {
  show: dom.show,
  ladder: stages,
  topicOf: () => ({ title: 'פיזיקה' }),
  byId: (id) => physics.find((e) => e.id === id),
  renderExercise: (ex, o) => renderExercise(ex, o),
};
const hrefs = () => dom.root.all((n) => n.tagName === 'A').map((a) => a.getAttribute('href'));

test('UI: overview shows six cards with status, progress and soon note; locked stage offers skip', async () => {
  store.resetCache();
  localStorage.clear?.();
  await U.viewLadderRoute(ctx);
  const text = dom.root.textContent;
  assert.match(text, /0\/12 לבד/);
  assert.match(text, /0\/22 לבד/);
  assert.match(text, /🔓 פתוח/);
  assert.match(text, /🔒 נעול/);
  assert.equal((text.match(/⏳ בקרוב/g) || []).length, 3);
  assert.deepEqual(hrefs().filter((h) => h.startsWith('#/ladder/')), ['#/ladder/S1', '#/ladder/S2', '#/ladder/S5']);

  await U.viewLadderRoute(ctx, 'S2'); // locked: no item list, skip button
  assert.match(dom.root.textContent, /השלב נעול/);
  assert.equal(hrefs().filter((h) => /^#\/ladder\/S2\/\d+$/.test(h)).length, 0);
  dom.root.byText('button', 'לדלג בכל זאת').click();
  assert.equal(hrefs().filter((h) => /^#\/ladder\/S2\/\d+$/.test(h)).length, 22);
  assert.deepEqual(L.loadLadder().skip, { S2: true });

  await U.viewLadderRoute(ctx, 'S3');
  assert.match(dom.root.textContent, /יתווספו בקרוב/);
  await U.viewLadderRoute(ctx, 'nope');
  assert.match(dom.root.textContent, /הסלם לרמת מבחן/);
});

test('UI: item page renders the exercise with nav, solving alone updates the stage progress', async () => {
  store.resetCache();
  localStorage.removeItem(L.LADDER_KEY);
  await U.viewLadderRoute(ctx, 'S1', '1');
  const ex = physics.find((e) => e.id === stages[0].items[0].ref);
  assert.match(dom.root.textContent, new RegExp(ex.title.slice(0, 8)));
  assert.ok(hrefs().includes('#/ladder/S1/2'));
  assert.ok(hrefs().includes('#/ladder/S1'));
  assert.ok(!hrefs().includes('#/ladder/S1/0'));
  const inputs = dom.root.all((n) => n.tagName === 'INPUT');
  assert.equal(inputs.length, ex.inputs.length);
  inputs.forEach((inp, i) => { inp.value = ex.inputs[i].answer; });
  // the shared fake DOM's classList only has toggle(); the renderer also calls add/remove
  dom.root.all((n) => n.classList).forEach((n) => { n.classList.add = (c) => n.classList.toggle(c, true); n.classList.remove = (c) => n.classList.toggle(c, false); });
  dom.root.querySelector('form').dispatch('submit');
  assert.match(dom.root.textContent, /נכון/);
  assert.equal(store.outcomeOf(ex.id), 'alone');
  await U.viewLadderRoute(ctx);
  assert.match(dom.root.textContent, /1\/12 לבד/);

  await U.viewLadderRoute(ctx, 'S1', '12'); // last item: finish link
  assert.ok(hrefs().includes('#/ladder'));
  assert.ok(hrefs().includes('#/ladder/S1/11'));
  await U.viewLadderRoute(ctx, 'S1', '99'); // out of range falls back to the stage list
  assert.match(dom.root.textContent, /1\/12 לבד/);
  await U.viewLadderRoute(ctx, 'S5', '1'); // locked stage never renders items
  assert.match(dom.root.textContent, /השלב נעול/);
});

test('UI: load failure shows an error', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 500 });
  await U.viewLadderRoute({ show: dom.show });
  assert.match(dom.root.textContent, /לא ניתן לטעון/);
  globalThis.fetch = realFetch;
});

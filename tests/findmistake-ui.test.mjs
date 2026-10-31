import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './fake-dom.mjs';

const dom = installFakeDom();
const store = await import('../js/store.js');
const F = await import('../js/findmistake-ui.js');
const P = await import('../js/practice-ui.js');

const raw = readFileSync(new URL('../data/findmistake.json', import.meta.url), 'utf8');
const data = JSON.parse(raw);
const okFetch = async () => ({ ok: true, json: async () => JSON.parse(raw) });
const ctx = { topics: [], exercises: [], byId: () => null, show: dom.show, fetchFn: okFetch };
const text = () => dom.root.textContent;
const KEY = 'omri-study-findmistake-v1';
const stepBtns = () => dom.root.all((n) => n.tagName === 'BUTTON' && n.className.includes('drill-opt'));

test('offline: friendly error and a retry button, no throw', async () => {
  F.resetFindMistakeCache();
  await F.viewHunt({ ...ctx, fetchFn: async () => { throw new Error('offline'); } });
  assert.match(text(), /לא ניתן לטעון את התרגילים/);
  assert.ok(dom.root.byText('button', 'נסו שוב'));
  await F.viewHunt({ ...ctx, fetchFn: async () => ({ ok: false, status: 404 }) });
  assert.match(text(), /לא ניתן לטעון/);
  await F.viewHunt({ ...ctx, fetchFn: async () => ({ ok: true, json: async () => ({ not: 'array' }) }) });
  assert.match(text(), /לא ניתן לטעון/);
});

for (const [label, stored] of [['empty', null], ['corrupted', '{not json'], ['garbage shape', '{"items":5,"types":[1]}'],
  ['populated', JSON.stringify({ v: 1, items: { 'fm-m-001': { right: 1, wrong: 2, solved: true, ts: 5 } }, types: { arithmetic: { right: 1, wrong: 2 } } })]]) {
  test(`list, item and progress line render with ${label} storage`, async () => {
    dom.store.clear();
    if (stored != null) dom.store.set(KEY, stored);
    F.resetFindMistakeCache();
    await F.viewHunt(ctx);
    assert.match(text(), /מצאו את הטעות/);
    assert.match(text(), /מערכת משוואות עם 4 נעלמים/);
    assert.match(text(), /תנועה אופקית/);
    assert.equal(dom.root.all((n) => n.tagName === 'A' && (n.getAttribute('href') || '').startsWith('#/hunt/')).length, 30);
    await F.viewHunt(ctx, 'fm-m-001');
    assert.equal(stepBtns().length, data[0].steps.length);
    assert.doesNotMatch(text(), /התשובה הנכונה/);
    P.viewProgress({ ...ctx, topics: [] });
    assert.match(text(), /מצאו את הטעות/);
    assert.match(text(), stored && stored.includes('solved') ? /פתרתם 1 תרגילים/ : /עדיין לא פתרתם/);
  });
}

test('unknown id falls back to the list', async () => {
  await F.viewHunt(ctx, 'nope');
  assert.match(text(), /נמצאו \d+ מתוך 30/);
});

test('wrong tap allows retry, right tap shows feedback and persists accuracy', async () => {
  dom.store.clear();
  await F.viewHunt(ctx, 'fm-m-001');
  const it = data[0];
  const wrongIdx = it.firstWrong === 0 ? 1 : 0;
  stepBtns()[wrongIdx].click();
  assert.match(text(), /לא מכיל את הטעות הראשונה/);
  assert.doesNotMatch(text(), /התשובה הנכונה/);
  assert.ok(stepBtns().every((b) => !b.disabled));
  stepBtns()[it.firstWrong].click();
  assert.match(text(), /נכון! הטעות הראשונה/);
  assert.match(text(), /השלב המתוקן/);
  assert.match(text(), /התשובה הנכונה/);
  assert.ok(dom.root.all((n) => n.tagName === 'A' && n.getAttribute('href') === '#/hunt/fm-m-002').length === 1);
  assert.ok(stepBtns().every((b) => b.disabled));
  const d = store.loadFindMistake();
  assert.deepEqual(d.items['fm-m-001'], { right: 1, wrong: 1, solved: true, ts: d.items['fm-m-001'].ts });
  assert.deepEqual(d.types.arithmetic, { right: 1, wrong: 1 });
  assert.equal(store.countFindMistakeSolved(), 1);
});

test('"show answer" reveals the solution without marking solved', async () => {
  dom.store.clear();
  await F.viewHunt(ctx, 'fm-m-002');
  const it = data[1];
  stepBtns()[it.firstWrong === 0 ? 1 : 0].click();
  dom.root.byText('button', 'הצג תשובה').click();
  assert.match(text(), /לא נכון\. הטעות הראשונה/);
  assert.equal(store.countFindMistakeSolved(), 0);
});

test('data text is sanitized: script tags never reach the DOM', async () => {
  const evil = [{ ...data[0], statement: 'שלום <script>alert(1)</script><span dir="ltr" onclick="x()">x=1</span>' }];
  F.resetFindMistakeCache();
  await F.viewHunt({ ...ctx, fetchFn: async () => ({ ok: true, json: async () => evil }) }, 'fm-m-001');
  const html = dom.root.all((n) => n.className === 'panel statement')[0].innerHTML;
  assert.doesNotMatch(html, /<script|onclick/);
  F.resetFindMistakeCache();
});

test('fm-m-008 regression: derivation is correct and the flawed chain is consistent', () => {
  const it = data.find((x) => x.id === 'fm-m-008');
  const last = it.steps[it.steps.length - 1];
  assert.doesNotMatch(last.text, /y − z/);
  assert.match(last.text, /y − w = −2/);
  assert.equal(it.firstWrong, 3);
  assert.deepEqual(last.check.sols, [[3, 2, 1, 4]]);
});

test('store: sanitizeFindMistake drops junk', () => {
  assert.deepEqual(store.sanitizeFindMistake(7), { v: 1, items: {}, types: {} });
  dom.store.set(KEY, '[1,2]');
  assert.deepEqual(store.loadFindMistake(), { v: 1, items: {}, types: {} });
});

test('cleanup', () => dom.restore());

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './fake-dom.mjs';

const dom = installFakeDom();
const store = await import('../js/store.js');
const O = await import('../js/order-ui.js');
const P = await import('../js/practice-ui.js');

const KEY = 'omri-study-order-v1';
const exercises = ['math', 'physics'].flatMap((f) => JSON.parse(readFileSync(new URL(`../data/${f}.json`, import.meta.url), 'utf8')));
const eligible = exercises.filter(O.isEligible);
const ctx = {
  topics: [], exercises, byId: (id) => exercises.find((e) => e.id === id) || null,
  show: dom.show, diagramFigure: () => null,
};
const text = () => dom.root.textContent;
const btn = (t) => dom.root.all((n) => n.tagName === 'BUTTON' && n.textContent.includes(t) && n.className !== 'order-pick')[0] || null;
const pickButtons = () => dom.root.all((n) => n.tagName === 'BUTTON' && n.className === 'order-pick');
const moveBtn = (pos, dir) => dom.root.all((n) => n.tagName === 'BUTTON' && n.attrs['data-move'] === dir)[pos];
const fresh = (stored) => {
  dom.store.clear(); store.resetCache(); O.resetOrderState();
  if (stored != null) dom.store.set(KEY, stored);
};
const STORES = [null, '{not json', '{"items":5}', '[1]', '{"v":1,"items":{"x":{"best":"a"},"y":3}}',
  JSON.stringify({ v: 1, items: { [eligible[0].id]: { best: 100, ts: 5 }, [eligible[1].id]: { best: 40, ts: 6 } } })];

test('shuffle is deterministic, a permutation and never sorted', () => {
  for (const n of [4, 5, 6, 9]) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const a = O.shuffleOrder(n, 'math-3-001', attempt);
      assert.deepEqual(a, O.shuffleOrder(n, 'math-3-001', attempt));
      assert.deepEqual([...a].sort((x, y) => x - y), Array.from({ length: n }, (_, i) => i));
      assert.notDeepEqual(a, Array.from({ length: n }, (_, i) => i));
    }
  }
  for (const e of eligible) for (let at = 0; at < 3; at++) {
    assert.ok(!O.scoreOrder(O.shuffleOrder(e.solution.length, e.id, at)).perfect);
  }
  assert.notDeepEqual(O.shuffleOrder(6, 'a', 0), O.shuffleOrder(6, 'a', 1));
});

test('scoring: perfect, reversed, one displaced, adjacent swap', () => {
  assert.deepEqual(O.scoreOrder([0, 1, 2, 3, 4]), { correct: [true, true, true, true, true], kept: 5, percent: 100, perfect: true });
  const rev = O.scoreOrder([3, 2, 1, 0]);
  assert.equal(rev.percent, 25); assert.equal(rev.perfect, false);
  assert.equal(O.scoreOrder([1, 2, 3, 4, 0]).percent, 80); // first step moved to the end
  const swap = O.scoreOrder([1, 0, 2, 3]);
  assert.equal(swap.percent, 75); assert.deepEqual(swap.correct, [false, false, true, true]);
  assert.equal(O.scoreOrder([]).percent, 0);
});

test('moveItem moves one step and ignores bad indices', () => {
  assert.deepEqual(O.moveItem([0, 1, 2, 3], 0, 2), [1, 2, 0, 3]);
  assert.deepEqual(O.moveItem([0, 1, 2, 3], 3, 0), [3, 0, 1, 2]);
  assert.deepEqual(O.moveItem([0, 1, 2], 1, 9), [0, 1, 2]);
});

test('eligibility: 4..9 string steps only; data has eligible exercises', () => {
  assert.ok(eligible.length > 20);
  assert.ok(eligible.every((e) => e.solution.length >= 4 && e.solution.length <= 9));
  assert.ok(!O.isEligible(null) && !O.isEligible({ solution: ['a', 'b', 'c'] }) && !O.isEligible({ solution: [1, 2, 3, 4] }));
});

test('store: sanitizes, keeps best, never throws on bad storage', () => {
  fresh('{not json');
  assert.deepEqual(store.loadOrder(), { v: 1, items: {} });
  assert.equal(store.countOrderPerfect(), 0);
  store.recordOrder('a', 60); store.recordOrder('a', 40); store.recordOrder('b', 100);
  assert.equal(store.loadOrder().items.a.best, 60);
  assert.equal(store.countOrderPerfect(), 1);
  fresh('{"items":{"a":{"best":250},"b":{"best":-3},"c":{"best":"x"}}}');
  assert.equal(store.loadOrder().items.a.best, 100);
  assert.equal(store.loadOrder().items.b.best, 0);
  assert.equal(store.loadOrder().items.c, undefined);
  const real = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error('off'); }, setItem() { throw new Error('off'); } };
  assert.doesNotThrow(() => { store.recordOrder('z', 50); store.loadOrder(); store.countOrderPerfect(); });
  globalThis.localStorage = real;
});

test('picker renders in empty, corrupted and populated storage', () => {
  for (const stored of STORES) {
    fresh(stored);
    O.viewOrderRoute(ctx);
    assert.match(text(), /סדרו את שלבי הפתרון/);
    assert.ok(btn('3 נעלמים') && btn('תנועה אופקית') && btn('רמה 2'));
    assert.equal(dom.root.all((n) => n.tagName === 'A' && (n.attrs.href || '').startsWith('#/order/')).length, eligible.length);
  }
  assert.match(text(), /✅ 100%/); assert.match(text(), /שיא: 40%/);
  btn('תנועה אנכית').click();
  const shown = dom.root.all((n) => n.tagName === 'A' && (n.attrs.href || '').startsWith('#/order/')).length;
  assert.equal(shown, eligible.filter((e) => e.topic === 'phys-vertical').length);
});

test('exercise view: unknown id, and shuffled never-sorted start in every storage state', () => {
  fresh(null);
  O.viewOrderRoute(ctx, 'nope');
  assert.match(text(), /התרגיל לא נמצא/);
  for (const stored of STORES) {
    fresh(stored);
    O.viewOrderRoute(ctx, eligible[0].id);
    assert.equal(pickButtons().length, eligible[0].solution.length);
    assert.ok(btn('בדיקה'));
    assert.match(text(), /הקישו על שלב/);
  }
});

function playToPerfect(ex) {
  // sort with up-buttons (insertion by adjacent swaps), reading the current order from the DOM text
  const order = () => pickButtons().map((b) => Number(b.attrs['data-step']));
  for (let guard = 0; guard < 200; guard++) {
    const cur = order();
    const bad = cur.findIndex((v, i) => i > 0 && cur[i - 1] > v);
    if (bad === -1) return;
    moveBtn(bad, 'up').click();
  }
}

test('exercise view: up/down buttons, tap-to-place, check marks, partial credit and persistence', () => {
  fresh(null);
  const ex = eligible[0];
  O.viewOrderRoute(ctx, ex.id);
  const before = pickButtons().map((b) => b.textContent);
  moveBtn(1, 'down').click();
  const after = pickButtons().map((b) => b.textContent.replace(/^\d+\./, ''));
  assert.equal(after[1], before[2].replace(/^\d+\./, ''));
  assert.equal(after[2], before[1].replace(/^\d+\./, ''));
  // tap-to-select then tap-to-place: first step goes to the end
  const first = pickButtons()[0].textContent.replace(/^\d+\./, '');
  pickButtons()[0].click();
  assert.match(text(), /נבחר שלב ממקום 1/);
  pickButtons()[pickButtons().length - 1].click();
  assert.equal(pickButtons().at(-1).textContent.replace(/^\d+\./, ''), first);
  btn('בדיקה').click();
  const marks = dom.root.all((n) => n.className === 'order-mark');
  assert.equal(marks.length, ex.solution.length);
  assert.match(text(), /הסדר הנכון|מושלם/);
  assert.match(text(), /כלל אצבע/);
  assert.match(text(), /% מהשלבים|מושלם/);
  assert.ok(btn('ערבבו ונסו שוב')); assert.ok(dom.root.byText('a', 'התרגיל הבא'));
  const best = store.loadOrder().items[ex.id];
  assert.ok(best && best.best >= 0 && best.best <= 100);
  // after checking, steps are locked
  assert.ok(pickButtons().every((b) => b.disabled));
});

test('exercise view: sorting correctly gives 100%, counts on the progress page, retry reshuffles', () => {
  fresh('{not json');
  const ex = eligible[1];
  O.viewOrderRoute(ctx, ex.id);
  playToPerfect(ex);
  btn('בדיקה').click();
  assert.match(text(), /מושלם/);
  assert.equal(store.loadOrder().items[ex.id].best, 100);
  assert.equal(store.countOrderPerfect(), 1);
  const sec = O.orderSection();
  assert.match(sec.textContent, /סודרו בצורה מושלמת: 1 תרגילים/);
  btn('ערבבו ונסו שוב').click();
  const again = pickButtons().map((b) => b.textContent.replace(/^\d+\./, ''));
  assert.notDeepEqual(pickButtons().map((b) => Number(b.attrs['data-step'])), ex.solution.map((_, i) => i));
  // a worse later attempt never lowers the best
  btn('בדיקה').click();
  assert.equal(store.loadOrder().items[ex.id].best, 100);
});

test('progress line renders in empty/corrupted/populated storage', () => {
  for (const stored of STORES) {
    fresh(stored);
    assert.doesNotThrow(() => O.orderSection());
    assert.match(O.orderSection().textContent, /סידור שלבי פתרון/);
  }
  assert.match(O.orderSection().textContent, /1 תרגילים/);
  assert.equal(typeof P.viewProgress, 'function');
});

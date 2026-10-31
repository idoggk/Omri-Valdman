import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './fake-dom.mjs';
import { validateMethods, holds } from '../tools/verify-methods.mjs';

const dom = installFakeDom();
const M = await import('../js/methods-ui.js');

const load = () => JSON.parse(readFileSync(new URL('../data/methods.json', import.meta.url), 'utf8'));
const bad = (mut) => { const d = load(); mut(d); return validateMethods(d); };
const has = (errs, re) => assert.ok(errs.some((e) => re.test(e)), `expected /${re}/ in:\n${errs.join('\n')}`);
const items = load().items;
const ctx = { show: dom.show, methods: items, rnd: () => 0.5 };

test('real methods.json passes the verifier and has the required mix', () => {
  assert.deepEqual(validateMethods(load()), []);
  assert.ok(items.length >= 30);
  assert.ok(items.filter((i) => i.topic.startsWith('math')).length >= 15);
  assert.ok(items.filter((i) => i.topic.startsWith('phys')).length >= 15);
  assert.ok(items.some((i) => i.kind === 'method') && items.some((i) => i.kind === 'next'));
  assert.ok(items.filter((i) => i.kind === 'next' && (i.equations || []).length).length >= 10);
});

test('injection: structure and numeric errors are caught', () => {
  has(bad((d) => { d.items[0].options[1].correct = true; }), /exactly one option/);
  has(bad((d) => { d.items[0].options.forEach((o) => { o.correct = false; }); }), /exactly one option/);
  has(bad((d) => { d.items[1].id = d.items[0].id; }), /duplicate id/);
  has(bad((d) => { d.items[0].options[2].why = '  '; }), /empty explanation/);
  has(bad((d) => { d.items[0].prompt = 'english only'; }), /Hebrew/);
  has(bad((d) => { d.items[0].options.length = 2; }), /3-4 options/);
  has(bad((d) => { d.items.length = 29; }), /at least 30/);
  const next = load().items.findIndex((i) => i.id === 'mt-math-05');
  has(bad((d) => { d.items[next].equations[0] = 'y = 8 − x'; }), /is false at/);
  has(bad((d) => { d.items[next].options[0].eq = 'x² − 7x + 11 = 0'; }), /correct step/);
  has(bad((d) => { d.items[next].options[1].eq = 'x² − 7x + 10 = 0'; }), /actually true/);
  has(bad((d) => { delete d.items[next].vars; }), /vars missing/);
  has(bad((d) => { delete d.items[next].options[0].eq; }), /must have an eq/);
});

test('equation evaluator: implicit multiplication, powers, roots', () => {
  assert.ok(holds('45 = 5t²', { t: 3 }));
  assert.ok(holds('v = √(vx² + vy²)', { v: 50, vx: 40, vy: 30 }));
  assert.ok(holds('x² − 7x + 10 = (x − 2)·(x − 5)', { x: 2 }));
  assert.ok(!holds('x = 1/2·vx·t²', { x: 36, vx: 12, t: 3 }));
});

test('storage: sanitize rejects junk, record counts tries and keeps last result', () => {
  assert.deepEqual(M.sanitizeMethods('x'), { v: 1, items: {} });
  const s = M.sanitizeMethods({ items: { a: { tries: -3, right: 99, last: 'yes' }, b: 5 } });
  assert.deepEqual(Object.keys(s.items), ['a']);
  assert.equal(s.items.a.tries, 1);
  assert.equal(s.items.a.right, 1);
  assert.equal(s.items.a.last, false);
  M.recordMethod('mt-math-01', false);
  M.recordMethod('mt-math-01', true);
  const d = JSON.parse(localStorage.getItem(M.METHODS_KEY));
  assert.deepEqual([d.items['mt-math-01'].tries, d.items['mt-math-01'].right, d.items['mt-math-01'].last], [2, 1, true]);
});

test('pickRound returns 10 distinct items', () => {
  const r = M.pickRound(items);
  assert.equal(r.length, 10);
  assert.equal(new Set(r.map((i) => i.id)).size, 10);
});

test('list view groups by topic with progress and a round button', async () => {
  dom.root.replaceChildren();
  await M.viewMethodsRoute(ctx);
  const text = dom.root.textContent;
  assert.match(text, /איך מתחילים/);
  assert.match(text, /מתוך 32 פריטים/);
  assert.match(text, /משוואה ריבועית אחרי הצבה/);
  assert.ok(dom.root.all((n) => n.tagName === 'A' && n.getAttribute('href') === '#/methods/round').length === 1);
  assert.equal(dom.root.all((n) => n.tagName === 'A' && /^#\/methods\/mt-/.test(n.getAttribute('href') || '')).length, items.length);
});

async function answer(id, wantCorrect) {
  localStorage.removeItem(M.METHODS_KEY);
  await M.viewMethodsRoute(ctx, id);
  const it = items.find((x) => x.id === id);
  const target = it.options.find((o) => (o.correct === true) === wantCorrect);
  const btn = dom.root.all((n) => n.tagName === 'BUTTON' && n.textContent.includes(target.text.slice(0, 15)))[0];
  assert.ok(btn, 'option button found');
  btn.click();
  return { it, target };
}

test('item view: correct answer gives feedback with explanations for every option and is recorded', async () => {
  const { it } = await answer('mt-math-05', true);
  assert.match(dom.root.textContent, /נכון!/);
  for (const o of it.options) assert.ok(dom.root.textContent.includes(o.why.slice(0, 12)), o.id);
  const d = JSON.parse(localStorage.getItem(M.METHODS_KEY));
  assert.equal(d.items['mt-math-05'].last, true);
});

test('item view: wrong answer shows the right one and records a miss; second click is ignored', async () => {
  const { it, target } = await answer('mt-phys-01', false);
  assert.match(dom.root.textContent, /לא מדויק/);
  assert.match(dom.root.textContent, /התשובה הנכונה/);
  const first = JSON.parse(localStorage.getItem(M.METHODS_KEY));
  assert.equal(first.items[it.id].last, false);
  dom.root.all((n) => n.tagName === 'BUTTON' && n.textContent.includes(it.options.find((o) => o.correct).text.slice(0, 15)))[0].click();
  assert.equal(JSON.parse(localStorage.getItem(M.METHODS_KEY)).items[it.id].tries, 1);
  assert.ok(target);
});

test('unknown id and round flow', async () => {
  await M.viewMethodsRoute(ctx, 'nope');
  assert.match(dom.root.textContent, /לא נמצאה/);
  localStorage.removeItem(M.METHODS_KEY);
  await M.viewMethodsRoute(ctx, 'round');
  for (let n = 0; n < 10; n++) {
    assert.match(dom.root.textContent, new RegExp(`שאלה ${n + 1} מתוך 10`));
    const opt = dom.root.all((x) => x.tagName === 'BUTTON' && x.className.includes('option'))[0];
    opt.click();
    dom.root.all((x) => x.tagName === 'BUTTON' && /השאלה הבאה|לסיכום/.test(x.textContent))[0].click();
  }
  assert.match(dom.root.textContent, /מתוך 10 נכונות/);
  assert.equal(Object.keys(JSON.parse(localStorage.getItem(M.METHODS_KEY)).items).length, 10);
});

test('wiring: app route, home tile, sw asset list', () => {
  const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  assert.match(read('js/app.js'), /parts\[0\] === 'methods'/);
  assert.match(read('js/app.js'), /href: '#\/methods'/);
  assert.match(read('sw.js'), /'js\/methods-ui\.js'/);
  assert.match(read('sw.js'), /'data\/methods\.json'/);
});

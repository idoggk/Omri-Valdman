import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './fake-dom.mjs';
import { validateCheckpoints } from '../tools/verify-checkpoints.mjs';

const dom = installFakeDom();
const C = await import('../js/checkpoints-ui.js');

const load = () => JSON.parse(readFileSync(new URL('../data/checkpoints.json', import.meta.url), 'utf8'));
const bad = (mut) => { const d = load(); mut(d); return validateCheckpoints(d); };
const has = (errs, re) => assert.ok(errs.some((e) => re.test(e)), `expected /${re}/ in:\n${errs.join('\n')}`);

test('real checkpoints.json passes the independent verifier', () => {
  assert.deepEqual(validateCheckpoints(load()), []);
  const d = load();
  assert.ok(d.items.length >= 24);
  assert.equal(d.items.filter((i) => i.topic.startsWith('math')).length, 12);
  assert.equal(d.items.filter((i) => i.topic.startsWith('phys')).length, 12);
  for (const i of d.items) assert.ok(i.checkpoints.length >= 2 && i.checkpoints.length <= 4, i.id);
});

test('injection: tampered checkpoint answer, final answer, solver params, decimals, Hebrew, key', () => {
  has(bad((d) => { d.items[0].checkpoints[2].answer += 1; }), /recomputed/);
  has(bad((d) => { d.items[3].final.answer += 1; }), /recomputed/);
  has(bad((d) => { d.items[0].solver.params.t += 1; }), /recomputed|does not appear/);
  has(bad((d) => { d.items[12].solver.params.h0 += 5; }), /recomputed|does not appear/);
  has(bad((d) => { d.items[15].checkpoints[0].answer = 2.123; }), /more than 2 decimals/);
  has(bad((d) => { d.items[0].statement = 'solve it'; }), /Hebrew/);
  has(bad((d) => { d.items[0].checkpoints[0].key = 'nope'; }), /unknown for solver/);
  has(bad((d) => { d.items[0].solver.type = 'zzz'; }), /unknown solver/);
  has(bad((d) => { d.items[0].checkpoints.length = 1; }), /2-4 checkpoints/);
  has(bad((d) => { d.items[1].id = d.items[0].id; }), /duplicate id/);
  has(bad((d) => { d.items.pop(); }), /at least 24/);
});

test('injection: complex roots and non-terminating results are rejected', () => {
  has(bad((d) => { d.items[0].solver.params.t = 100; }), /negative discriminant|recomputed/);
  has(bad((d) => { d.items[14].solver.params.h0 = 7; }), /not a finite decimal|recomputed/);
});

/* ---------- UI ---------- */
const items = load().items;
const ctx = { show: dom.show, checkpoints: items };
const text = () => dom.root.textContent;
const form = () => dom.root.querySelector('form');
const type = (v) => { dom.root.querySelector('input').value = String(v); form().dispatch('submit'); };
const fresh = () => { dom.store.clear(); };
const btn = (t) => dom.root.byText('button', t);

test('list shows all items with done marks', async () => {
  fresh();
  await C.viewCheckpointsRoute(ctx);
  const links = dom.root.all((n) => n.tagName === 'A' && /^#\/checkpoints\/cp-/.test(n.attrs.href || ''));
  assert.equal(links.length, items.length);
  assert.match(text(), /טרם נוסה/);
  C.recordCheckpoints(items[0].id, []);
  await C.viewCheckpointsRoute(ctx);
  assert.match(text(), /בלי טעויות/);
});

test('perfect run: every step accepted, summary has no missed steps, attempt recorded', async () => {
  fresh();
  const it = items[0];
  await C.viewCheckpointsRoute(ctx, it.id);
  for (const c of [...it.checkpoints, it.final]) type(c.answer);
  assert.match(text(), /מושלם/);
  const rec = C.loadCheckpoints().items[it.id];
  assert.deepEqual(rec.missed, []);
  assert.equal(rec.perfect, true);
});

test('wrong answer: feedback, hint appears after first miss, reveal after two, missed steps listed', async () => {
  fresh();
  const it = items[20];
  await C.viewCheckpointsRoute(ctx, it.id);
  const hint = () => dom.root.all((n) => n.className === 'notice')[0];
  assert.equal(hint().hidden, true);
  type('99999');
  assert.match(text(), /לא מדויק/);
  assert.equal(hint().hidden, false);
  assert.equal(btn('הציגו תשובה').hidden, true);
  type('abc');
  assert.equal(btn('הציגו תשובה').hidden, false);
  type(it.checkpoints[0].answer); // now correct
  for (const c of [...it.checkpoints.slice(1), it.final]) type(c.answer);
  assert.match(text(), /דרשו חזרה/);
  const rec = C.loadCheckpoints().items[it.id];
  assert.deepEqual(rec.missed, [0]);
  assert.equal(rec.perfect, false);
});

test('revealing an answer counts as missed; unknown id and sanitizer', async () => {
  fresh();
  const it = items[5];
  await C.viewCheckpointsRoute(ctx, it.id);
  type('x'); type('x');
  btn('הציגו תשובה').click();
  for (const c of [...it.checkpoints.slice(1), it.final]) type(c.answer);
  assert.deepEqual(C.loadCheckpoints().items[it.id].missed, [0]);
  await C.viewCheckpointsRoute(ctx, 'nope');
  assert.match(text(), /לא נמצא/);
  for (const raw of [null, 5, [1], { items: 3 }, { items: { a: 7, b: { runs: 'x', missed: [1, 'a', -1, 99] } } }]) {
    const s = C.sanitizeCheckpoints(raw);
    assert.equal(s.v, 1);
    for (const e of Object.values(s.items)) assert.ok(e.missed.every((n) => n >= 0 && n < 10));
  }
  dom.store.set(C.CP_KEY, '{bad json');
  assert.deepEqual(C.loadCheckpoints().items, {});
});

test('accepts fractions and decimals via check.js parsing', async () => {
  fresh();
  const it = items.find((i) => i.checkpoints.some((c) => c.answer === 6.25));
  await C.viewCheckpointsRoute(ctx, it.id);
  for (const c of it.checkpoints) type(c.answer === 6.25 ? '25/4' : String(c.answer).replace('.', ','));
  type(it.final.answer);
  assert.deepEqual(C.loadCheckpoints().items[it.id].missed, []);
});

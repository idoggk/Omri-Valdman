import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './fake-dom.mjs';
import { validate, physics, bodyModel, roots } from '../tools/verify-multipart.mjs';

const dom = installFakeDom();
const M = await import('../js/multipart.js');
const nav = await import('../js/nav.js');

const raw = readFileSync(new URL('../data/multipart.json', import.meta.url), 'utf8');
const load = () => JSON.parse(raw);
const data = load();
const byId = (id) => data.find((q) => q.id === id);
const okFetch = async () => ({ ok: true, json: async () => load() });
const ctx = { topics: [], exercises: [], byId: () => null, show: dom.show, fetchFn: okFetch };
const text = () => dom.root.textContent;
const inputs = () => dom.root.all((n) => n.tagName === 'INPUT' && n.getAttribute('type') === 'text' && !n.disabled);
const press = (label) => dom.root.all((n) => n.tagName === 'BUTTON' && !n.disabled && n.textContent === label)[0].dispatch('click');

test('data passes the verifier', () => assert.deepEqual(validate(data), []));

test('evalFormula: precedence, unary minus, power, sqrt, errors', () => {
  assert.equal(M.evalFormula('2+3*4', {}), 14);
  assert.equal(M.evalFormula('-g*a^2/2', { g: 10, a: 2 }), -20);
  assert.equal(M.evalFormula('(b+sqrt(b^2+2*g*h0))/g', { b: -8, g: 10, h0: 36 }), 2);
  assert.throws(() => M.evalFormula('x+1', {}));
  assert.throws(() => M.evalFormula('2+', {}));
  assert.throws(() => M.evalFormula('sin(1)', {}));
});

test('classifyPart: correct, carried-forward, plain wrong', () => {
  const q = byId('mp-1');
  const d = q.parts.find((p) => p.id === 'd');
  assert.equal(M.classifyPart(q, d, 45, { b: 30 }), 'correct');
  // student's b = 20 (wrong); method b^2/(2g) gives 20 -> carried
  assert.equal(M.classifyPart(q, d, 20, { b: 20 }), 'carried');
  // same wrong value but the earlier answer was right: plain wrong
  assert.equal(M.classifyPart(q, d, 20, { b: 30 }), 'wrong');
  // wrong earlier answer but the value does not follow from it
  assert.equal(M.classifyPart(q, d, 33, { b: 20 }), 'wrong');
  assert.equal(M.classifyPart(q, d, NaN, {}), 'wrong');
  // a skipped earlier part counts as the true value
  assert.equal(M.classifyPart(q, d, 20, { b: null }), 'wrong');
});

test('carried chain through two parts (final answer checked against truth)', () => {
  const q = byId('mp-4');
  const [, , c, dd] = q.parts;
  assert.equal(M.classifyPart(q, c, 85, { a: 30 }), 'wrong');
  assert.equal(M.classifyPart(q, c, 35 + 1600 / 20, { a: 40 }), 'carried'); // h0 + a^2/(2g) with the wrong a
  assert.equal(M.classifyPart(q, dd, 7.8, { a: 40, b: 3, c: 115 }), 'carried'); // 3 + sqrt(2*115/10) = 7.80 from the wrong c
  assert.equal(M.classifyPart(q, dd, 7, { a: 30, b: 3, c: 80 }), 'correct');
});

test('points and number parsing', () => {
  assert.equal(M.pointsOf({ a: 'correct', b: 'carried', c: 'wrong' }), 1.5);
  assert.equal(M.parseNumber('−0,75'), -0.75);
  assert.equal(M.parseNumber(' 12 '), 12);
  assert.ok(Number.isNaN(M.parseNumber('abc')));
  assert.ok(Number.isNaN(M.parseNumber('')));
});

test('saved attempts: sanitize garbage and record best score', () => {
  dom.store.clear();
  assert.deepEqual(M.sanitizeSaved('{x'), { v: 1, items: {} });
  assert.deepEqual(M.sanitizeSaved({ items: 5 }), { v: 1, items: {} });
  localStorage.setItem(M.KEY, '{not json');
  assert.deepEqual(M.loadSaved().items, {});
  M.recordAttempt('mp-1', { a: 'correct', b: 'wrong' });
  M.recordAttempt('mp-1', { a: 'correct', b: 'carried' });
  M.recordAttempt('mp-1', { a: 'wrong', b: 'wrong' });
  const it = M.loadSaved().items['mp-1'];
  assert.equal(it.attempts, 3);
  assert.equal(it.best, 1.5);
  assert.equal(it.last.a, 'wrong');
});

test('offline: friendly error and retry', async () => {
  M.resetMultipartCache();
  await M.viewMultipart({ ...ctx, fetchFn: async () => { throw new Error('offline'); } });
  assert.match(text(), /לא ניתן לטעון את השאלות/);
  assert.ok(dom.root.byText('button', 'נסו שוב'));
});

test('list screen links every question', async () => {
  M.resetMultipartCache();
  await M.viewMultipart(ctx);
  assert.equal(dom.root.all((n) => n.tagName === 'A' && (n.getAttribute('href') || '').startsWith('#/multipart/')).length, 22);
  assert.match(text(), /חימום/);
  assert.match(text(), /רמת מבחן/);
  const hrefs = dom.root.all((n) => n.tagName === 'A' && (n.getAttribute('href') || '').startsWith('#/multipart/')).map((a) => a.getAttribute('href'));
  assert.equal(hrefs[8], '#/multipart/mp-9'); // warm-up first, exam level after, hardest last
  assert.equal(hrefs[21], '#/multipart/mp-22');
});

test('flow: wrong first part carries into method credit; checklist shown; attempt saved', async () => {
  dom.store.clear();
  M.resetMultipartCache();
  await M.viewMultipart(ctx, 'mp-1');
  assert.match(text(), /מבנה תשובה/);
  assert.equal(dom.root.all((n) => n.tagName === 'INPUT' && n.getAttribute('type') === 'checkbox').length, 5);
  const seq = /* b wrong; c, d, e follow from it */ ['40', '20', '2', '20', '160'];
  for (const v of seq) {
    const input = inputs()[0];
    input.value = v;
    press('בדיקה');
  }
  assert.match(text(), /שגיאה מועברת/);
  assert.match(text(), /2\.5 מתוך 5/);
  const saved = M.loadSaved().items['mp-1'];
  assert.deepEqual(saved.last, { a: 'correct', b: 'wrong', c: 'carried', d: 'carried', e: 'carried' });
  assert.ok(dom.root.byText('a', 'השאלה הבאה ←'));
});

test('flow: invalid input is rejected without advancing; skip shows solution', async () => {
  dom.store.clear();
  M.resetMultipartCache();
  await M.viewMultipart(ctx, 'mp-2');
  inputs()[0].value = 'abc';
  press('בדיקה');
  assert.match(text(), /יש להקליד מספר/);
  assert.equal(inputs().length, 1);
  press('אין לי תשובה: הציגו פתרון');
  assert.match(text(), /פתרון:/);
  assert.equal(inputs().length, 1); // part ב revealed
});

test('physics model sanity (independent of stored answers)', () => {
  const p = physics({ v0: 50, ang: 37, h0: 0 });
  assert.equal(p({ k: 'range' }), 240);
  assert.equal(physics({ v0: 10, ang: -53, h0: 36 })({ k: 'tflight' }), 2);
});

test('verifier failure injection', () => {
  const inject = (mutate) => { const c = load(); mutate(c[0]); return validate(c); };
  assert.ok(inject((q) => { q.parts[2].answer = 4; }).some((m) => /independent physics|formula/.test(m)));
  assert.ok(inject((q) => { q.parts[2].uses = []; }).some((m) => /uses/.test(m)));
  assert.ok(inject((q) => { q.parts[2].formula = 'b/g+e'; }).some((m) => /later|uses|error/.test(m)));
  assert.ok(inject((q) => { q.parts[3].answer = 45.123; }).some((m) => /2 places/.test(m)));
  assert.ok(inject((q) => { q.parts[0].ask = 'english'; }).some((m) => /Hebrew/.test(m)));
  assert.ok(inject((q) => { q.given.g = 9.8; }).some((m) => /g must be 10/.test(m)));
  assert.ok(validate(load().slice(1)).some((m) => /expected 22/.test(m)));
});

test('route and hub tile', () => {
  assert.deepEqual(nav.resolveRoute('#/multipart'), { name: 'multipart', args: [] });
  assert.deepEqual(nav.resolveRoute('#/multipart/mp-3'), { name: 'multipart', args: ['mp-3'] });
  nav.viewHub({ ...ctx, topics: [{ id: 'math-3', title: 'x' }], exercises: [] });
  assert.ok(dom.root.all((n) => n.tagName === 'A').some((a) => a.getAttribute('href') === '#/multipart'));
});

test('tiers: 8 warm-up then 14 exam, each exam question has 5-6 lettered parts with step lists', () => {
  assert.deepEqual(data.slice(0, 8).map((q) => q.tier), Array(8).fill('warmup'));
  const exam = data.slice(8);
  assert.equal(exam.length, 14);
  for (const q of exam) {
    assert.equal(q.tier, 'exam');
    assert.ok(q.parts.length >= 5 && q.parts.length <= 6, q.id);
    assert.ok(q.parts.every((p) => Array.isArray(p.solution) && p.solution.length >= 2), q.id);
    assert.ok(q.parts.filter((p) => p.uses.length).length >= 4, q.id);
  }
  assert.ok(exam.filter((q) => q.diagram).length >= 12);
  assert.ok(exam.some((q) => q.parts.some((p) => p.diagram))); // sketch self-check graph shown with the solution
});

test('numeric engine: meetings, landings, second angle (independent of closed forms)', () => {
  const cars = bodyModel({ bodies: [{ vx: 4, ax: 2 }, { x0: 30, ax: 4, t0: 3 }] });
  assert.ok(Math.abs(cars.val({ k: 'meet', b: [0, 1], n: 1 }) - 4) < 1e-6);
  assert.ok(Math.abs(cars.val({ k: 'meet', b: [0, 1], n: 2 }) - 12) < 1e-6);
  assert.ok(Number.isNaN(cars.val({ k: 'meet', b: [0, 1], n: 3 })));
  const ball = bodyModel({ bodies: [{ y0: 45, vy: 12.5, ay: -10 }] });
  assert.ok(Math.abs(ball.val({ k: 'land', b: 0 }) - 4.5) < 1e-6);
  const shotM = bodyModel({ bodies: [{ y0: 1.7, vx: 8, vy: 6, ay: -10 }] });
  assert.ok(Math.abs(shotM.val({ k: 'altAngle', b: 0, target: [7.2, 3.05] }) - 63.75) < 0.01);
  assert.deepEqual(roots((x) => x - 1, 0, 3).map((r) => Math.round(r)), [1]);
});

test('formula atand and carried angle', () => {
  assert.ok(Math.abs(M.evalFormula('atand(1)', {}) - 45) < 1e-9);
  const q = byId('mp-21');
  const e = q.parts.find((p) => p.id === 'e');
  assert.equal(M.classifyPart(q, e, 20.56, { a: 10, d: -3 }), 'correct');
  assert.equal(M.classifyPart(q, e, 14.04, { a: 10, d: -2 }), 'carried'); // atand(2/8) = 14.04
});

test('exam flow: a full question renders its diagram and finishes', async () => {
  dom.store.clear();
  M.resetMultipartCache();
  await M.viewMultipart(ctx, 'mp-12');
  assert.ok(dom.root.all((n) => n.tagName === 'FIGURE').length >= 1);
  for (const v of ['21', '9', '8', '16', '4', '12']) { inputs()[0].value = v; press('בדיקה'); }
  assert.match(text(), /6 מתוך 6 נקודות/);
  assert.deepEqual(Object.values(M.loadSaved().items['mp-12'].last), Array(6).fill('correct'));
});

test('verifier failure injection on exam questions', () => {
  const inject = (mutate) => { const c = load(); mutate(c[11]); return validate(c); }; // mp-12 cars
  assert.ok(inject((q) => { q.parts[4].answer = 5; }).some((m) => /independent physics|formula/.test(m)));
  assert.ok(inject((q) => { q.model.bodies[1].ax = 3; }).some((m) => /independent physics/.test(m)));
  assert.ok(inject((q) => { q.diagram = q.diagram.replace('30', '31'); }).some((m) => /stale/.test(m)));
  assert.ok(inject((q) => { q.tier = 'warmup'; }).length > 0);
  const c = load();
  c[16].parts[1].answer = -31; // mp-17 vy
  assert.ok(validate(c).some((m) => /independent physics/.test(m)));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './fake-dom.mjs';
import { validate, physics, bodyModel, roots, simModel, graphModel } from '../tools/verify-multipart.mjs';

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
  assert.equal(dom.root.all((n) => n.tagName === 'A' && (n.getAttribute('href') || '').startsWith('#/multipart/')).length, 32);
  assert.match(text(), /חימום/);
  assert.match(text(), /רמת מבחן/);
  const hrefs = dom.root.all((n) => n.tagName === 'A' && (n.getAttribute('href') || '').startsWith('#/multipart/')).map((a) => a.getAttribute('href'));
  assert.equal(hrefs[8], '#/multipart/mp-9'); // warm-up first, exam level after, hardest last
  assert.equal(hrefs[21], '#/multipart/mp-22');
  assert.equal(hrefs[22], '#/multipart/mp-23'); // the new exam-level questions follow the earlier ones in the same section
  assert.equal(hrefs[31], '#/multipart/mp-32');
  assert.equal(dom.root.all((n) => n.tagName === 'SECTION' && n.getAttribute('aria-label') === 'רמת מבחן')[0].all((n) => n.tagName === 'A').length, 24);
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
  press('אין לי תשובה, להציג פתרון');
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
  assert.ok(validate(load().slice(1)).some((m) => /expected 32/.test(m)));
});

test('route and hub tile', () => {
  assert.deepEqual(nav.resolveRoute('#/multipart'), { name: 'multipart', args: [] });
  assert.deepEqual(nav.resolveRoute('#/multipart/mp-3'), { name: 'multipart', args: ['mp-3'] });
  nav.viewHub({ ...ctx, topics: [{ id: 'math-3', title: 'x' }], exercises: [] });
  assert.ok(dom.root.all((n) => n.tagName === 'A').some((a) => a.getAttribute('href') === '#/multipart'));
});

test('tiers: 8 warm-up then 24 exam, each exam question has 5-6 lettered parts with step lists', () => {
  assert.deepEqual(data.slice(0, 8).map((q) => q.tier), Array(8).fill('warmup'));
  const exam = data.slice(8);
  assert.equal(exam.length, 24);
  for (const q of exam) {
    assert.equal(q.tier, 'exam');
    assert.ok(q.parts.length >= 5 && q.parts.length <= 6, q.id);
    assert.ok(q.parts.every((p) => Array.isArray(p.solution) && p.solution.length >= 2), q.id);
    assert.ok(q.parts.filter((p) => p.uses.length).length >= 4, q.id);
  }
  assert.ok(exam.filter((q) => q.diagram).length >= 22);
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

const NEW = ['mp-23', 'mp-24', 'mp-25', 'mp-26', 'mp-27', 'mp-28', 'mp-29', 'mp-30', 'mp-31', 'mp-32'];

test('mp-23..32: ten six-part exam questions covering graphs, meetings, directions, range and relative motion', () => {
  const qs = NEW.map(byId);
  assert.ok(qs.every((q) => q && q.tier === 'exam' && q.parts.length === 6 && q.given.g === 10));
  assert.ok(qs.filter((q) => q.figure && q.figure.graph).length >= 4); // graphs to read: v-t, x-t, y-t
  assert.deepEqual(qs.filter((q) => q.figure && q.figure.graph).map((q) => q.figure.graph.kind).sort(), ['vt', 'vt', 'xt', 'yt']);
  assert.ok(qs.filter((q) => q.parts.some((p) => ['meet', 'meetX'].includes(p.q.k))).length >= 2); // two bodies meeting
  assert.ok(qs.filter((q) => q.parts.some((p) => ['ang', 'tan', 'reltan'].includes(p.q.k))).length >= 2); // direction of the velocity
  assert.ok(qs.some((q) => q.parts.some((p) => p.q.k === 'launchSpeed' && /R/.test(p.formula))));
  assert.ok(qs.some((q) => q.parts.some((p) => p.q.k === 'relspeed'))); // plane vs jeep
  assert.ok(qs.every((q) => !/sin|cos|סינוס/i.test(q.stem)));
  assert.ok(qs.filter((q) => q.model.bodies.some((b) => b.ay)).every((q) => q.stem.includes('התנגדות האוויר זניחה')));
});

test('simulation and graph engines recompute values with no closed form', () => {
  const sim = simModel({ bodies: [{ vx: 4, ax: 2 }, { x0: 30, ax: 4, t0: 3 }] });
  assert.ok(Math.abs(sim({ k: 'meet', b: [0, 1], n: 1 }) - 4) < 1e-3);
  assert.ok(Math.abs(sim({ k: 'meet', b: [0, 1], n: 2 }) - 12) < 1e-3);
  const ball = simModel({ bodies: [{ y0: 60, vx: 40, vy: 20, ay: -10 }] });
  assert.ok(Math.abs(ball({ k: 'land', b: 0 }) - 6) < 1e-3);
  assert.ok(Math.abs(ball({ k: 'maxY', b: 0 }) - 80) < 1e-2);
  assert.throws(() => ball({ k: 'nope', b: 0 }));
  const g = graphModel({ series: [{ pts: [[0, 0], [4, 12], [12, 12], [16, 0]] }, { fn: [40, 6], t1: 12 }] });
  assert.ok(Math.abs(g({ k: 'gArea', s: 0, t0: 0, t1: 16 }) - 144) < 1e-6);
  assert.ok(Math.abs(g({ k: 'gSlope', s: 0, t0: 12, t1: 16 }) + 3) < 1e-9);
  assert.equal(g({ k: 'gMax', s: 0 }), 12);
  assert.equal(g({ k: 'gVal', s: 1, t: 0 }), 40);
});

test('verifier failure injection on mp-23..32 (second route, plotted data, text rules)', () => {
  const idx = (id) => data.findIndex((q) => q.id === id);
  const inject = (id, mutate) => { const c = load(); mutate(c[idx(id)]); return validate(c); };
  // graph-read answer must match the plotted data
  assert.ok(inject('mp-23', (q) => { q.parts[1].answer = 4; }).some((m) => /independent physics/.test(m)));
  // the plotted series must be the motion of the model body (change the plot, keep the stale diagram)
  assert.ok(inject('mp-28', (q) => { q.figure.graph.series[1].fn = [40, 7]; }).some((m) => /differs from the model body|stale/.test(m)));
  assert.ok(inject('mp-29', (q) => { q.model.bodies[1].pts[2][1] = 22; }).some((m) => /differs from the model body|independent physics/.test(m)));
  // meeting solver, projectile events, relative motion
  assert.ok(inject('mp-30', (q) => { q.parts[0].answer = 4; }).some((m) => /independent physics|simulation/.test(m)));
  assert.ok(inject('mp-32', (q) => { q.parts[2].answer = 41; }).some((m) => /independent physics|simulation/.test(m)));
  assert.ok(inject('mp-27', (q) => { q.parts[4].answer = 51; }).some((m) => /independent physics|simulation/.test(m)));
  assert.ok(inject('mp-31', (q) => { q.parts[4].answer = 0.8; }).some((m) => /independent physics|simulation/.test(m)));
  // text rules
  assert.ok(inject('mp-25', (q) => { q.stem += ' sin37° = 0.6'; }).some((m) => /sin\/cos/.test(m)));
  assert.ok(inject('mp-25', (q) => { q.stem = q.stem.replace('התנגדות האוויר זניחה', 'ללא חיכוך'); }).some((m) => /air resistance/.test(m)));
  assert.ok(inject('mp-26', (q) => { q.parts.pop(); }).some((m) => /6 parts|5-6|uses/.test(m)));
});

test('lint: every projectile stem in multipart (not only mp-23+) and transfer says "התנגדות", and the audited stems carry it', async () => {
  const { airResistanceProblem } = await import('../tools/wording.mjs');
  for (const q of data) assert.equal(airResistanceProblem(q.title, q.stem), null, q.id);
  for (const id of ['mp-3', 'mp-4', 'mp-5', 'mp-6', 'mp-7', 'mp-8', 'mp-10', 'mp-13', 'mp-19']) assert.ok(data.find((q) => q.id === id).stem.includes('התנגדות האוויר זניחה'), id);
  for (const id of ['mp-4', 'mp-5', 'mp-7']) assert.ok(/ציר y חיובי כלפי מעלה/.test(data.find((q) => q.id === id).stem), `${id} must state the y axis`);
  assert.ok(!data.find((q) => q.id === 'mp-11').stem.includes('שמרחקו האופקי מקצה הבמה d'));
  const idx = (id) => data.findIndex((q) => q.id === id);
  const c = load();
  c[idx('mp-3')].stem = c[idx('mp-3')].stem.replace('התנגדות האוויר זניחה', 'ללא חיכוך');
  assert.ok(validate(c).some((m) => /air resistance/.test(m)));
  const tr = JSON.parse((await import('node:fs')).readFileSync(new URL('../data/transfer.json', import.meta.url), 'utf8'));
  const trItems = Array.isArray(tr) ? tr : Object.values(tr).flat();
  for (const id of ['tr-p-01', 'tr-p-04', 'tr-p-05', 'tr-p-08', 'tr-p-10', 'tr-p-11']) assert.ok(trItems.find((q) => q.id === id).stem.includes('התנגדות'), id);
});

test('exam flow with a graph question: mp-24 finishes with full marks and a wrong v0 is carried forward', async () => {
  dom.store.clear();
  M.resetMultipartCache();
  await M.viewMultipart(ctx, 'mp-24');
  assert.ok(dom.root.all((n) => n.tagName === 'FIGURE').length >= 1);
  // a=25, b=45 right; c=10 wrong (true 20); d follows from the wrong c via the method (10+sqrt(100+500))/10 = 3.45
  for (const v of ['25', '45', '10', '3.45', '5', '2']) { inputs()[0].value = v; press('בדיקה'); }
  const last = M.loadSaved().items['mp-24'].last;
  assert.equal(last.c, 'wrong');
  assert.equal(last.d, 'carried');
  assert.equal(last.e, 'wrong');
  assert.equal(last.f, 'correct'); // typed the true value: full credit even though earlier parts were off
  assert.equal(Object.keys(last).length, 6);
  assert.ok(M.loadSaved().items['mp-24'].best > 2);
});

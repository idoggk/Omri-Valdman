import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './fake-dom.mjs';

const dom = installFakeDom();
const U = await import('../js/units.js');
const UI = await import('../js/units-ui.js');
const store = await import('../js/store.js');
const B = await import('../js/backup.js');
const E = await import('../js/engine.js');
const N = await import('../js/nav.js');
const NB = await import('../js/notebook-ui.js');
const { verifyUnits } = await import('../tools/verify-units.mjs');

const q = (id) => U.QUESTIONS.find((x) => x.id === id);

test('verifier: all 30 answers recomputed from the dimension engine match the hand key', () => {
  const r = verifyUnits();
  assert.deepEqual(r.errs, []);
  assert.equal(r.count, 30);
});

test('dimension engine: parsing, identities, scales', () => {
  assert.deepEqual(U.parseUnit('N').dim, [1, 1, -2]);
  assert.deepEqual(U.parseUnit('kg*m/s^2').dim, [1, 1, -2]);
  assert.deepEqual(U.parseUnit('kg/(m*s^2)').dim, [1, -1, -2]);
  assert.ok(U.dimEq(U.parseUnit('J').dim, U.parseUnit('N*m').dim));
  assert.ok(U.dimEq(U.parseUnit('W').dim, U.parseUnit('J/s').dim));
  assert.ok(U.dimEq(U.parseUnit('Pa').dim, U.parseUnit('N/m^2').dim));
  assert.ok(Math.abs(U.parseUnit('km/h').scale - 1 / 3.6) < 1e-12);
  assert.ok(Math.abs(U.parseUnit('g/cm^3').scale - 1000) < 1e-9);
  assert.throws(() => U.parseUnit('parsec'));
  assert.throws(() => U.parseUnit('m/'));
  assert.ok(U.isDimensionless(U.dimDiv(U.parseUnit('m').dim, U.parseUnit('km').dim)));
  assert.equal(U.fmtUnit('kg*m/s^2'), 'kg·m/s²');
});

test('formula consistency: sums of unlike dimensions and wrong powers are caught', () => {
  const sym = { v: 'm/s', a: 'm/s^2', t: 's', x: 'm', v0: 'm/s' };
  assert.equal(U.formulaConsistent('v', 'v0+a*t', sym), true);
  assert.equal(U.formulaConsistent('v', 'a*t^2', sym), false);
  assert.equal(U.formulaConsistent('x', 'v0*t+a*t^2/2', sym), true);
  assert.equal(U.formulaConsistent('v^2', 'v0+2*a*x', sym), false, 'v0 + (m²/s²) mixes dimensions');
  assert.equal(U.formulaConsistent('v', 'sqrt(2*a*x)', sym), true);
  assert.equal(U.formulaConsistent('t', 'sqrt(2*x/a)', sym), true);
  assert.throws(() => U.evalDim('q+1', sym), /unknown symbol/);
});

test('answers: the correct option is the unique one with the target dimension', () => {
  const a = U.answerOf(q('un-01'));
  assert.equal(a.choices[a.index], 'kg·m/s²');
  const g = U.answerOf(q('un-29'));
  assert.equal(g.choices[g.index], 'm');
  assert.equal(U.answerOf(q('un-12')).value > 0.0249 && U.answerOf(q('un-12')).value < 0.0251, true);
  assert.equal(U.answerOf(q('un-10')).value, 20);
  assert.ok(Math.abs(U.answerOf(q('un-18')).value - 4.8) < 1e-12);
  assert.equal(U.answerOf(q('un-19')).index, 1, 'v = a·t² is inconsistent');
  assert.equal(U.answerOf(q('un-20')).index, 0);
  assert.equal(U.answerOf(q('un-26')).index, 0, 'power is a scalar');
  assert.equal(U.answerOf(q('un-27')).index, 1, 'momentum is a vector');
});

test('checking: choices by index, numbers by value', () => {
  const a = U.answerOf(q('un-01'));
  assert.deepEqual(U.checkUnitsAnswer(q('un-01'), a.index), { valid: true, correct: true });
  assert.equal(U.checkUnitsAnswer(q('un-01'), (a.index + 1) % 4).correct, false);
  assert.equal(U.checkUnitsAnswer(q('un-01'), 9).valid, false);
  assert.equal(U.checkUnitsAnswer(q('un-10'), '20').correct, true);
  assert.equal(U.checkUnitsAnswer(q('un-10'), '20.0').correct, true);
  assert.equal(U.checkUnitsAnswer(q('un-10'), '72').correct, false);
  assert.equal(U.checkUnitsAnswer(q('un-12'), '0.025').correct, true);
  assert.equal(U.checkUnitsAnswer(q('un-12'), '0,025').correct, true, 'decimal comma');
  assert.equal(U.checkUnitsAnswer(q('un-12'), '0.25').correct, false);
  assert.equal(U.checkUnitsAnswer(q('un-17'), '90').correct, true);
  assert.equal(U.checkUnitsAnswer(q('un-17'), 'ninety').valid, false);
});

test('session picker: unseen first, then missed, deterministic per seed', () => {
  const saved = U.emptySaved();
  U.recordResult(saved, 'un-01', true, 5);
  U.recordResult(saved, 'un-02', false, 6);
  const p = U.pickSession(saved, 10, 11);
  assert.equal(p.length, 10);
  assert.ok(!p.some((x) => x.id === 'un-01'), 'a question answered correctly waits');
  assert.deepEqual(U.pickSession(saved, 10, 11).map((x) => x.id), p.map((x) => x.id));
  assert.equal(U.pickSession(saved, 30, 1).length, 30);
  assert.ok(U.pickSession(saved, 5, 1, 'dim').every((x) => x.cat === 'dim'));
});

test('persistence: sanitize, round trip, backup key', () => {
  assert.deepEqual(U.sanitizeSaved('x'), U.emptySaved());
  const s = U.sanitizeSaved({ q: { 'un-01': { right: 2, wrong: -1, ts: 5, last: 1 }, bogus: { right: 1 }, 'un-02': 3 } });
  assert.deepEqual(s.q, { 'un-01': { right: 2, wrong: 0, ts: 5, last: 1 } });
  assert.ok(U.KEY in B.KNOWN_KEYS);
  assert.equal(U.knownCount(s), 1);
});

test('engine topic, notebook description and routes', () => {
  assert.match(E.topicTitle('units'), /יחידות/);
  assert.equal(E.topicHref('units'), '#/units');
  assert.equal(E.itemHref('un-03', 'units'), '#/units');
  const d = U.describeUnits('un-10');
  assert.match(d.title, /72 km\/h/);
  assert.match(d.key, /20/);
  assert.equal(U.describeUnits('zz'), null);
  assert.match(NB.describer({})('un-10', 'units').key, /20/);
  assert.equal(N.resolveRoute('#/units/run/dim').name, 'units');
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  for (const f of ['js/units.js', 'js/units-data.js', 'js/units-ui.js']) assert.ok(sw.includes(`'${f}'`), f);
});

test('screen: a numeric question and a choice question record attempts under "units"', () => {
  dom.store.clear();
  store.resetCache();
  const ctx = { show: dom.show };
  UI.viewUnits(ctx);
  assert.match(dom.root.textContent, /30 שאלות/);
  UI.viewUnits(ctx, 'run', 'conv');
  const text = () => dom.root.textContent.replace(/[⁦-⁩]/g, '');
  assert.match(text(), /1 מתוך 7/);
  const input = dom.root.all((n) => n.tagName === 'INPUT')[0];
  assert.ok(input, 'a conversion question is numeric');
  input.value = '-1';
  dom.root.all((n) => n.tagName === 'BUTTON' && n.textContent.trim() === 'בדיקה')[0].click();
  assert.match(text(), /לא נכון/);
  assert.match(text(), /התשובה הנכונה/);
  let log = JSON.parse(dom.store.get('omri-study-attempts-v1'));
  assert.equal(log.length, 1);
  assert.equal(log[0].topic, 'units');
  assert.equal(log[0].outcome, 'wrong');
  assert.match(log[0].exerciseId, /^un-\d\d$/);
  // next: choose the right option of a "dim" question by reading the answer from the engine
  UI.viewUnits(ctx, 'run', 'dim');
  const heading = text();
  const qq = U.QUESTIONS.filter((x) => x.cat === 'dim').find((x) => heading.includes(x.shown.replace(/\s/g, '')) || heading.includes(x.shown));
  assert.ok(qq, 'the formula is displayed');
  const want = U.answerOf(qq);
  dom.root.all((n) => n.tagName === 'BUTTON' && n.textContent.replace(/[⁦-⁩]/g, '').trim() === want.choices[want.index])[0].click();
  assert.match(text(), /✓ נכון/);
  log = JSON.parse(dom.store.get('omri-study-attempts-v1'));
  assert.equal(log.at(-1).outcome, 'alone');
  assert.equal(JSON.parse(dom.store.get(U.KEY)).q[qq.id].last, 1);
});

test('cleanup', () => dom.restore());

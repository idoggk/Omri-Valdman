import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.mjs';
import { verifyAll, verifyTask } from '../tools/verify-counter.mjs';

const dom = installFakeDom();
const C = await import('../js/counter.js');
const UI = await import('../js/counter-ui.js');
const store = await import('../js/store.js');

const task = (id) => C.byId(id);
const typed = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)]));

test('verifier: 20 claims, every claim has counterexamples, holds and out-of-domain values are rejected', () => {
  const r = verifyAll();
  assert.deepEqual(r.errs, []);
  assert.equal(r.tasks, 20);
});

test('verifier catches a claim that is actually true, a witness that fails and a broken predicate', () => {
  const clone = (t) => ({ ...t, vars: t.vars.map((v) => ({ ...v })), witness: { ...t.witness } });
  const run = (t) => { const errs = []; verifyTask(t, errs); return errs; };
  const trueClaim = { ...clone(task('ce-11')), holds: () => true }; // (a+b)^2 = a^2+b^2 "always holds"
  assert.ok(run(trueClaim).some((e) => /no counterexample/.test(e)));
  const badWitness = { ...clone(task('ce-03')), witness: { a: 2, b: 2 } }; // log 4 = log 2 + log 2 holds here
  assert.ok(run(badWitness).some((e) => /witness is not accepted/.test(e)));
  const emptyDomain = { ...clone(task('ce-03')), domain: () => false }; // rejects everything, so there is no counterexample
  assert.ok(run(emptyDomain).some((e) => /witness is not accepted/.test(e)) && run(emptyDomain).some((e) => /no counterexample/.test(e)));
  const neverHolds = { ...clone(task('ce-03')), holds: () => false };
  assert.ok(run(neverHolds).some((e) => /never holds/.test(e)));
});

test('number parsing: decimals, comma, unicode minus, fractions', () => {
  assert.equal(C.parseNum('3'), 3);
  assert.equal(C.parseNum(' -0.5 '), -0.5);
  assert.equal(C.parseNum('−2'), -2);
  assert.equal(C.parseNum('1,5'), 1.5);
  assert.equal(C.parseNum('1/2'), 0.5);
  assert.equal(C.parseNum('1/0'), null);
  assert.equal(C.parseNum(''), null);
  assert.equal(C.parseNum('abc'), null);
  assert.equal(C.parseNum('2x'), null);
});

test('counterexample validation: accepted, claim holds, out of domain, bad input', () => {
  const sq = task('ce-01'); // a^2 = b^2 => a = b
  assert.equal(C.checkCounterexample(sq, typed({ a: 3, b: -3 })).ok, true);
  assert.equal(C.checkCounterexample(sq, typed({ a: 3, b: 3 })).reason, 'holds');
  assert.equal(C.checkCounterexample(sq, typed({ a: 3, b: 4 })).reason, 'domain'); // the hypothesis a^2 = b^2 fails
  assert.equal(C.checkCounterexample(sq, typed({ a: 3, b: 'x' })).reason, 'input');
  assert.equal(C.checkCounterexample(sq, { a: '3' }).reason, 'input');
  const lg = task('ce-03'); // log(a+b) = log a + log b
  assert.equal(C.checkCounterexample(lg, typed({ a: 1, b: 1 })).ok, true);
  assert.equal(C.checkCounterexample(lg, typed({ a: 2, b: 2 })).reason, 'holds'); // log 4 = 2 log 2
  assert.equal(C.checkCounterexample(lg, typed({ a: -1, b: 3 })).reason, 'domain'); // log(-1) is undefined: proves nothing
  const sqrtSq = task('ce-04');
  assert.equal(C.checkCounterexample(sqrtSq, typed({ a: -3 })).ok, true);
  assert.equal(C.checkCounterexample(sqrtSq, typed({ a: 3 })).reason, 'holds');
  const frac = task('ce-09'); // (x-3)/(x+1) >= 0 => x-3 >= 0
  assert.equal(C.checkCounterexample(frac, typed({ x: -5 })).ok, true);
  assert.equal(C.checkCounterexample(frac, typed({ x: -1 })).reason, 'domain'); // denominator zero
  assert.equal(C.checkCounterexample(frac, typed({ x: 0 })).reason, 'domain'); // quotient is negative: hypothesis fails
  assert.equal(C.checkCounterexample(frac, typed({ x: 5 })).reason, 'holds');
  const avg = task('ce-10');
  assert.equal(C.checkCounterexample(avg, typed({ v0: 0, k: 3, T: 2 })).ok, true);
  assert.equal(C.checkCounterexample(avg, typed({ v0: 4, k: 0, T: 2 })).reason, 'holds'); // constant velocity: the formula is right
  assert.equal(C.checkCounterexample(avg, typed({ v0: 0, k: 3, T: -2 })).reason, 'domain');
  const prod = task('ce-06');
  assert.equal(C.checkCounterexample(prod, typed({ a: -3, b: -2, c: 1, d: 5 })).ok, true);
  assert.equal(C.checkCounterexample(prod, typed({ a: 3, b: 2, c: 1, d: 5 })).reason, 'domain'); // a < b fails
  assert.equal(C.checkCounterexample(prod, typed({ a: 1, b: 2, c: 3, d: 4 })).reason, 'holds');
});

test('progress: tries, done, merge by task id', () => {
  const s = C.emptyState();
  C.applyCheck(s, 'ce-01', false, 5);
  C.applyCheck(s, 'ce-01', true, 9);
  assert.deepEqual(s.tasks['ce-01'], { done: true, tries: 2, ts: 9 });
  assert.equal(C.doneCount(s), 1);
  assert.deepEqual(C.sanitize({ tasks: { nope: { done: true }, 'ce-02': { done: 'yes', tries: -3 } } }).tasks, { 'ce-02': { done: false, tries: 0, ts: 0 } });
  const m = JSON.parse(C.mergeCounter(JSON.stringify(s), JSON.stringify({ v: 1, tasks: { 'ce-01': { done: false, tries: 7, ts: 50 }, 'ce-05': { done: true, tries: 1, ts: 1 } } })));
  assert.deepEqual(m.tasks['ce-01'], { done: true, tries: 7, ts: 50 });
  assert.ok(m.tasks['ce-05'].done);
  assert.equal(C.outcomeOf({ solved: true, wrongs: 0 }), 'alone');
  assert.equal(C.outcomeOf({ solved: true, wrongs: 2 }), 'hinted');
  assert.equal(C.outcomeOf({ solved: false, wrongs: 2 }), 'solution');
});

test('page: a wrong then a right counterexample is recorded as topic counter; giving up shows the witness and the correct statement', () => {
  dom.store.clear(); store.resetCache();
  const ctx = { show: dom.show };
  UI.viewCounter(ctx, 't', 'ce-01');
  const inputs = dom.root.all((n) => n.tagName === 'INPUT');
  assert.equal(inputs.length, 2);
  const check = dom.root.byText('button', 'בדיקה');
  inputs[0].value = '3'; inputs[1].value = '4';
  check.click();
  assert.match(dom.root.textContent, /מחוץ לתחום/);
  inputs[1].value = '-3';
  check.click();
  assert.match(dom.root.textContent, /דוגמה נגדית/);
  assert.match(dom.root.textContent, /למה הטענה נכשלת/);
  const log = store.getAttempts();
  assert.equal(log.length, 1);
  assert.equal(log[0].topic, 'counter');
  assert.equal(log[0].exerciseId, 'ce-01');
  assert.equal(log[0].outcome, 'hinted');
  assert.equal(C.load().tasks['ce-01'].done, true);
  UI.viewCounter(ctx, 't', 'ce-02');
  dom.root.byText('button', 'אין לי רעיון').click();
  assert.match(dom.root.textContent, /הניסוח הנכון/);
  assert.equal(store.getAttempts().find((a) => a.exerciseId === 'ce-02').outcome, 'solution');
  UI.viewCounter(ctx);
  assert.match(dom.root.textContent, /הופרכו 2 מתוך 20 טענות|הופרכו 1 מתוך 20 טענות/);
});

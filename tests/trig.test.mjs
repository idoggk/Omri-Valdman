import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.mjs';
import { validate } from '../tools/verify-trig.mjs';
import * as T from '../js/trig.js';
import * as D from '../js/trig-data.js';

const dom = installFakeDom();
globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
const UI = await import('../js/trig-ui.js');
const nav = await import('../js/nav.js');
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

const ctx = { topics: [], exercises: [], byId: () => null, show: dom.show };
const text = () => dom.root.textContent;
const click = (label) => dom.root.all((n) => n.tagName === 'BUTTON' && !n.disabled && n.textContent === label)[0].dispatch('click');

test('verifier: every identity, drill and proof step holds', () => {
  const { errs, stats } = validate();
  assert.deepEqual(errs, []);
  assert.ok(stats.proofs >= 12 && stats.formulas >= 30);
});

test('evalExpr: implicit multiplication, superscripts, degrees, t', () => {
  const env = { a: Math.PI / 6, b: Math.PI / 3 };
  assert.ok(Math.abs(T.evalExpr('sin(a+b)', env) - 1) < 1e-12);
  assert.ok(Math.abs(T.evalExpr('2sin(a)cos(a)', env) - Math.sin(Math.PI / 3)) < 1e-12);
  assert.ok(Math.abs(T.evalExpr('sin²(a)+cos²(a)', env) - 1) < 1e-12);
  assert.ok(Math.abs(T.evalExpr('cos(120°)', env) + 0.5) < 1e-12);
  assert.ok(Math.abs(T.evalExpr('2t/(1+t²)', env) - 0.5) < 1e-12);
  assert.ok(Math.abs(T.evalExpr('1/2sin(a)', env) - 0.25) < 1e-12);
  assert.throws(() => T.evalExpr('foo(a)', env));
  assert.throws(() => T.evalExpr('sin(a', env));
});

test('identity checker separates true from false statements', () => {
  assert.ok(T.chainHolds('cos(2a) = 1 - 2sin²(a) = 2cos²(a) - 1'));
  assert.ok(!T.chainHolds('cos(2a) = 1 - 2cos²(a)'));
  assert.ok(T.chainFalse('sin(a+b) = sin(a) + sin(b)'));
});

test('the verifier would catch a corrupted formula, option and proof', () => {
  const f = D.LESSONS[2].formulas[0];
  const orig = f.eq;
  f.eq = 'cos(a+b) = cos(a)cos(b) + sin(a)sin(b)';
  assert.ok(validate().errs.some((e) => e.includes('not an identity')));
  f.eq = orig;
  const step = D.PROOFS[0].steps[0];
  const okOrig = step.ok;
  step.ok = '(1 - (1 + 2sin²(a)))/sin(2a)';
  assert.ok(validate().errs.length > 0);
  step.ok = okOrig;
  const bad = D.FILL[0].options;
  bad[1] = 'sin(a)cos(b)'; // same as a true piece: gives sin(a)cos(b)*2 ... still false, so make it truly right
  bad[1] = 'cos(a)sin(b)';
  assert.ok(validate().errs.some((e) => e.includes('wrong option')));
  bad[1] = 'cos(a)cos(b)';
  assert.deepEqual(validate().errs, []);
});

test('spot check values at a=30, b=60', () => {
  assert.deepEqual(T.spotValues('sin(a+b) = sin(a)cos(b) + cos(a)sin(b)'), [1, 1]);
  assert.ok(T.spotAgrees('cos(2a) = 1 - 2sin²(a)'));
  assert.ok(!T.spotAgrees('cos(2a) = 1 - 2cos²(a)'));
  assert.equal(T.spotValues('tan(a+b) = 1')[0], null); // tan 90 undefined
});

test('Leitner: right goes up a box and later, wrong returns to box 0 and is due at once', () => {
  const s = T.emptyState();
  const t = 1_000_000;
  T.gradeCard(s, 'x', true, t);
  T.gradeCard(s, 'x', true, t);
  assert.equal(s.cards.x.box, 2);
  assert.equal(s.cards.x.due, t + 2 * T.DAY_MS);
  T.gradeCard(s, 'x', false, t);
  assert.equal(s.cards.x.box, 0);
  assert.equal(s.cards.x.lapses, 1);
  assert.equal(s.cards.x.due, t);
  for (let i = 0; i < 10; i++) T.gradeCard(s, 'y', true, t);
  assert.equal(s.cards.y.box, T.MAX_BOX);
});

test('dueCards: unseen and overdue only, weakest box first', () => {
  const cards = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const s = T.emptyState();
  const now = 5 * T.DAY_MS;
  s.cards.a = { box: 3, due: now - 1, seen: 3, lapses: 0 };
  s.cards.b = { box: 1, due: now - 1, seen: 1, lapses: 0 };
  s.cards.c = { box: 2, due: now + T.DAY_MS, seen: 2, lapses: 0 }; // not due
  assert.deepEqual(T.dueCards(s, cards, now).map((c) => c.id), ['d', 'b', 'a']);
  assert.deepEqual(T.dueCards(s, cards, now, 1).map((c) => c.id), ['d']);
});

test('state sanitize drops garbage and clamps boxes', () => {
  const s = T.sanitizeState({ cards: { a: { box: 99, due: -5, seen: 'x' }, b: 7 }, proofs: { p1: { done: true, mistakes: 2 } }, drills: null });
  assert.equal(s.cards.a.box, T.MAX_BOX);
  assert.equal(s.cards.a.due, 0);
  assert.equal(s.cards.b, undefined);
  assert.equal(s.proofs.p1.done, true);
  assert.deepEqual(T.sanitizeState('junk'), T.emptyState());
});

test('content: three anchors, 12+ proofs, cards for every formula, sum-to-product pattern table', () => {
  assert.deepEqual(D.LESSONS.filter((l) => l.anchor).map((l) => l.id), ['pyth', 'sinsum', 'cossum']);
  assert.equal(D.CARDS.length, D.LESSONS.reduce((n, l) => n + l.formulas.length, 0));
  assert.ok(D.PROOFS.length >= 12);
  assert.equal(D.LESSONS.find((l) => l.id === 's2p').pattern.length, 4);
});

test('routing: #/trig routes and nav entry', () => {
  assert.deepEqual(nav.resolveRoute('#/trig'), { name: 'trig', args: [] });
  assert.deepEqual(nav.resolveRoute('#/trig/proof/p3'), { name: 'trig', args: ['proof', 'p3'] });
});

test('UI: hub, lesson reveal, flashcard session, proof run', () => {
  UI.viewTrigRoute(ctx);
  assert.match(text(), /שלושה עוגנים/);
  UI.viewTrigRoute(ctx, 'learn', 'double');
  assert.match(text(), /גזרו בעצמכם/);
  assert.ok(!/צעד 1\./.test(text()));
  click('הצעד הבא');
  assert.match(text(), /צעד 1\./);

  UI.viewTrigRoute(ctx, 'cards');
  click('הצג תשובה');
  click('לא ידעתי ✗');
  const saved = JSON.parse(store.get(T.KEY));
  assert.equal(Object.values(saved.cards)[0].box, 0);
  assert.equal(Object.values(saved.cards)[0].lapses, 1);

  UI.viewTrigRoute(ctx, 'proof', 'p2');
  const p = D.PROOFS.find((x) => x.id === 'p2');
  const clean = (x) => x.replace(/[\s⁦-⁩‎‏]/g, '');
  const btn = (expr) => dom.root.all((n) => n.tagName === 'BUTTON' && !n.disabled && clean(n.textContent) === clean(expr))[0];
  for (const s of p.steps) {
    btn(s.bad[0].to).dispatch('click');
    assert.match(text(), /לא נכון/);
    btn(s.ok).dispatch('click');
  }
  assert.match(text(), /הוכחתם/);
  const rec = JSON.parse(store.get(T.KEY)).proofs.p2;
  assert.equal(rec.done, true);
  assert.equal(rec.mistakes, p.steps.length);
});

test('UI: drill session renders and records answers', () => {
  UI.viewTrigRoute(ctx, 'drill');
  assert.match(text(), /1 מתוך 10/);
  const choices = dom.root.all((n) => n.tagName === 'BUTTON' && !n.disabled);
  assert.ok(choices.length >= 3);
  choices[0].dispatch('click');
  const b = dom.root.all((n) => n.tagName === 'BUTTON' && n.textContent.startsWith('הבא'))[0]
    || dom.root.all((n) => n.tagName === 'BUTTON' && n.textContent === 'זו השגויה')[0];
  assert.ok(b);
});

test('cleanup', () => dom.restore());

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './fake-dom.mjs';

const dom = installFakeDom();
const store = await import('../js/store.js');
const R = await import('../js/recover.js');
const U = await import('../js/recover-ui.js');
const E = await import('../js/engine.js');
const B = await import('../js/backup.js');
const N = await import('../js/nav.js');
const T = await import('../js/tryfirst.js');

const raw = readFileSync(new URL('../data/recover.json', import.meta.url), 'utf8');
const data = JSON.parse(raw);
const okFetch = async () => ({ ok: true, json: async () => JSON.parse(raw) });
const ctx = { topics: [], exercises: [], byId: () => null, show: dom.show, fetchFn: okFetch };
const text = () => dom.root.textContent;
const reset = (on = false) => {
  dom.store.clear();
  store.resetCache();
  R.resetRecoverCache();
  if (on) dom.store.set(T.KEY, JSON.stringify({ v: 1, on: true }));
};
const stepBtns = () => dom.root.all((n) => n.tagName === 'BUTTON' && n.className.includes('drill-opt'));
const enabled = (label) => dom.root.all((n) => n.tagName === 'BUTTON' && !n.disabled && n.textContent.trim() === label);
const textInputs = () => dom.root.all((n) => n.tagName === 'INPUT' && n.getAttribute('type') === 'text' && !n.disabled);
const fill = (values) => { const ins = textInputs(); values.forEach((v, i) => { ins[i].value = v; }); };

test('data: 24 valid exercises, 12 + 12, unique ids, 5-7 steps, early error', () => {
  assert.equal(data.length, 24);
  assert.ok(data.every(R.validItem));
  assert.equal(data.filter((x) => x.subject === 'math').length, 12);
  assert.equal(data.filter((x) => x.subject === 'physics').length, 12);
  assert.equal(new Set(data.map((x) => x.id)).size, 24);
  assert.ok(data.every((x) => x.steps.length >= 5 && x.steps.length <= 7 && x.firstWrong <= 2));
  assert.ok(data.every((x) => x.finish.length >= 2 && x.finish.some((p) => p.ifError)));
});

test('validItem rejects broken records', () => {
  const ok = data[0];
  assert.equal(R.validItem(ok), true);
  assert.equal(R.validItem({ ...ok, firstWrong: 99 }), false);
  assert.equal(R.validItem({ ...ok, id: 'x-1' }), false);
  assert.equal(R.validItem({ ...ok, hints: ['one'] }), false);
  assert.equal(R.validItem({ ...ok, finish: [ok.finish[0]] }), false);
  assert.equal(R.validItem({ ...ok, fix: { ask: 'x', answer: { kind: 'nope' } } }), false);
  assert.equal(R.validItem({ ...ok, finish: [ok.finish[0], { ...ok.finish[1], ifError: { kind: 'set', values: ['1'] } }] }), false, 'ifError must have the same kind');
  assert.equal(R.validItem(null), false);
});

test('gradeAnswer: correct / from-error / wrong / unreadable', () => {
  const part = data[0].finish[0]; // set {3,4}, error gives {4}
  assert.deepEqual(R.gradeAnswer(part, { rows: ['4', '3'] }), { ok: true, result: 'correct' });
  assert.deepEqual(R.gradeAnswer(part, { rows: ['4', ''] }), { ok: true, result: 'from-error' });
  assert.deepEqual(R.gradeAnswer(part, { rows: ['5', '3'] }), { ok: true, result: 'wrong' });
  assert.equal(R.gradeAnswer(part, { rows: ['abc', ''] }).ok, false);
  const num = data[0].fix;
  assert.equal(R.gradeAnswer(num, { rows: ['3'] }).result, 'correct');
  assert.equal(R.gradeAnswer(num, { rows: ['x'] }).ok, false);
  const interval = data[1].finish[0];
  assert.equal(R.gradeAnswer(interval, { rows: [{ lc: false, lo: '-3', hi: '3', hc: true }] }).result, 'correct');
  assert.equal(R.gradeAnswer(interval, { rows: [{ lc: true, lo: '3', hi: 'inf', hc: false }] }).result, 'from-error');
});

test('credit: points, outcome and summary lines', () => {
  const full = { found: true, fixed: true, finished: 3, total: 3, hints: 0, wrongs: 0 };
  assert.equal(R.pointsOf(full), 3);
  assert.equal(R.outcomeOf(full), 'alone');
  assert.equal(R.outcomeOf({ ...full, hints: 1 }), 'hinted');
  assert.equal(R.outcomeOf({ ...full, wrongs: 2 }), 'hinted');
  assert.equal(R.outcomeOf({ ...full, found: false }), 'wrong');
  assert.equal(R.outcomeOf({ ...full, finished: 2 }), 'wrong');
  assert.ok(Math.abs(R.pointsOf({ found: true, fixed: false, finished: 1, total: 2 }) - 1.5) < 1e-9);
  assert.equal(R.pointsOf({ found: false, fixed: false, finished: 0, total: 3 }), 0);
  const lines = R.creditLines({ found: true, fixed: false, finished: 1, total: 3 });
  assert.deepEqual(lines.map((l) => l.done), [true, false, false]);
  assert.match(lines[2].label, /1 מתוך 3/);
});

test('saved results: sanitize, keep the best visit, survive garbage', () => {
  reset();
  assert.deepEqual(R.sanitizeSaved(null), { v: 1, items: {} });
  assert.deepEqual(R.sanitizeSaved({ items: { bad: { best: 2 }, 'rc-m-01': { best: 99, attempts: -4, found: 'y' } } }).items['rc-m-01'], { attempts: 0, best: 3, found: false, fixed: false, finished: 0, total: 0, ts: 0 });
  R.recordResult('rc-m-01', { found: true, fixed: false, finished: 0, total: 2 });
  R.recordResult('rc-m-01', { found: false, fixed: false, finished: 0, total: 2 });
  const it = R.loadSaved().items['rc-m-01'];
  assert.equal(it.attempts, 2);
  assert.equal(it.best, 1);
  assert.equal(it.found, true);
  dom.store.set(R.KEY, '{broken');
  assert.deepEqual(R.loadSaved(), { v: 1, items: {} });
});

test('engine, nav and backup know the new mode', () => {
  assert.equal(E.topicTitle('recover-math'), 'תקנו ותמשיכו: מתמטיקה');
  assert.equal(E.topicTitle('recover-physics'), 'תקנו ותמשיכו: פיזיקה');
  assert.equal(E.topicHref('recover-math'), '#/recover');
  assert.equal(E.itemHref('rc-p-03', 'recover-physics'), '#/recover/rc-p-03');
  assert.deepEqual(N.resolveRoute('#/recover/rc-m-01'), { name: 'recover', args: ['rc-m-01'] });
  assert.ok(R.KEY in B.KNOWN_KEYS);
  assert.ok(T.KEY in B.KNOWN_KEYS);
  assert.ok(Object.keys(E).length > 0);
});

test('offline: friendly error and a retry button', async () => {
  reset();
  await U.viewRecover({ ...ctx, fetchFn: async () => { throw new Error('offline'); } });
  assert.match(text(), /לא ניתן לטעון את התרגילים/);
  assert.ok(dom.root.byText('button', 'נסו שוב'));
});

test('list shows 24 links in two groups; unknown id falls back to the list', async () => {
  reset();
  await U.viewRecover(ctx);
  assert.equal(dom.root.all((n) => n.tagName === 'A' && (n.getAttribute('href') || '').startsWith('#/recover/')).length, 24);
  assert.match(text(), /מתמטיקה/);
  assert.match(text(), /פיזיקה/);
  await U.viewRecover(ctx, 'nope');
  assert.equal(dom.root.all((n) => n.tagName === 'A' && (n.getAttribute('href') || '').startsWith('#/recover/')).length, 24);
});

test('perfect run: find, correct, finish from the corrected value -> 3/3, recorded as alone under recover-math', async () => {
  reset();
  await U.viewRecover(ctx, 'rc-m-01');
  assert.equal(stepBtns().length, 5);
  stepBtns()[1].click(); // the first wrong step
  assert.match(text(), /מצאתם את הטעות בניסיון הראשון/);
  assert.match(text(), /שורש שאבד/);
  assert.equal(stepBtns().every((b) => b.disabled), true);
  assert.match(text(), /שלב 2: תקנו/);
  fill(['3']);
  enabled('בדיקה')[0].click();
  assert.match(text(), /השלב המתוקן/);
  assert.match(text(), /שלב 3: ממשיכים מהערך המתוקן/);
  fill(['3', '4']);
  enabled('בדיקה')[0].click();
  fill(['1']);
  enabled('בדיקה')[0].click();
  assert.match(text(), /3 מתוך 3 נקודות/);
  const rec = store.getAttempts().find((a) => a.exerciseId === 'rc-m-01');
  assert.equal(rec.topic, 'recover-math');
  assert.equal(rec.outcome, 'alone');
  assert.equal(R.loadSaved().items['rc-m-01'].best, 3);
});

test('carry-forward: an answer that follows the erroneous step is named, then the corrected one is accepted', async () => {
  reset();
  await U.viewRecover(ctx, 'rc-p-03');
  stepBtns()[0].click(); // step 1 is correct: not the error
  assert.match(text(), /הטעות הראשונה מאוחרת יותר/);
  stepBtns()[1].click(); // found, but not on the first try
  assert.match(text(), /בלי נקודה על האיתור/);
  fill(['40']);
  enabled('בדיקה')[0].click();
  fill(['8']); // zman te'ufa from the wrong chain
  enabled('בדיקה')[0].click();
  assert.match(text(), /ממשיכים מהשלב השגוי/);
  assert.equal(textInputs().length, 1, 'still on the same part');
  fill(['6']);
  enabled('בדיקה')[0].click();
  fill(['45']);
  enabled('בדיקה')[0].click();
  fill(['80']);
  enabled('בדיקה')[0].click();
  assert.match(text(), /2 מתוך 3 נקודות/);
  const rec = store.getAttempts().find((a) => a.exerciseId === 'rc-p-03');
  assert.equal(rec.topic, 'recover-physics');
  assert.equal(rec.outcome, 'wrong', 'the step was not found first try');
  assert.equal(R.loadSaved().items['rc-p-03'].finished, 3);
});

test('giving up: show-step, show-value and show-solution still finish with partial credit', async () => {
  reset();
  await U.viewRecover(ctx, 'rc-m-02');
  stepBtns()[4].click();
  assert.match(text(), /מוקדמת יותר/);
  enabled('הציגו לי את השלב')[0].click();
  enabled('הציגו את הערך')[0].click();
  enabled('הציגו פתרון')[0].click();
  enabled('הציגו פתרון')[0].click();
  assert.match(text(), /0 מתוך 3 נקודות/);
  const rec = store.getAttempts().find((a) => a.exerciseId === 'rc-m-02');
  assert.equal(rec.outcome, 'wrong');
});

test('try-first: the hint is hidden until the first tap, and the attempt time is logged', async () => {
  reset(true);
  await U.viewRecover(ctx, 'rc-p-01');
  const hint = dom.root.byText('button', 'רמז');
  assert.equal(hint.hidden, true);
  assert.match(text(), /קודם כותבים על הנייר/);
  dom.clock.now += 9000;
  stepBtns()[1].click();
  assert.equal(hint.hidden, false);
  fill(['-10']);
  enabled('בדיקה')[0].click();
  for (const v of ['15', '-10', '20']) { fill([v]); enabled('בדיקה')[0].click(); }
  const rec = store.getAttempts().find((a) => a.exerciseId === 'rc-p-01');
  assert.equal(rec.timeToFirstAttempt, 9);
  assert.equal(rec.outcome, 'alone');
});

test('cleanup', () => dom.restore());

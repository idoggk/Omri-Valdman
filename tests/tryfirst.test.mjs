import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './fake-dom.mjs';

const dom = installFakeDom();
const T = await import('../js/tryfirst.js');
const TU = await import('../js/tryfirst-ui.js');
const S = await import('../js/srs.js');
const B = await import('../js/backup.js');
const store = await import('../js/store.js');
const MH = await import('../js/mathhard-ui.js');
const MHL = await import('../js/mathhard.js');
const MP = await import('../js/multipart.js');
const LG = await import('../js/logs-ui.js');
const EV = await import('../js/exercise-view.js');
const P = await import('../js/practice-ui.js');

const fileFetch = async (u) => {
  const txt = readFileSync(new URL(`../${u}`, import.meta.url), 'utf8');
  return { ok: true, json: async () => JSON.parse(txt) };
};
const ctx = { topics: [], exercises: [], byId: () => null, show: dom.show, fetchFn: fileFetch };
const text = () => dom.root.textContent;
const btn = (label) => dom.root.byText('button', label);
const textInputs = () => dom.root.all((n) => n.tagName === 'INPUT' && n.getAttribute('type') === 'text');
const reset = (on) => {
  dom.store.clear();
  store.resetCache();
  dom.clock.now = 1_000_000;
  if (on) dom.store.set(T.KEY, JSON.stringify({ v: 1, on: true }));
};

/* ---------- state machine ---------- */
test('gate: locked only while on, before an attempt, inside the 60 s wait', () => {
  let now = 0;
  const g = T.createGate({ on: true, now: () => now });
  assert.equal(g.locked(), true);
  assert.equal(g.remainingMs(), 60000);
  now = 59999;
  assert.equal(g.locked(), true);
  now = 60000;
  assert.equal(g.locked(), false);
  assert.equal(g.timeToFirstAttempt(), undefined);
  const h = T.createGate({ on: true, now: () => now });
  now += 5400;
  h.attempt();
  assert.equal(h.locked(), false);
  assert.equal(h.timeToFirstAttempt(), 5);
  now += 30000;
  h.attempt(); // later attempts change nothing
  assert.equal(h.timeToFirstAttempt(), 5);
  const off = T.createGate({ on: false, now: () => now });
  assert.equal(off.locked(), false);
  off.setOn(true);
  assert.equal(off.locked(), true);
  off.attempt();
  assert.equal(off.locked(), false);
  off.setOn(false);
  off.setOn(true);
  assert.equal(off.locked(), false, 'turning the mode on again does not re-lock after an attempt');
});

test('gate measures the first attempt even when the mode is off; attemptExtra is empty without one', () => {
  let now = 0;
  const g = T.createGate({ on: false, now: () => now });
  assert.deepEqual(T.attemptExtra(g), {});
  now = 12400;
  g.attempt();
  assert.deepEqual(T.attemptExtra(g), { timeToFirstAttempt: 12 });
  assert.deepEqual(T.attemptExtra(null), {});
});

test('saved toggle: defaults off, survives garbage, round-trips', () => {
  dom.store.clear();
  assert.equal(T.loadOn(), false);
  dom.store.set(T.KEY, '{broken');
  assert.equal(T.loadOn(), false);
  dom.store.set(T.KEY, JSON.stringify({ on: 'yes' }));
  assert.equal(T.loadOn(), false);
  T.saveOn(true);
  assert.equal(T.loadOn(), true);
  T.saveOn(false);
  assert.equal(T.loadOn(), false);
});

test('toggle key is in the backup list and the backup round-trips it', () => {
  assert.ok(T.KEY in B.KNOWN_KEYS);
  dom.store.clear();
  T.saveOn(true);
  const code = B.buildBackup(globalThis.localStorage, 5);
  assert.ok(JSON.parse(code).data[T.KEY]);
});

/* ---------- attempt record ---------- */
test('timeToFirstAttempt is optional, validated and backward compatible', () => {
  const base = { exerciseId: 'x1', ts: 5, outcome: 'alone', hintsUsed: 0, seconds: 40 };
  assert.equal('timeToFirstAttempt' in S.makeAttempt(base), false);
  assert.equal(S.makeAttempt({ ...base, timeToFirstAttempt: 12.4 }).timeToFirstAttempt, 12);
  assert.equal('timeToFirstAttempt' in S.makeAttempt({ ...base, timeToFirstAttempt: -3 }), false);
  assert.equal('timeToFirstAttempt' in S.makeAttempt({ ...base, timeToFirstAttempt: 'soon' }), false);
  assert.equal('timeToFirstAttempt' in S.makeAttempt({ ...base, timeToFirstAttempt: NaN }), false);
  // an old log without the field still loads and a new record survives a clean round-trip
  const log = S.cleanLog(JSON.parse(JSON.stringify([base, { ...base, exerciseId: 'x2', timeToFirstAttempt: 30 }])));
  assert.equal(log.length, 2);
  assert.equal(log[1].timeToFirstAttempt, 30);
});

test('median and stats over the log', () => {
  assert.equal(T.median([]), null);
  assert.equal(T.median([5]), 5);
  assert.equal(T.median([9, 1, 5]), 5);
  assert.equal(T.median([4, 10]), 7);
  assert.deepEqual(T.firstAttemptStats([{}, { timeToFirstAttempt: 10 }, { timeToFirstAttempt: 30 }, { timeToFirstAttempt: 'x' }, null]), { count: 2, median: 20 });
  assert.deepEqual(T.firstAttemptStats(undefined), { count: 0, median: null });
  assert.equal(T.formatSeconds(45), '45 שניות');
  assert.equal(T.formatSeconds(60), 'דקה');
  assert.equal(T.formatSeconds(125), '2 דקות ו־5 שניות');
});

test('progress screen shows the median time to first attempt (and an empty state)', () => {
  reset(false);
  P.viewProgress({ ...ctx, topics: [] });
  assert.match(text(), /זמן עד הניסיון הראשון/);
  assert.match(text(), /עדיין אין נתונים/);
  store.recordAttempt({ exerciseId: 'a1', topic: 'logs', outcome: 'alone', hintsUsed: 0, seconds: 50, timeToFirstAttempt: 20 });
  store.recordAttempt({ exerciseId: 'a2', topic: 'logs', outcome: 'alone', hintsUsed: 0, seconds: 50, timeToFirstAttempt: 100 });
  store.recordAttempt({ exerciseId: 'a3', topic: 'logs', outcome: 'alone', hintsUsed: 0, seconds: 50 });
  P.viewProgress({ ...ctx, topics: [] });
  assert.match(text(), /חציון: דקה ו־0|חציון: דקה/);
  assert.match(text(), /מתוך 2 תרגילים/);
});

/* ---------- ui controller ---------- */
test('controller hides the given nodes while locked and shows them after an attempt', () => {
  reset(true);
  const a = dom.root; // any element works as a hideable node
  void a;
  const { FakeElement } = { FakeElement: dom.root.constructor };
  const hint = new FakeElement('button');
  const box = new FakeElement('div');
  const tf = TU.tryFirst([hint, box]);
  assert.equal(hint.hidden, true);
  assert.equal(box.hidden, true);
  tf.attempt();
  assert.equal(hint.hidden, false);
  assert.equal(box.hidden, false);
  const late = new FakeElement('button');
  tf.add(late);
  assert.equal(late.hidden, false, 'a node added after the attempt is not hidden');
});

test('toggling the checkbox persists and locks / unlocks the nodes', () => {
  reset(false);
  const FakeElement = dom.root.constructor;
  const hint = new FakeElement('button');
  const tf = TU.tryFirst([hint]);
  assert.equal(hint.hidden, false);
  const toggle = tf.bar.all((n) => n.tagName === 'BUTTON')[0];
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');
  toggle.click();
  assert.equal(hint.hidden, true);
  assert.equal(T.loadOn(), true);
  assert.equal(toggle.getAttribute('aria-pressed'), 'true');
  assert.match(toggle.textContent, /דלוק/);
  toggle.click();
  assert.equal(hint.hidden, false);
  assert.equal(T.loadOn(), false);
  assert.match(toggle.textContent, /כבוי/);
});

test('the 60 s wait unlocks on the next refresh', () => {
  reset(true);
  const FakeElement = dom.root.constructor;
  const hint = new FakeElement('button');
  const tf = TU.tryFirst([hint]);
  assert.equal(hint.hidden, true);
  dom.clock.now += 59000;
  tf.refresh();
  assert.equal(hint.hidden, true);
  dom.clock.now += 1500;
  tf.refresh();
  assert.equal(hint.hidden, false);
  assert.equal(tf.gate.timeToFirstAttempt(), undefined, 'waiting is not an attempt');
});

/* ---------- the hard modes ---------- */
test('mathhard: hints, domain, solution and method card are locked until the first typed value', async () => {
  reset(true);
  MHL.resetMathHardCache();
  await MH.viewMathHard(ctx, 'mh-rad-1');
  const hint = btn('רמז 1');
  assert.ok(hint, 'exercise renders');
  assert.equal(hint.hidden, true);
  assert.equal(btn('הצגת פתרון מלא').hidden, true);
  assert.match(text(), /קודם כותבים על הנייר/);
  const input = textInputs()[0];
  input.value = '3';
  const widgetEl = input.parent.parent.parent; // input -> row -> rowsBox -> widget element
  widgetEl.dispatch('input', { target: input });
  assert.equal(hint.hidden, false);
  assert.equal(btn('הצגת פתרון מלא').hidden, false);
  // the first-attempt time is recorded on the attempt
  btn('הצגת פתרון מלא').click();
  const rec = store.getAttempts().find((a) => a.exerciseId === 'mh-rad-1');
  assert.ok(rec);
  assert.equal(rec.timeToFirstAttempt, 0);
});

test('mathhard with the mode off: nothing is hidden and the time is still logged', async () => {
  reset(false);
  MHL.resetMathHardCache();
  await MH.viewMathHard(ctx, 'mh-rad-1');
  assert.equal(btn('רמז 1').hidden, false);
  dom.clock.now += 7400;
  textInputs()[0].value = '3';
  btn('בדיקה').click();
  btn('הצגת פתרון מלא').click();
  const rec = store.getAttempts().find((a) => a.exerciseId === 'mh-rad-1');
  assert.equal(rec.timeToFirstAttempt, 7);
});

test('mathhard: pressing check counts as the first attempt even with an empty answer', async () => {
  reset(true);
  MHL.resetMathHardCache();
  await MH.viewMathHard(ctx, 'mh-rad-1');
  assert.equal(btn('רמז 1').hidden, true);
  btn('בדיקה').click();
  assert.equal(btn('רמז 1').hidden, false);
});

test('multipart: the show-solution shortcut of every part stays locked until an attempt', async () => {
  reset(true);
  MP.resetMultipartCache();
  await MP.viewMultipart(ctx, 'mp-1');
  const skip = btn('אין לי תשובה');
  assert.ok(skip);
  assert.equal(skip.hidden, true);
  textInputs()[0].value = '3';
  btn('בדיקה').click();
  const skips = dom.root.all((n) => n.tagName === 'BUTTON' && n.textContent.includes('אין לי תשובה'));
  assert.ok(skips.length >= 2, 'the next part was revealed');
  assert.ok(skips.every((b) => b.hidden === false), 'unlocked after the first attempt');
});

test('logs: hints locked until the first attempt', async () => {
  reset(true);
  const L = await import('../js/logs.js');
  L.resetLogsCache && L.resetLogsCache();
  const data = JSON.parse(readFileSync(new URL('../data/logs-ex-1.json', import.meta.url), 'utf8'));
  const id = (Array.isArray(data) ? data : data.exercises)[0].id;
  await LG.viewLogsRoute(ctx, 'ex', id);
  const hint = btn('רמז 1');
  assert.ok(hint);
  assert.equal(hint.hidden, true);
  btn('בדיקה').click();
  assert.equal(btn('רמז 1').hidden, false);
});

test('ladder exercise view: help area hidden when o.tryFirst is on, and attempt time is passed to the sink', () => {
  reset(true);
  const ex = {
    id: 'lad-t-1', topic: 'math-3', level: 1, title: 'בדיקה', statement: 'x=3', tips: ['רמז א'], solution: ['שלב'], inputs: [{ label: 'x', answer: 3 }],
  };
  const seen = [];
  const sink = {
    attempt: (a) => { seen.push(a); return null; }, setReason() {}, tips: () => 0, setTips() {}, reveal() {}, correct() {}, outcome: () => null, guided() {},
  };
  const o = { ctx: { show: dom.show, topicOf: () => ({ title: 't' }) }, sink, crumbs: null, nav: null, tryFirst: true };
  EV.renderExercise(ex, o);
  const tip = btn('רמז 1');
  assert.ok(tip);
  let hidden = false;
  for (let n = tip; n; n = n.parent) if (n.hidden === true) hidden = true;
  assert.equal(hidden, true, 'the help area is hidden before an attempt');
  textInputs()[0].value = '5';
  dom.clock.now += 3000;
  dom.root.all(() => true).forEach((n) => { // the minimal fake DOM has no classList.add / remove
    n.classList.remove = (c) => n.classList.toggle(c, false);
    n.classList.add = (c) => n.classList.toggle(c, true);
  });
  dom.root.all((n) => n.tagName === 'FORM')[0].dispatch('submit');
  hidden = false;
  for (let n = tip; n; n = n.parent) if (n.hidden === true) hidden = true;
  assert.equal(hidden, false);
  assert.equal(seen.at(-1).timeToFirstAttempt, 3, 'the submit 3 s after opening is the first attempt');
  // without the option nothing is wrapped or hidden
  reset(true);
  EV.renderExercise(ex, { ...o, tryFirst: false });
  assert.equal(dom.root.all((n) => n.hidden === true).length, 0);
});

test('cleanup', () => dom.restore());

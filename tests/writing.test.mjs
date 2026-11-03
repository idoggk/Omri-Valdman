import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './fake-dom.mjs';
import { validate, loadWriting, evaluate, parseDim } from '../tools/verify-writing.mjs';

const dom = installFakeDom();
const W = await import('../js/writing.js');
const UI = await import('../js/writing-ui.js');
const S = await import('../js/srs.js');
const F = await import('../js/feedback.js');
const store = await import('../js/store.js');
const N = await import('../js/nav.js');
const E = await import('../js/engine.js');
const B = await import('../js/backup.js');

const raw = readFileSync(new URL('../data/writing.json', import.meta.url), 'utf8');
const data = JSON.parse(raw);
const task = data[0];
const fake = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } }; };
const ids = (t, ...lines) => t.rubric.filter((r) => lines.includes(r.id)).map((r) => r.id);

/* ---------- data and verifier ---------- */
test('shipped tasks: 8 physics + 8 math, valid shape, five stages in order, passes the independent verifier', () => {
  assert.equal(data.length, 16);
  assert.ok(data.every(W.validTask));
  assert.equal(data.filter((t) => t.subject === 'physics').length, 8);
  for (const t of data) assert.deepEqual(t.model.map((m) => m.stage), W.STAGES.map((s) => s.id), t.id);
  const { errors, stats } = validate(loadWriting());
  assert.deepEqual(errors, []);
  assert.equal(stats.physics, 8);
  assert.equal(stats.math, 8);
});

const find = (list, id) => list.find((e) => e.id === id);
const inject = (id, mutate) => { const copy = loadWriting(); mutate(find(copy, id)); return validate(copy).errors.filter((e) => e.startsWith(`${id}:`)); };

test('verifier: a wrong number in a model fact is caught', () => {
  assert.ok(inject('wr-p-1', (t) => { t.model[3].facts[1].v = 41; }).some((e) => /evaluates to 40/.test(e)));
});
test('verifier: a unit error is caught (speed labelled as a length, or adding unlike units)', () => {
  assert.ok(inject('wr-p-1', (t) => { t.model[3].facts[1].d = 'm'; }).some((e) => /unit/.test(e)));
  assert.ok(inject('wr-p-4', (t) => { t.model[3].facts[0].e = 'a*t+x1'; }).length > 0);
});
test('verifier: a number in the model text that is neither given nor computed is caught', () => {
  assert.ok(inject('wr-p-2', (t) => { t.model[3].text = t.model[3].text.replace('45 מ', '46 מ'); }).some((e) => /number 46/.test(e)));
});
test('verifier: a conclusion without the unit, or a rubric with the wrong total shape, is caught', () => {
  assert.ok(inject('wr-p-1', (t) => { t.model[4].text = 'האבן נופלת 4 וגם 40.'; }).some((e) => /conclusion does not state/.test(e)));
  assert.ok(inject('wr-p-1', (t) => { t.rubric.pop(); t.rubric.pop(); }).length > 0);
});
test('verifier: an independent recomputation disagreeing with the stored answer is caught', () => {
  const errs = inject('wr-m-7', (t) => { for (const m of t.model) for (const f of m.facts) if (f.n === 'S') f.v = 850; });
  assert.ok(errs.length > 0);
});
test('verifier: g must be 10 in physics tasks', () => {
  assert.ok(inject('wr-p-3', (t) => { t.vars.g.v = 9.8; }).some((e) => /g must be 10/.test(e)));
});

test('expression engine tracks dimensions', () => {
  const env = { g: { v: 10, d: parseDim('m/s^2') }, t: { v: 4, d: parseDim('s') } };
  const r = evaluate('0.5*g*t^2', env);
  assert.equal(r.v, 80);
  assert.deepEqual(r.d, { m: 1 });
  assert.deepEqual(evaluate('sqrt(2*h/g)', { g: env.g, h: { v: 80, d: parseDim('m') } }).d, { s: 1 });
  assert.throws(() => evaluate('g+t', env), /different units/);
  assert.throws(() => evaluate('h*2', env), /unknown name/);
});

/* ---------- scoring ---------- */
test('score sums the points of the marked lines', () => {
  const sc = W.scoreOf(task, ids(task, 'g', 'e', 'ct'));
  assert.equal(sc.total, 7);
  assert.equal(sc.points, 4);
  assert.equal(sc.fraction, 0.57);
  assert.deepEqual(sc.missed, ['s', 'cv', 'c']);
  assert.equal(W.scoreOf(task, []).points, 0);
  assert.equal(W.scoreOf(task, task.rubric.map((r) => r.id)).fraction, 1);
  assert.equal(W.scoreOf(task, ['nope', 'g']).points, 1, 'unknown ids are ignored');
});

test('grader estimate: a missed carry-forward line earns half after an earlier miss, otherwise nothing extra', () => {
  // t wrong (ct missed) but v computed from it (cv missed here): half of the cv point
  const miss = W.graderEstimate(task, ids(task, 'g', 'e', 's', 'c'));
  assert.equal(miss.extra, 0.5);
  assert.equal(miss.points, 5.5);
  assert.ok(miss.note.length > 10);
  // cv missed with nothing missed before it: no extra
  const lone = W.graderEstimate(task, ids(task, 'g', 'e', 's', 'ct', 'c'));
  assert.equal(lone.extra, 0);
  assert.equal(lone.points, 6);
  // everything marked: full
  assert.equal(W.graderEstimate(task, task.rubric.map((r) => r.id)).points, 7);
  assert.match(W.UNOFFICIAL, /לא רשמית/);
});

test('outcome is never "alone": writing is not an independent solve', () => {
  assert.equal(W.outcomeOf(1), 'hinted');
  assert.equal(W.outcomeOf(0.6), 'hinted');
  assert.equal(W.outcomeOf(0.59), 'wrong');
  assert.equal(W.outcomeOf(0), 'wrong');
});

/* ---------- persistence and statistics ---------- */
test('results persist per task and per stage; the weakest stage needs 2 tasks and a miss', () => {
  const s = fake();
  assert.deepEqual(W.loadSaved(s), { v: 1, items: {}, stages: {} });
  W.recordResult(data[0], ids(data[0], 'g', 'e', 's', 'ct', 'cv'), s, 1000); // misses the conclusion only
  assert.equal(W.weakestStage(W.loadSaved(s)), null, 'one task is not enough');
  W.recordResult(data[1], ids(data[1], 'g', 'e', 's', 'cH', 'cT'), s, 2000); // misses the conclusion again
  const saved = W.loadSaved(s);
  assert.equal(saved.items['wr-p-1'].best, 0.86);
  assert.equal(saved.items['wr-p-1'].attempts, 1);
  assert.deepEqual(saved.items['wr-p-1'].missed, ['c']);
  assert.deepEqual(saved.stages.conclusion, { missed: 2, total: 2 });
  assert.equal(saved.stages.equations.missed, 0);
  const w = W.weakestStage(saved);
  assert.equal(w.stage, 'conclusion');
  assert.equal(w.rate, 1);
  assert.equal(W.missedStages(saved)[0].stage, 'conclusion');
  // redoing a task keeps the best and counts attempts
  W.recordResult(data[0], [], s, 3000);
  const again = W.loadSaved(s).items['wr-p-1'];
  assert.equal(again.attempts, 2);
  assert.equal(again.best, 0.86);
  assert.equal(again.last, 0);
  assert.deepEqual(W.writingSummary(W.loadSaved(s)).weakStage, 'conclusion');
});

test('saved data: malformed storage reads as empty and bad rows are dropped', () => {
  const s = fake();
  s.m.set(W.KEY, 'nope');
  assert.deepEqual(W.loadSaved(s), { v: 1, items: {}, stages: {} });
  const clean = W.sanitizeSaved({ items: { 'wr-p-1': { attempts: 2, best: 7, last: -1, missed: ['c', 5] }, bogus: { attempts: 1 } }, stages: { givens: { missed: 1, total: 2 }, other: { missed: 1 } } });
  assert.deepEqual(Object.keys(clean.items), ['wr-p-1']);
  assert.equal(clean.items['wr-p-1'].best, 1);
  assert.equal(clean.items['wr-p-1'].last, 0);
  assert.deepEqual(clean.items['wr-p-1'].missed, ['c']);
  assert.deepEqual(Object.keys(clean.stages), ['givens']);
});

test('the writing key is part of the backup', () => {
  assert.ok(Object.hasOwn(B.KNOWN_KEYS, W.KEY));
});

/* ---------- attempt log, mastery and ceiling data ---------- */
test('a writing attempt carries its score, is kept out of topic stats, weak topics and the review schedule', () => {
  const a = S.makeAttempt({ exerciseId: 'wr-p-1', ts: 5, outcome: 'hinted', hintsUsed: 0, seconds: 300, topic: 'writing', score: 0.71234 });
  assert.equal(a.score, 0.71);
  assert.equal(S.makeAttempt({ exerciseId: 'x', ts: 1, outcome: 'wrong', score: 4 }).score, undefined);
  const log = [a, S.makeAttempt({ exerciseId: 'math-3-001', ts: 6, outcome: 'alone', topic: 'math-3' })];
  const ex = [{ id: 'math-3-001', topic: 'math-3', level: 1 }];
  assert.deepEqual(S.withVirtual(ex, log).map((e) => e.id), ['math-3-001']);
  assert.ok(!S.dueReviews(log, 10 * S.DAY_MS).includes('wr-p-1'));
  assert.ok(!S.weakTopics(log, S.withVirtual(ex, log)).some((t) => t.topic === 'writing'));
  assert.ok(S.isReservedTopic('writing') && S.isReservedTopic('transfer-math') && !S.isReservedTopic('math-3'));
});

test('the feedback export reports the writing score apart from ceiling signals', () => {
  const log = [
    S.makeAttempt({ exerciseId: 'wr-p-1', ts: 5, outcome: 'wrong', topic: 'writing', score: 0.4 }),
    S.makeAttempt({ exerciseId: 'wr-p-1', ts: 6, outcome: 'hinted', topic: 'writing', score: 0.8 }),
    S.makeAttempt({ exerciseId: 'wr-p-2', ts: 7, outcome: 'hinted', topic: 'writing', score: 0.6 }),
  ];
  const sum = F.buildSummary([], log, []);
  assert.deepEqual(sum.writing, { tasks: 2, attempts: 3, avgScore: 0.7 });
  const ceiling = sum.ceiling.find((c) => c.topic === 'writing');
  assert.ok(!ceiling || (!ceiling.escalate && !ceiling.contentCeilingReached), 'writing never signals mastery');
  assert.equal(F.buildSummary([], [], []).writing, null);
});

test('routes, topic title and reopen link', () => {
  assert.equal(N.resolveRoute('#/writing').name, 'writing');
  assert.deepEqual(N.resolveRoute('#/writing/wr-p-1').args, ['wr-p-1']);
  assert.equal(E.topicTitle('writing'), 'כתיבת פתרון (ניקוד חלקי)');
  assert.equal(E.topicHref('writing'), '#/writing');
  assert.equal(E.itemHref('wr-p-1', 'writing'), '#/writing/wr-p-1');
});

/* ---------- screens ---------- */
const okFetch = async () => ({ ok: true, json: async () => JSON.parse(raw) });
const ctx = { topics: [], exercises: [], byId: () => null, show: dom.show, fetchFn: okFetch };
const text = () => dom.root.textContent;
const buttons = (label) => dom.root.all((n) => n.tagName === 'BUTTON' && n.textContent.trim() === label);

test('screen: list shows 16 tasks; a task shows the statement, then model + checklist; saving records topic writing with a score', async () => {
  dom.store.clear(); store.resetCache(); W.resetWritingCache();
  await UI.viewWriting(ctx);
  assert.equal(dom.root.all((n) => n.tagName === 'A' && (n.getAttribute('href') || '').startsWith('#/writing/wr-')).length, 16);
  await UI.viewWriting(ctx, 'wr-p-1');
  assert.match(text(), /נפילה חופשית/);
  assert.doesNotMatch(text(), /פתרון מודל\S*רשימת בדיקה/, 'the model solution is hidden until he finishes writing');
  assert.equal(buttons('שמירת התוצאה').length, 0);
  buttons('סיימתי לכתוב, הציגו פתרון מודל')[0].click();
  assert.match(text(), /פתרון מודל/);
  assert.match(text(), /הניקוד שסימנתם: 0 מתוך 7/);
  const boxes = dom.root.all((n) => n.tagName === 'INPUT' && n.getAttribute('type') === 'checkbox');
  assert.equal(boxes.length, 6);
  for (const b of boxes.slice(0, 4)) { b.checked = true; b.dispatch('change'); }
  assert.match(text(), /הניקוד שסימנתם: 5 מתוך 7/);
  assert.match(text(), /לא רשמי/);
  buttons('שמירת התוצאה')[0].click();
  const log = JSON.parse(dom.store.get('omri-study-attempts-v1'));
  assert.equal(log.length, 1);
  assert.equal(log[0].topic, 'writing');
  assert.equal(log[0].exerciseId, 'wr-p-1');
  assert.equal(log[0].score, 0.71);
  assert.equal(log[0].outcome, 'hinted');
  assert.notEqual(log[0].outcome, 'alone');
  assert.equal(JSON.parse(dom.store.get(W.KEY)).items['wr-p-1'].attempts, 1);
  assert.match(text(), /נשמר/);
});

test('screen: a load failure shows a retry button', async () => {
  W.resetWritingCache();
  await UI.viewWriting({ ...ctx, fetchFn: async () => ({ ok: false }) });
  assert.match(text(), /לא ניתן לטעון/);
  assert.equal(buttons('נסו שוב').length, 1);
  W.resetWritingCache();
});

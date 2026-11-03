import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../js/replay.js';

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const T0 = Date.UTC(2026, 10, 4, 9, 0, 0);
const S = (s) => T0 + s * 1000;
const QS = [
  { key: 'q1', label: 'שאלה 1', marks: 25, earned: 20 },
  { key: 'q2', label: 'שאלה 2', marks: 12, earned: 3 },
  { key: 'q3', label: 'שאלה 3', marks: 63, earned: 40 },
];

function mock() {
  const log = R.newLog('booklet', 'bk-math-3-1', T0);
  R.logEvent(log, 'open', 'q1', S(0));
  R.logEvent(log, 'answer', 'q1', S(600));
  R.logEvent(log, 'open', 'q2', S(600));
  R.logEvent(log, 'skip', 'q2', S(1800)); // 20 minutes on the 12-mark question
  R.logEvent(log, 'open', 'q3', S(1800));
  R.logEvent(log, 'open', 'q2', S(3000)); // returns
  R.logEvent(log, 'answer', 'q2', S(3300));
  R.logEvent(log, 'finish', '', S(3600));
  return log;
}

test('events: first open, revisit, no double open, nothing after finish', () => {
  const log = mock();
  assert.deepEqual(log.events.map((e) => e.type), ['open', 'answer', 'open', 'skip', 'open', 'revisit', 'answer', 'finish']);
  assert.equal(R.logEvent(log, 'open', 'q1', S(4000)), null); // finished
  const l2 = R.newLog('transfer', 't', T0);
  R.logEvent(l2, 'open', 'a', S(0));
  assert.equal(R.logEvent(l2, 'open', 'a', S(5)), null); // already on it
  assert.equal(R.logEvent(l2, 'bogus', 'a', S(6)), null);
});

test('timeline: per-question seconds add up to the session time and marks add up to the paper', () => {
  const log = mock();
  const tl = R.buildTimeline(log, QS);
  assert.equal(tl.seconds, 3600);
  assert.equal(tl.perQuestion.reduce((s, r) => s + r.seconds, 0), tl.seconds);
  assert.equal(tl.perQuestion.reduce((s, r) => s + r.marks, 0), 100);
  assert.deepEqual(tl.perQuestion.map((r) => r.seconds), [600, 1800, 1200]);
  assert.deepEqual(tl.order, ['q1', 'q2', 'q3']);
  const q2 = tl.perQuestion[1];
  assert.ok(q2.skipped === true && q2.returned === true && q2.answered === true && q2.visits === 2);
});

test('an idle break longer than 20 minutes is not counted for any question', () => {
  const log = R.newLog('transfer', 'tr', T0);
  R.logEvent(log, 'open', 'q1', S(0));
  R.logEvent(log, 'answer', 'q1', S(300));
  R.logEvent(log, 'open', 'q2', S(300 + 3 * 3600)); // came back three hours later
  R.logEvent(log, 'answer', 'q2', S(300 + 3 * 3600 + 200));
  R.logEvent(log, 'finish', '', S(300 + 3 * 3600 + 200));
  const tl = R.buildTimeline(log, QS);
  assert.equal(tl.seconds, 500);
  assert.equal(tl.perQuestion.reduce((s, r) => s + r.seconds, 0), 500);
});

test('lessons: time share against marks, at most three, plain Hebrew', () => {
  const tl = R.buildTimeline(mock(), QS);
  assert.ok(tl.lessons.length >= 2 && tl.lessons.length <= 3);
  const first = tl.lessons[0];
  assert.match(first, /הקדשתם 50% מהזמן לשאלה 2, שהיא שווה 12 נקודות \(12% מהניקוד\)/); // 1800 s of 3600 s
  assert.match(tl.lessons[1], /דילגתם על שאלה 2 וחזרתם אליה/);
  assert.match(R.summaryLine(tl), /שאלה 1 ← שאלה 2 ← שאלה 3/);
});

test('lessons: a skip without a return and an unopened question', () => {
  const log = R.newLog('booklet', 'k', T0);
  R.logEvent(log, 'open', 'q1', S(0));
  R.logEvent(log, 'skip', 'q1', S(100));
  R.logEvent(log, 'open', 'q3', S(100));
  R.logEvent(log, 'finish', '', S(400));
  const tl = R.buildTimeline(log, QS);
  assert.match(tl.lessons.join(' '), /ולא חזרתם/);
  const log2 = R.newLog('booklet', 'k2', T0);
  R.logEvent(log2, 'open', 'q1', S(0));
  R.logEvent(log2, 'finish', '', S(100));
  assert.match(R.buildTimeline(log2, QS).lessons.join(' '), /לא פתחתם את שאלה 2, שאלה 3/);
});

test('storage: sanitize, save/load, cap, merge keeps the finished log', () => {
  const st = mem();
  const s = R.emptyState();
  s.logs['bk-1'] = mock();
  s.logs['bk-1'].key = 'bk-1';
  R.save(s, st);
  assert.equal(R.load(st).logs['bk-1'].events.length, 8);
  assert.deepEqual(R.sanitize('junk'), R.emptyState());
  const bad = R.sanitize({ logs: { x: { kind: 'booklet', events: [{ t: 1, type: 'nope', q: 'a' }, { t: 2, type: 'open', q: 'a' }] } } });
  assert.deepEqual(bad.logs.x.events, [{ t: 2, type: 'open', q: 'a' }]);
  const partial = { v: 1, logs: { 'bk-1': { ...mock(), finishedAt: null, events: mock().events.slice(0, 3) } } };
  const m = JSON.parse(R.mergeReplay(JSON.stringify(partial), JSON.stringify(s)));
  assert.equal(m.logs['bk-1'].finishedAt != null, true);
  assert.equal(R.mergeReplay('garbage', 'garbage'), JSON.stringify(R.emptyState()));
  for (let i = 0; i < 20; i++) s.logs[`k${i}`] = { ...R.newLog('transfer', `k${i}`, T0 + i), events: [] };
  assert.ok(Object.keys(R.sanitize(s).logs).length <= R.MAX_LOGS);
});

test('real booklet paper: marks of the replay questions add up to 100 and the earned marks to the saved total', async () => {
  const { readFileSync } = await import('node:fs');
  const B = await import('../js/booklet.js');
  const paper = B.buildPaper(JSON.parse(readFileSync(new URL('../data/booklet.json', import.meta.url), 'utf8')).questions, 'math', 4, 77);
  const parts = Object.fromEntries(B.paperParts(paper).map((p, i) => [p.key, i % 2 ? 0 : p.max]));
  const qs = paper.questions.map((q) => ({ key: q.id, label: `שאלה ${q.n}`, marks: q.total, earned: q.parts.reduce((s, p) => s + parts[`${q.id}.${p.id}`], 0) }));
  assert.equal(qs.reduce((s, q) => s + q.marks, 0), 100);
  assert.equal(qs.reduce((s, q) => s + q.earned, 0), B.checkScores(paper, parts).total);
  const log = R.newLog('booklet', paper.key, T0);
  qs.forEach((q, i) => { R.logEvent(log, 'open', q.key, S(i * 900)); R.logEvent(log, 'answer', q.key, S(i * 900 + 800)); });
  R.logEvent(log, 'finish', '', S(3600));
  const tl = R.buildTimeline(log, qs);
  assert.equal(tl.perQuestion.reduce((s, r) => s + r.seconds, 0), tl.seconds);
  assert.equal(tl.seconds, 3600);
});

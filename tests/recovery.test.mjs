import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './fake-dom.mjs';

installFakeDom();
const Rc = await import('../js/recovery.js');
const { verifyRecovery } = await import('../tools/verify-recovery.mjs');

const T0 = Date.UTC(2026, 10, 4, 9, 0, 0);
const S = (s) => T0 + s * 1000;
const hards = JSON.parse(readFileSync(new URL('../data/recovery-hard.json', import.meta.url), 'utf8'));
const ordinary = ['o1', 'o2', 'o3', 'o4', 'o5'].map((id) => ({ uid: id, id, kind: 'number', src: 'multipart', topic: 'multipart', budget: 240, answer: 1 }));
const REC = { id: 'rh-01', skipBudget: 180, stuck: 480 };
const ok = { correct: true, score: 1, total: 1 };
const no = { correct: false, score: 0, total: 1 };

function session(uids = ['o1', 'rh-01', 'o2', 'o3']) {
  return { id: 'r1', seed: 1, ts: T0, uids, hardUid: 'rh-01', results: {}, log: { key: 'k', kind: 'recovery', startedAt: T0, finishedAt: null, events: [] }, finishedAt: null };
}
const ev = (s, type, uid, sec) => Rc.event(s, type, uid, S(sec));
const res = (s, uid, g, sec) => Rc.recordResult(s, uid, g, 100, S(sec));

test('the 8 hard questions are verified independently and appear in no other pool', () => {
  assert.deepEqual(verifyRecovery(), []);
  assert.equal(hards.length, 8);
  assert.ok(hards.every((q) => Rc.validHard(q)));
});

test('makeSession: 4 questions, the hard one second, from the hard pool; cycles through the pool; avoids recent ordinary ids', () => {
  const s = Rc.makeSession(ordinary, hards, 5, {}, T0);
  assert.equal(s.uids.length, 4);
  assert.equal(s.uids[Rc.HARD_POS], s.hardUid);
  assert.ok(hards.some((q) => q.id === s.hardUid));
  assert.ok(!ordinary.some((o) => o.uid === s.hardUid));
  assert.deepEqual(Rc.makeSession(ordinary, hards, 5, {}, T0).uids, s.uids); // deterministic
  const used = [];
  let history = [];
  for (let i = 0; i < 8; i++) { const x = Rc.makeSession(ordinary, hards, 10 + i, { history }, T0 + i); used.push(x.hardUid); history = [...history, { hardUid: x.hardUid }]; }
  assert.equal(new Set(used).size, 8); // every hard question once before any repeats
  const recent = new Set(['o1', 'o2']);
  assert.ok(Rc.makeSession(ordinary, hards, 5, { recent }, T0).uids.filter((u) => recent.has(u)).length === 0);
  assert.equal(Rc.makeSession(ordinary.slice(0, 2), hards, 5, {}, T0), null);
});

test('strategy: skip within budget, finish the others, return - full marks for strategy', () => {
  const s = session();
  ev(s, 'open', 'o1', 0); res(s, 'o1', ok, 200); ev(s, 'answer', 'o1', 200);
  ev(s, 'open', 'rh-01', 200); ev(s, 'skip', 'rh-01', 350); // 150 s on the hard one
  ev(s, 'open', 'o2', 350); res(s, 'o2', ok, 600); ev(s, 'answer', 'o2', 600);
  ev(s, 'open', 'o3', 600); res(s, 'o3', ok, 800); ev(s, 'answer', 'o3', 800);
  ev(s, 'open', 'rh-01', 800); res(s, 'rh-01', no, 1000); ev(s, 'answer', 'rh-01', 1000);
  Rc.finishSession(s, S(1000));
  const sc = Rc.strategyScore(s, REC);
  assert.equal(sc.skippedInBudget, true);
  assert.equal(sc.returned, true);
  assert.equal(sc.before, 1); assert.equal(sc.after, 1);
  assert.equal(sc.recovered, 480 - 150);
  assert.equal(sc.points, 4);
  assert.match(sc.verdict, /מצוינת/);
  assert.ok(sc.lines.some((l) => /בתוך הזמן המומלץ/.test(l)) && sc.lines.some((l) => /חזרתם/.test(l)));
});

test('strategy: stuck on the hard question, late exit, no return, accuracy falls, over 20 minutes', () => {
  const s = session();
  ev(s, 'open', 'o1', 0); res(s, 'o1', ok, 120); ev(s, 'answer', 'o1', 120);
  ev(s, 'open', 'rh-01', 120); ev(s, 'open', 'o2', 720); // 600 s on the hard one, then moved on
  res(s, 'o2', no, 900); ev(s, 'answer', 'o2', 900);
  ev(s, 'open', 'o3', 900); res(s, 'o3', no, 1250); ev(s, 'answer', 'o3', 1250);
  Rc.finishSession(s, S(1300));
  const sc = Rc.strategyScore(s, REC);
  assert.equal(sc.skippedInBudget, false);
  assert.equal(sc.skippedLate, true);
  assert.equal(sc.returned, false);
  assert.equal(sc.recovered, 0);
  assert.equal(sc.after, 0);
  assert.equal(sc.inTime, false);
  assert.equal(sc.points, 0);
  assert.ok(sc.lines.some((l) => /מעבר לזמן המומלץ/.test(l)));
  assert.ok(sc.lines.some((l) => /לא חזרתם/.test(l)));
});

test('strategy: solving the hard question straight away is not penalised', () => {
  const s = session();
  ev(s, 'open', 'o1', 0); res(s, 'o1', ok, 100); ev(s, 'answer', 'o1', 100);
  ev(s, 'open', 'rh-01', 100); res(s, 'rh-01', ok, 260); ev(s, 'answer', 'rh-01', 260);
  ev(s, 'open', 'o2', 260); res(s, 'o2', ok, 400); ev(s, 'answer', 'o2', 400);
  ev(s, 'open', 'o3', 400); res(s, 'o3', ok, 500); ev(s, 'answer', 'o3', 500);
  Rc.finishSession(s, S(500));
  const sc = Rc.strategyScore(s, REC);
  assert.equal(sc.solvedFirst, true);
  assert.equal(sc.points, 4);
  assert.match(sc.lines[0], /פתרתם את השאלה הקשה נכון/);
});

test('first visit facts, unopened hard question, time left, one answer per question', () => {
  const s = session();
  assert.deepEqual(Rc.firstVisit(s.log, 'rh-01'), { opened: false, seconds: 0, left: null });
  ev(s, 'open', 'rh-01', 10); ev(s, 'skip', 'rh-01', 70);
  assert.deepEqual(Rc.firstVisit(s.log, 'rh-01'), { opened: true, seconds: 60, left: 'skip' });
  assert.equal(Rc.timeLeft(s, S(0)), 20 * 60000);
  assert.equal(Rc.timeLeft(s, S(1300)), 0);
  assert.ok(res(s, 'o1', ok, 80));
  assert.equal(res(s, 'o1', no, 90), false);
  Rc.finishSession(s, S(100));
  assert.equal(res(s, 'o2', ok, 110), false); // after the end
  assert.equal(Rc.strategyScore(s, REC).points >= 0, true);
});

test('state: sanitize, archive, restore merge by session id', () => {
  const s = session();
  ev(s, 'open', 'o1', 0); res(s, 'o1', ok, 100); Rc.finishSession(s, S(100));
  const st = Rc.emptyState();
  Rc.archive(st, s);
  const back = Rc.sanitize(JSON.parse(JSON.stringify(st)));
  assert.equal(back.history.length, 1);
  assert.equal(back.history[0].log.events.length, 2);
  const other = JSON.parse(JSON.stringify(st));
  other.history[0].id = 'r2'; other.history[0].finishedAt += 5;
  const m = JSON.parse(Rc.mergeRecovery(JSON.stringify(st), JSON.stringify(other)));
  assert.deepEqual(m.history.map((x) => x.id).sort(), ['r1', 'r2']);
  assert.equal(Rc.mergeRecovery('x', 'y'), JSON.stringify(Rc.emptyState()));
  assert.deepEqual(Rc.sanitize({ history: [{ id: 'z', uids: ['a'] }] }), Rc.emptyState());
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../js/srs.js';
import * as P from '../js/progress.js';

const D = S.DAY_MS;
const T0 = new Date(2026, 0, 10, 12, 0, 0).getTime(); // local noon, fake clock
const at = (days, h = 0) => T0 + days * D + h * 3600000;
const att = (exerciseId, outcome, ts, extra = {}) => ({ exerciseId, ts, outcome, hintsUsed: 0, seconds: 30, ...extra });
const fakeStorage = (init = {}) => {
  const m = { ...init };
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, m };
};

test('makeAttempt validates and cleans', () => {
  assert.equal(S.makeAttempt(null), null);
  assert.equal(S.makeAttempt({ exerciseId: 'a', outcome: 'bogus' }), null);
  assert.equal(S.makeAttempt({ outcome: 'alone' }), null);
  const r = S.makeAttempt({ exerciseId: 'a', outcome: 'wrong', ts: 5, hintsUsed: 2.7, seconds: -3, errorReason: 'sign' });
  assert.deepEqual(r, { exerciseId: 'a', ts: 5, outcome: 'wrong', hintsUsed: 2, seconds: 0, errorReason: 'sign' });
  assert.equal(S.makeAttempt({ exerciseId: 'a', outcome: 'alone', errorReason: 'nope' }).errorReason, undefined);
  assert.deepEqual(S.cleanLog('x'), []);
});

test('error reasons: seven Hebrew labels', () => {
  assert.deepEqual(S.ERROR_REASONS.map((r) => r.id), ['algebra', 'sign', 'formula', 'units', 'concept', 'arithmetic', 'other']);
  for (const r of S.ERROR_REASONS) assert.match(r.label, /[א-ת]/);
});

test('schedule: intervals 1,3,7,14 days after independent successes', () => {
  assert.equal(S.scheduleOf([]), null);
  const log = [];
  let t = T0;
  const expect = [1, 3, 7, 14, 14];
  expect.forEach((days, i) => {
    log.push(att('e', 'alone', t));
    const s = S.scheduleOf(log);
    assert.equal(s.due, t + days * D, `step ${i}`);
    assert.equal(s.streak, i + 1);
    t += days * D; // review exactly when due
  });
});

test('schedule: wrong or hinted or solution resets to 1 day and streak to 0', () => {
  for (const bad of ['wrong', 'hinted', 'solution']) {
    const log = [att('e', 'alone', T0), att('e', 'alone', at(1)), att(bad === 'x' ? 'e' : 'e', bad, at(4))];
    const s = S.scheduleOf(log);
    assert.equal(s.streak, 0, bad);
    assert.equal(s.due, at(5), bad);
    assert.equal(s.mastered, false);
  }
});

test('mastered after 3 spaced independent successes; loses it on a failure', () => {
  const log = [att('e', 'alone', T0), att('e', 'alone', at(1)), att('e', 'alone', at(4))];
  assert.equal(S.scheduleOf(log).mastered, true);
  log.push(att('e', 'wrong', at(11)));
  assert.equal(S.scheduleOf(log).mastered, false);
});

test('cramming (success before due) does not extend the streak', () => {
  const log = [att('e', 'alone', T0), att('e', 'alone', at(0, 1)), att('e', 'alone', at(0, 2))];
  const s = S.scheduleOf(log);
  assert.equal(s.streak, 1);
  assert.equal(s.mastered, false);
});

test('schedule ignores input order', () => {
  const a = [att('e', 'alone', T0), att('e', 'wrong', at(2))];
  assert.deepEqual(S.scheduleOf(a), S.scheduleOf([...a].reverse()));
});

test('dueReviews: most overdue first, not-yet-due excluded', () => {
  const log = [att('a', 'alone', T0), att('b', 'wrong', at(-3)), att('c', 'alone', at(5)), att('d', 'alone', at(-1), { })];
  // a due T0+1d, b due -2d, c due 6d, d due 0d
  assert.deepEqual(S.dueReviews(log, at(2)), ['b', 'd', 'a']);
  assert.deepEqual(S.dueReviews(log, at(-10)), []);
});

const EXS = [
  { id: 'm1', topic: 'math-3', level: 1 }, { id: 'm2', topic: 'math-3', level: 1 },
  { id: 'm3', topic: 'math-3', level: 1 }, { id: 'm4', topic: 'math-3', level: 2 },
  { id: 'p1', topic: 'phys', level: 1 }, { id: 'p2', topic: 'phys', level: 2 },
];

test('topic and level stats', () => {
  const log = [att('m1', 'alone', T0), att('m2', 'hinted', T0), att('p1', 'wrong', T0), att('p1', 'solution', at(1)), att('zzz', 'alone', T0)];
  const t = S.topicStats(log, EXS);
  assert.equal(t['math-3'].attempts, 2);
  assert.equal(t['math-3'].accuracy, 1);
  assert.equal(t['math-3'].aloneRate, 0.5);
  assert.equal(t.phys.accuracy, 0);
  assert.equal(t.phys.mastered, 0);
  assert.equal(Object.keys(t).length, 2); // unknown exercise ignored
  assert.equal(S.levelStats(log, EXS)[1].attempts, 4);
  assert.equal(S.levelStats(log, EXS)[2], undefined);
});

test('mastered count per topic', () => {
  const log = [att('m1', 'alone', T0), att('m1', 'alone', at(1)), att('m1', 'alone', at(4)), att('m2', 'alone', T0)];
  assert.equal(S.topicStats(log, EXS)['math-3'].mastered, 1);
});

test('weakTopics ranks weakest first, ties alphabetical, unattempted excluded', () => {
  const log = [att('m1', 'alone', T0), att('p1', 'wrong', T0)];
  assert.deepEqual(S.weakTopics(log, EXS).map((t) => t.topic), ['phys', 'math-3']);
  assert.deepEqual(S.weakTopics([att('p1', 'alone', T0), att('m1', 'alone', T0)], EXS).map((t) => t.topic), ['math-3', 'phys']);
  assert.deepEqual(S.weakTopics([], EXS), []);
});

test('level unlocking: 3 distinct independent solves; levels only drive suggestion', () => {
  let info = S.levelInfo([], EXS);
  assert.deepEqual(info.unlocked, [1]);
  assert.equal(info.suggested, 1);
  assert.deepEqual(info.levels, [1, 2]);
  // repeated solves of the same exercise do not count; hinted does not count
  let log = [att('m1', 'alone', T0), att('m1', 'alone', at(1)), att('m2', 'hinted', T0), att('p1', 'alone', T0)];
  assert.deepEqual(S.levelInfo(log, EXS).unlocked, [1]);
  log.push(att('m2', 'alone', at(2)));
  info = S.levelInfo(log, EXS);
  assert.deepEqual(info.unlocked, [1, 2]);
  assert.equal(info.suggested, 2);
  assert.equal(info.progress[1], 3);
});

test('level info with a single level', () => {
  const only3 = [{ id: 'a', topic: 't', level: 3 }];
  assert.deepEqual(S.levelInfo([], only3).unlocked, [3]);
  assert.equal(S.levelInfo([], []).suggested, null);
});

test('countReasons and recurringReasons', () => {
  const log = [
    att('a', 'wrong', T0, { errorReason: 'sign' }), att('b', 'wrong', T0, { errorReason: 'sign' }),
    att('c', 'wrong', at(5), { errorReason: 'units' }), att('d', 'wrong', at(5), { errorReason: 'algebra' }),
    att('e', 'alone', T0),
  ].map(S.makeAttempt);
  const c = S.countReasons(log);
  assert.deepEqual(c.map((x) => [x.reason, x.count]), [['sign', 2], ['algebra', 1], ['units', 1]]);
  assert.equal(c[0].label, 'טעות בסימן');
  assert.deepEqual(S.recurringReasons(log).map((x) => x.reason), ['sign']);
  assert.deepEqual(S.countReasons(log, { since: at(1) }).map((x) => x.reason), ['algebra', 'units']);
});

test('streak: consecutive days, today optional, gaps break', () => {
  const now = at(0, 3);
  assert.equal(S.currentStreak([], now), 0);
  const log = [att('a', 'alone', at(0)), att('a', 'wrong', at(-1)), att('a', 'alone', at(-2))];
  assert.equal(S.currentStreak(log, now), 3);
  assert.equal(S.currentStreak([att('a', 'alone', at(-1)), att('a', 'alone', at(-2))], now), 2); // none today yet
  assert.equal(S.currentStreak([att('a', 'alone', at(-2))], now), 0); // missed yesterday
  assert.equal(S.currentStreak([att('a', 'alone', at(0)), att('a', 'alone', at(-2))], now), 1);
  // multiple attempts same day count once
  assert.equal(S.currentStreak([att('a', 'alone', at(0)), att('b', 'alone', at(0, 1))], now), 1);
});

test('migrated records (unknown time) never count as activity', () => {
  const log = [S.makeAttempt({ exerciseId: 'a', outcome: 'alone', ts: 0, migrated: true })];
  assert.equal(S.currentStreak(log, T0), 0);
  assert.ok(S.last7Days(log, T0).every((d) => d.attempts === 0));
});

test('last7Days: 7 entries oldest first, counts attempts and correct', () => {
  const log = [att('a', 'alone', at(0)), att('a', 'wrong', at(0, 1)), att('a', 'hinted', at(-6)), att('a', 'alone', at(-7))];
  const w = S.last7Days(log, T0);
  assert.equal(w.length, 7);
  assert.equal(w[6].day, S.dayKey(T0));
  assert.deepEqual([w[6].attempts, w[6].correct], [2, 1]);
  assert.deepEqual([w[0].attempts, w[0].correct], [1, 1]);
  assert.equal(w.reduce((n, d) => n + d.attempts, 0), 3); // day -7 is outside
});

test('migration from progress state keeps every outcome', () => {
  const ps = P.emptyState();
  ps.ex.a = { outcome: 'alone', attempts: 2, ts: 100 };
  ps.ex.b = { outcome: 'hinted', attempts: 1, ts: 200 };
  ps.ex.c = { outcome: 'review', attempts: 1, ts: 300 };
  const recs = S.recordsFromProgress(ps);
  assert.deepEqual(recs.map((r) => [r.exerciseId, r.outcome, r.ts]), [['a', 'alone', 100], ['b', 'hinted', 200], ['c', 'solution', 300]]);
  assert.equal(recs[1].hintsUsed, 1);
  assert.ok(recs.every((r) => r.migrated));
  // also from a v1 blob through progress.migrate
  const v1 = P.migrate({ done: { x: true, y: true }, tips: { y: 2 } });
  assert.deepEqual(S.recordsFromProgress(v1).map((r) => r.outcome), ['alone', 'hinted']);
  assert.deepEqual(S.recordsFromProgress(null), []);
  assert.deepEqual(S.recordsFromProgress({ ex: { q: { outcome: '??' } } }), []);
});

test('createLog: persists, survives reload, ignores bad data and broken storage', () => {
  const st = fakeStorage();
  const log = S.createLog(st);
  assert.deepEqual(log.all(), []);
  assert.ok(log.add({ exerciseId: 'a', outcome: 'alone', ts: 5 }));
  assert.equal(log.add({ exerciseId: 'a', outcome: 'nope' }), null);
  assert.equal(S.createLog(st).all().length, 1);
  assert.deepEqual(S.createLog(fakeStorage({ [S.LOG_KEY]: '{bad json' })).all(), []);
  const broken = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
  const l2 = S.createLog(broken);
  assert.ok(l2.add({ exerciseId: 'a', outcome: 'alone', ts: 1 }));
  assert.equal(l2.all().length, 1);
});

test('createLog.migrateFrom is idempotent and keeps newer real records', () => {
  const st = fakeStorage();
  const log = S.createLog(st);
  log.add({ exerciseId: 'a', outcome: 'wrong', ts: 999 });
  const ps = P.emptyState();
  ps.ex.a = { outcome: 'alone', attempts: 1, ts: 1 };
  ps.ex.b = { outcome: 'review', attempts: 1, ts: 2 };
  assert.equal(log.migrateFrom(ps), 1);
  assert.equal(log.migrateFrom(ps), 0);
  const again = S.createLog(st).all();
  assert.equal(again.length, 2);
  assert.equal(again.find((r) => r.exerciseId === 'b').outcome, 'solution');
});

test('createLog.setReason attaches a valid reason to a stored record and persists it', () => {
  const st = fakeStorage();
  const log = S.createLog(st);
  const rec = log.add({ exerciseId: 'a', outcome: 'wrong', ts: 5 });
  assert.equal(log.setReason(rec, 'sign'), true);
  assert.equal(log.setReason(rec, 'bogus'), false);
  assert.equal(S.createLog(st).all()[0].errorReason, 'sign');
  assert.equal(log.setReason({ exerciseId: 'zzz' }, 'sign'), false);
});

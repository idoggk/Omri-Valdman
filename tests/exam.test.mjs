import test from 'node:test';
import assert from 'node:assert/strict';
import * as X from '../js/exam.js';

const mk = (id, topic, level) => ({ id, topic, level, inputs: [{ label: 'x', answer: 2 }, { label: 'y', answer: '3/2' }] });
const EXS = [];
for (const t of ['math-3', 'math-4', 'phys-vertical']) for (let i = 1; i <= 8; i++) EXS.push(mk(`${t}-${i}`, t, ((i - 1) % 3) + 1));

test('same seed gives the same set; different seed usually differs', () => {
  const args = { exercises: EXS, topics: ['math-3', 'math-4'], count: 8, mix: 'mixed' };
  const a = X.buildExamSet({ ...args, seed: 42 });
  assert.deepEqual(a, X.buildExamSet({ ...args, seed: 42 }));
  assert.notDeepEqual(a, X.buildExamSet({ ...args, seed: 43 }));
});

test('no repeats, only chosen topics, count capped by pool', () => {
  const ids = X.buildExamSet({ exercises: EXS, topics: ['math-3'], count: 12, seed: 5 });
  assert.equal(ids.length, 8);
  assert.equal(new Set(ids).size, 8);
  assert.ok(ids.every((i) => i.startsWith('math-3')));
  const mixed = X.buildExamSet({ exercises: EXS, topics: ['math-3', 'math-4', 'phys-vertical'], count: 5, seed: 7 });
  assert.equal(new Set(mixed).size, 5);
});

test('prefers exercises not solved alone; hard prefers high levels', () => {
  const alone = new Set(['math-3-1', 'math-3-2', 'math-3-3', 'math-3-4']);
  const ids = X.buildExamSet({ exercises: EXS, topics: ['math-3'], count: 4, seed: 1, isAlone: (id) => alone.has(id) });
  assert.ok(ids.every((i) => !alone.has(i)));
  const hard = X.buildExamSet({ exercises: EXS, topics: ['math-3'], count: 2, mix: 'hard', seed: 1 });
  assert.ok(hard.every((i) => EXS.find((e) => e.id === i).level === 3));
});

test('timer math', () => {
  const exam = X.createExam({ ids: ['a', 'b'], seed: 1, limitMs: X.defaultTimeLimitMs(2), now: 1000 });
  assert.equal(X.defaultTimeLimitMs(5), 30 * 60000);
  assert.equal(X.remainingMs(exam, 1000 + 60000), 12 * 60000 - 60000);
  assert.equal(X.isExpired(exam, 1000 + 12 * 60000 - 1), false);
  assert.equal(X.isExpired(exam, 1000 + 12 * 60000), true);
  assert.equal(X.remainingMs(exam, 1e12), 0);
  X.finish(exam, 5000);
  assert.equal(X.elapsedMs(exam, 99999), 4000); // frozen after finish
  const free = X.createExam({ ids: ['a'], seed: 1, limitMs: null, now: 0 });
  assert.equal(X.remainingMs(free, 1e9), null);
  assert.equal(X.isExpired(free, 1e9), false);
  assert.equal(X.formatClock(61000), '1:01');
  assert.equal(X.formatClock(59001), '1:00');
});

test('grading uses the practice checkers', () => {
  const ex = EXS[0];
  assert.equal(X.gradeQuestion(ex, ['2', '3/2']), 'right');
  assert.equal(X.gradeQuestion(ex, ['2', '1.5']), 'right');
  assert.equal(X.gradeQuestion(ex, ['2', '7']), 'wrong');
  assert.equal(X.gradeQuestion(ex, ['', ' ']), 'skipped');
  assert.equal(X.gradeQuestion(ex, undefined), 'skipped');
  const ch = { id: 'c', topic: 't', choice: { options: ['a', 'b'], correct: 1 } };
  assert.equal(X.gradeQuestion(ch, 1), 'right');
  assert.equal(X.gradeQuestion(ch, 0), 'wrong');
  assert.equal(X.gradeQuestion(ch, -1), 'skipped');
  const sets = { id: 's', topic: 't', answerSets: { labels: ['x', 'y'], sets: [['1', '2'], ['3', '4']], count: 3 } };
  assert.equal(X.gradeQuestion(sets, [['3', '4'], ['1', '2'], ['', '']]), 'right');
  assert.equal(X.gradeQuestion(sets, [['1', '2'], ['', ''], ['', '']]), 'wrong');
  assert.equal(X.gradeQuestion(sets, [['', ''], ['', '']]), 'skipped');
});

test('report: score, per-topic and weakest topic', () => {
  const list = [mk('a', 'math-3', 1), mk('b', 'math-3', 1), mk('c', 'phys-vertical', 1)];
  const exam = X.createExam({ ids: ['a', 'b', 'c'], seed: 1, limitMs: null, now: 0 });
  X.setAnswer(exam, 'a', ['2', '1.5']);
  X.setAnswer(exam, 'b', ['2', '1.5']);
  X.skip(exam, 'c');
  X.finish(exam, 90000);
  const r = X.gradeExam(exam, (id) => list.find((e) => e.id === id), 90000);
  assert.equal(r.right, 2);
  assert.equal(r.total, 3);
  assert.equal(r.percent, 67);
  assert.equal(r.usedMs, 90000);
  assert.deepEqual(r.perTopic['math-3'], { right: 2, total: 2 });
  assert.equal(r.weakest, 'phys-vertical');
  assert.deepEqual(r.items.map((i) => i.status), ['right', 'right', 'skipped']);
});

test('state validation survives JSON round trip and rejects garbage', () => {
  const exam = X.createExam({ ids: ['a'], seed: 1, limitMs: null, now: 5 });
  assert.ok(X.validExamState(JSON.parse(JSON.stringify(exam))));
  for (const bad of [null, {}, { ...exam, idx: 3 }, { ...exam, ids: [] }, { ...exam, v: 2 }, 'x']) assert.equal(X.validExamState(bad), false);
});

test('ticker: re-arming on navigation keeps exactly one live interval and wall-clock expiry works', () => {
  let now = 0, nextId = 1;
  const live = new Map();
  const T = X.createTicker((fn) => { live.set(nextId, fn); return nextId++; }, (id) => live.delete(id));
  const exam = X.createExam({ ids: ['a', 'b'], seed: 1, limitMs: 10000, now: 0 });
  const render = () => { T.start(() => {}); }; // viewRun re-render
  render(); render(); render(); // three in-exam navigations
  assert.equal(live.size, 1);
  assert.ok(T.active());
  now = 4000;
  assert.equal(X.remainingMs(exam, now), 6000);
  now = 10000;
  assert.ok(X.isExpired(exam, now));
  T.stop();
  assert.equal(live.size, 0);
});

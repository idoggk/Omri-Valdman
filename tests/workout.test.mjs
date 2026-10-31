import test from 'node:test';
import assert from 'node:assert/strict';
import { pickWorkout } from '../js/workout.js';
import { DAY_MS } from '../js/srs.js';

const NOW = new Date(2026, 0, 10, 12).getTime();
const att = (exerciseId, outcome, ts) => ({ exerciseId, ts, outcome, hintsUsed: 0, seconds: 10 });
const mk = (topic, level, n, prefix = topic) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${level}-${i + 1}`, topic, level }));

const ONLY3 = [...mk('math', 3, 8), ...mk('phys', 3, 8)];
const MIXED = [...mk('math', 1, 4), ...mk('math', 2, 4), ...mk('phys', 1, 4), ...mk('phys', 2, 4)];

const noDup = (ids) => assert.equal(new Set(ids).size, ids.length);

test('no history: new exercises, topics interleaved, size respected', () => {
  const w = pickWorkout([], ONLY3, NOW);
  assert.equal(w.length, 10);
  noDup(w);
  assert.deepEqual(w.slice(0, 4), ['math-3-1', 'phys-3-1', 'math-3-2', 'phys-3-2']);
});

test('no history with levels 1/2: starts at the lowest level', () => {
  const w = pickWorkout([], MIXED, NOW, 6);
  assert.equal(w.length, 6);
  assert.ok(w.slice(0, 4).every((id) => id.includes('-1-')), w.join());
});

test('deterministic: same input, same output; input log order irrelevant', () => {
  const log = [att('math-3-1', 'wrong', NOW - 3 * DAY_MS), att('phys-3-2', 'alone', NOW - 2 * DAY_MS)];
  const a = pickWorkout(log, ONLY3, NOW);
  assert.deepEqual(a, pickWorkout(log, ONLY3, NOW));
  assert.deepEqual(a, pickWorkout([...log].reverse(), ONLY3, NOW));
});

test('due reviews come first, most overdue first', () => {
  const log = [att('math-3-3', 'alone', NOW - 5 * DAY_MS), att('math-3-1', 'wrong', NOW - 9 * DAY_MS), att('phys-3-1', 'alone', NOW)];
  const w = pickWorkout(log, ONLY3, NOW);
  assert.deepEqual(w.slice(0, 2), ['math-3-1', 'math-3-3']);
  assert.ok(!w.slice(0, 2).includes('phys-3-1'));
});

test('due reviews capped at ~40% so new material still appears', () => {
  const log = ONLY3.slice(0, 12).map((e) => att(e.id, 'wrong', NOW - 3 * DAY_MS));
  const w = pickWorkout(log, ONLY3, NOW, 10);
  const newCount = w.filter((id) => !log.some((a) => a.exerciseId === id)).length;
  assert.equal(w.length, 10);
  assert.ok(newCount >= 2, `new=${newCount}`);
});

test('weak topic gets exercises that are not yet due', () => {
  // phys: failed today (due tomorrow, not due now); math: solved alone today
  const log = [att('phys-3-1', 'wrong', NOW), att('phys-3-2', 'wrong', NOW), att('math-3-1', 'alone', NOW), att('math-3-2', 'alone', NOW)];
  const w = pickWorkout(log, ONLY3, NOW, 10);
  const physNew = w.filter((id) => id.startsWith('phys') && !['phys-3-1', 'phys-3-2'].includes(id));
  assert.ok(physNew.length >= 3, w.join());
  assert.equal(w[0].startsWith('phys'), true);
});

test('suggested level moves up after 3 independent solves at the previous one', () => {
  const log = ['math-1-1', 'math-1-2', 'phys-1-1'].map((id) => att(id, 'alone', NOW));
  const w = pickWorkout(log, MIXED, NOW, 4);
  assert.ok(w.every((id) => id.includes('-2-')), w.join());
});

test('all levels stay available: when the suggested level runs out other levels fill in', () => {
  const log = ['math-1-1', 'math-1-2', 'phys-1-1'].map((id) => att(id, 'alone', NOW));
  const w = pickWorkout(log, MIXED, NOW, 16);
  assert.equal(w.length, 16);
  assert.equal(new Set(w).size, 16);
});

test('size larger than the pool returns everything once; size 0 / empty pool is empty', () => {
  const w = pickWorkout([], ONLY3, NOW, 99);
  assert.equal(w.length, ONLY3.length);
  noDup(w);
  assert.deepEqual(pickWorkout([], ONLY3, NOW, 0), []);
  assert.deepEqual(pickWorkout([], [], NOW), []);
});

test('mastered exercises not due are picked last', () => {
  const log = [att('math-3-1', 'alone', NOW - 20 * DAY_MS), att('math-3-1', 'alone', NOW - 19 * DAY_MS), att('math-3-1', 'alone', NOW - 16 * DAY_MS), att('math-3-1', 'alone', NOW - 1 * DAY_MS)];
  const w = pickWorkout(log, ONLY3, NOW, ONLY3.length);
  assert.equal(w[w.length - 1], 'math-3-1');
});

test('history for unknown exercises is ignored', () => {
  const w = pickWorkout([att('ghost', 'wrong', NOW - 9 * DAY_MS)], ONLY3, NOW, 5);
  assert.equal(w.length, 5);
  assert.ok(!w.includes('ghost'));
});

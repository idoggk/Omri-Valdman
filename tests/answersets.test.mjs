import test from 'node:test';
import assert from 'node:assert/strict';
import { matchSets, validAnswerSets } from '../js/answersets.js';

const SETS = [['2', '3'], ['-1', '0.5']];

test('both solutions, any order', () => {
  const r = matchSets([['-1', '0.5'], ['2', '3']], SETS);
  assert.deepEqual(r.right, [0, 1]);
  assert.ok(r.solved);
});

test('empty rows are ignored; missing solution is not solved but has no wrong rows', () => {
  const r = matchSets([['2', '3'], ['', '']], SETS);
  assert.deepEqual(r.right, [0]);
  assert.deepEqual(r.wrong, []);
  assert.equal(r.solved, false);
});

test('duplicate row counts only once', () => {
  const r = matchSets([['2', '3'], ['2', '3']], SETS);
  assert.deepEqual(r.right, [0]);
  assert.deepEqual(r.wrong, [1]);
  assert.equal(r.solved, false);
});

test('tolerance, fractions and commas', () => {
  assert.ok(matchSets([['2.005', '3'], ['-1', '1/2']], SETS, 0.01).solved);
  assert.equal(matchSets([['2.05', '3']], SETS, 0.01).wrong.length, 1);
  assert.ok(matchSets([['2', '3'], ['-1', '0,5']], SETS).solved);
});

test('partially filled or swapped-cell rows are wrong', () => {
  assert.deepEqual(matchSets([['2', '']], SETS).wrong, [0]);
  assert.deepEqual(matchSets([['3', '2']], SETS).wrong, [0]);
});

test('extra rows beyond the solutions: a wrong guess is flagged', () => {
  const r = matchSets([['2', '3'], ['-1', '0.5'], ['9', '9']], SETS);
  assert.deepEqual(r.wrong, [2]);
  assert.equal(r.solved, false);
});

test('count 1, 3 and 4 solutions', () => {
  assert.ok(matchSets([['5']], [['5']]).solved);
  const three = [['1'], ['2'], ['3']];
  assert.ok(matchSets([['3'], ['1'], ['2']], three).solved);
  const four = [['1', '1'], ['1', '-1'], ['-1', '1'], ['-1', '-1']];
  assert.ok(matchSets([['-1', '-1'], ['1', '1'], ['-1', '1'], ['1', '-1']], four).solved);
  assert.equal(matchSets([['1', '1'], ['1', '-1'], ['-1', '1']], four).right.length, 3);
});

test('overlapping tolerances still find a full matching', () => {
  const r = matchSets([['1.0'], ['1.01']], [['1.005'], ['1.015']], 0.01);
  assert.ok(r.solved);
});

test('validAnswerSets', () => {
  assert.ok(validAnswerSets({ labels: ['x', 'y'], count: 2, sets: SETS }));
  assert.ok(!validAnswerSets({ labels: ['x'], count: 2, sets: SETS }));
  assert.ok(!validAnswerSets({ labels: ['x', 'y'], count: 1, sets: SETS }));
  assert.ok(!validAnswerSets(null));
});

test('validAnswerSets caps count at 6', async () => {
  const { validAnswerSets } = await import('../js/answersets.js');
  const mk = (count) => ({ labels: ['x'], count, sets: [['1']] });
  assert.equal(validAnswerSets(mk(6)), true);
  assert.equal(validAnswerSets(mk(7)), false);
  assert.equal(validAnswerSets(mk(0)), false);
});

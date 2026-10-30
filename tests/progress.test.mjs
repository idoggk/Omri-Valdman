import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../js/progress.js';

test('solved alone', () => {
  const s = P.emptyState();
  P.completeCorrect(s, 'a', 10);
  assert.equal(P.outcomeOf(s, 'a'), 'alone');
  assert.equal(s.ex.a.attempts, 1);
  assert.equal(s.ex.a.ts, 10);
});

test('hinted after opening tips; tip count never decreases', () => {
  const s = P.emptyState();
  P.openTip(s, 'a', 2); P.openTip(s, 'a', 1);
  assert.equal(P.tipsUsed(s, 'a'), 2);
  P.completeCorrect(s, 'a', 5);
  assert.equal(P.outcomeOf(s, 'a'), 'hinted');
  assert.equal(P.tipsUsed(s, 'a'), 0); // attempt closed
});

test('revealing the solution is review immediately, stays review after a correct answer', () => {
  const s = P.emptyState();
  P.revealSolution(s, 'a', 1);
  assert.equal(P.outcomeOf(s, 'a'), 'review');
  P.revealSolution(s, 'a', 2); // idempotent
  assert.equal(s.ex.a.attempts, 1);
  P.completeCorrect(s, 'a', 3);
  assert.equal(P.outcomeOf(s, 'a'), 'review');
  assert.equal(s.ex.a.attempts, 1);
});

test('last completed attempt wins: review then alone leaves the queue', () => {
  const s = P.emptyState();
  P.revealSolution(s, 'a', 1); P.completeCorrect(s, 'a', 2);
  assert.deepEqual(P.reviewQueue(s, ['a']), ['a']);
  P.completeCorrect(s, 'a', 3);
  assert.equal(P.outcomeOf(s, 'a'), 'alone');
  assert.equal(s.ex.a.attempts, 2);
  assert.deepEqual(P.reviewQueue(s, ['a']), []);
});

test('review queue: only hinted/review, oldest first', () => {
  const s = P.emptyState();
  P.completeCorrect(s, 'alone', 1);
  P.openTip(s, 'h', 1); P.completeCorrect(s, 'h', 30);
  P.revealSolution(s, 'r', 20);
  assert.deepEqual(P.reviewQueue(s, ['alone', 'h', 'r', 'none']), ['r', 'h']);
});

test('countOutcomes', () => {
  const s = P.emptyState();
  P.completeCorrect(s, 'a', 1); P.revealSolution(s, 'b', 2);
  assert.deepEqual(P.countOutcomes(s, ['a', 'b', 'c']), { alone: 1, hinted: 0, review: 1, none: 1 });
});

test('migrate old v1 progress', () => {
  const s = P.migrate({ done: { a: true, b: true, c: false }, tips: { a: 2, d: 1 } });
  assert.equal(P.outcomeOf(s, 'a'), 'hinted');
  assert.equal(P.outcomeOf(s, 'b'), 'alone');
  assert.equal(P.outcomeOf(s, 'c'), null);
  assert.equal(P.tipsUsed(s, 'd'), 1);
  assert.deepEqual(P.reviewQueue(s, ['a', 'b']), ['a']);
});

test('migrate tolerates garbage and round-trips v2', () => {
  for (const bad of [null, undefined, 5, 'x', [], { v: 2, ex: 7, att: 'q' }, { done: 3, tips: [] }]) {
    assert.deepEqual(P.migrate(bad), P.emptyState());
  }
  const s = P.emptyState();
  P.openTip(s, 'x', 3); P.revealSolution(s, 'y', 9);
  assert.deepEqual(P.migrate(JSON.parse(JSON.stringify(s))), s);
  const dirty = P.migrate({ v: 2, ex: { a: { outcome: 'bogus' }, b: { outcome: 'alone' } } });
  assert.equal(P.outcomeOf(dirty, 'a'), null);
  assert.equal(dirty.ex.b.attempts, 1);
});

test('revealSolution does not demote an exercise solved alone', async () => {
  const p = await import('../js/progress.js');
  const s = p.emptyState ? p.emptyState() : p.load?.(null);
  assert.ok(s);
  p.completeCorrect(s, 'x1', 1);
  assert.equal(s.ex.x1.outcome, 'alone');
  p.revealSolution(s, 'x1', 2);
  assert.equal(s.ex.x1.outcome, 'alone');
  assert.equal(s.ex.x1.attempts, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, isCorrect, checkAll } from '../js/check.js';

test('integers and decimals', () => {
  assert.equal(parse('5'), 5);
  assert.equal(parse('2.5'), 2.5);
  assert.equal(parse('-0.5'), -0.5);
  assert.equal(parse('.5'), 0.5);
});

test('comma decimals', () => {
  assert.equal(parse('2,5'), 2.5);
});

test('fractions', () => {
  assert.equal(parse('3/2'), 1.5);
  assert.equal(parse(' -1 / 4 '), -0.25);
  assert.equal(parse('1/0'), null);
  assert.equal(parse('1/2/3'), null);
});

test('unicode minus', () => {
  assert.equal(parse('−3'), -3);
  assert.equal(parse('−3/2'), -1.5);
});

test('arabic-indic digits', () => {
  assert.equal(parse('٣'), 3);
  assert.equal(parse('١٢٫٥'), 12.5);
  assert.equal(parse('۴۵'), 45);
});

test('garbage', () => {
  for (const g of ['', '  ', 'abc', '1e5x', '--2', '2..3', '/', '3/', null, undefined, '1,2,3']) {
    assert.equal(parse(g), null, String(g));
  }
});

test('tolerance', () => {
  assert.equal(isCorrect('1.5', '3/2'), true);
  assert.equal(isCorrect('1.504', 1.5), true);
  assert.equal(isCorrect('1.52', 1.5), false);
  assert.equal(isCorrect('1.52', 1.5, 0.05), true);
  assert.equal(isCorrect('x', 1.5), false);
});

test('checkAll', () => {
  const inputs = [{ answer: '2' }, { answer: '3/2', tolerance: 0.001 }];
  assert.deepEqual(checkAll(['2', '1,5'], inputs), [true, true]);
  assert.deepEqual(checkAll(['3', ''], inputs), [false, false]);
});

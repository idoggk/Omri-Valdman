import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { solveSystem, parseFrac, validate } from '../tools/verify-math.mjs';

const str = (sol) => sol.map(String);

test('parseFrac handles integers, fractions, decimals', () => {
  assert.equal(String(parseFrac('6/4')), '3/2');
  assert.equal(String(parseFrac('-2.5')), '-5/2');
  assert.equal(String(parseFrac(7)), '7');
  assert.throws(() => parseFrac('abc'));
});

test('unique 3x3 solution', () => {
  const r = solveSystem([[1, 1, 1, 6], [2, -1, 1, 3], [1, 2, -1, 2]]);
  assert.equal(r.kind, 'unique');
  assert.deepEqual(str(r.solution), ['1', '2', '3']);
});

test('unique 3x3 with fractional solution', () => {
  const r = solveSystem([[2, 1, 2, 3], [1, -2, 2, -2], [4, 3, -2, -1]]);
  assert.deepEqual(str(r.solution), ['-1', '2', '3/2']);
});

test('no solution', () => {
  const r = solveSystem([[1, 1, 1, 4], [2, 3, -1, 1], [3, 4, 0, 7]]);
  assert.equal(r.kind, 'none');
  assert.equal(r.solution, null);
});

test('infinitely many solutions', () => {
  const r = solveSystem([[1, -1, 2, 3], [2, 1, -1, 3], [3, 0, 1, 6]]);
  assert.equal(r.kind, 'infinite');
  assert.equal(r.rank, 2);
});

test('unique 4x4 solution', () => {
  const r = solveSystem([[1, 1, 2, 1, 5], [2, -1, 2, -1, -6], [1, 2, -4, 2, 7], [3, 1, 0, -1, -4]]);
  assert.equal(r.kind, 'unique');
  assert.deepEqual(str(r.solution), ['-1', '2', '1/2', '3']);
});

test('4x4 none and infinite', () => {
  assert.equal(solveSystem([[1, 1, 1, 1, 10], [1, -1, 1, -1, 2], [2, 0, 2, 0, 13], [1, 2, 0, 3, 9]]).kind, 'none');
  assert.equal(solveSystem([[1, 1, 1, 1, 6], [1, 3, 1, 3, 14], [2, 4, 2, 4, 20], [2, 0, 2, 0, 4]]).kind, 'infinite');
});

test('fraction strings are accepted in system rows', () => {
  const r = solveSystem([['1/2', 0, 0, 1], [0, 1, 0, 2], [0, 0, '1/3', 1]]);
  assert.deepEqual(str(r.solution), ['2', '2', '3']);
});

test('validate reports a wrong answer', () => {
  const ex = {
    id: 'math-3-001', topic: 'math-3', level: 1, title: 'כותרת', statement: 'x + y + z = 6',
    inputs: [{ label: 'x', unit: '', answer: '9', tolerance: 0.01 }, { label: 'y', unit: '', answer: '2', tolerance: 0.01 }, { label: 'z', unit: '', answer: '3', tolerance: 0.01 }],
    tips: ['א', 'ב', 'ג'], solution: ['א', 'ב', 'ג'],
    verify: { system: [[1, 1, 1, 6], [2, -1, 1, 3], [1, 2, -1, 2]], kind: 'unique' },
  };
  const errs = validate([ex]);
  assert.ok(errs.some((e) => e.includes('input 1 answer "9"')));
});

test('validate rejects fraction answers and complex text', () => {
  const base = {
    id: 'math-3-001', topic: 'math-3', level: 1, title: 'כותרת', statement: 'פתרו: x + y + z = 6',
    inputs: [{ label: 'x', unit: '', answer: '1', tolerance: 0.01 }, { label: 'y', unit: '', answer: '2', tolerance: 0.01 }, { label: 'z', unit: '', answer: '3', tolerance: 0.01 }],
    tips: ['א', 'ב', 'ג'], solution: ['א', 'ב', 'ג'],
    verify: { system: [[1, 1, 1, 6], [2, -1, 1, 3], [1, 2, -1, 2]], kind: 'unique' },
  };
  assert.deepEqual(validate([base]).filter((e) => !e.includes('expected 12')), []);
  const frac = { ...base, inputs: [{ ...base.inputs[0], answer: '2/2' }, ...base.inputs.slice(1)] };
  assert.ok(validate([frac]).some((e) => e.includes('at most 2 decimal')));
  const cx = { ...base, tips: ['x = 2 + 3 i', 'ב', 'ג'] };
  assert.ok(validate([cx]).some((e) => e.includes('complex')));
});

test('data/math.json passes validation', () => {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'math.json');
  assert.deepEqual(validate(JSON.parse(readFileSync(file, 'utf8'))), []);
});

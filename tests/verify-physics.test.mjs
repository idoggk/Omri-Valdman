import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { models, checkExercise, checkAll } from '../tools/verify-physics.mjs';

const close = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  expected.forEach((e, i) => assert.ok(Math.abs(actual[i] - e) < 1e-9, `#${i}: ${actual[i]} != ${e}`));
};

test('free fall models', () => {
  close(models.free_fall_from_height({ h: 80 }), [4, 40]);
  close(models.free_fall_for_time({ t: 5 }), [125, 50]);
  close(models.distance_in_nth_second({ n: 3 }), [20, 25]);
  close(models.last_second_distance({ d: 35 }), [4, 80]);
  close(models.free_fall_ratio({ tA: 2, k: 4 }), [4, 40]);
});

test('vertical throw models', () => {
  close(models.vertical_throw_up({ v0: 20 }), [2, 20, 4]);
  close(models.vertical_throw_by_flight_time({ T: 6 }), [30, 45]);
  close(models.vertical_throw_down_from_height({ h: 75, v0: 10 }), [3, 40]);
  close(models.vertical_throw_from_height({ h: 25, v0: 20 }), [5, 30, 45]);
  close(models.two_body_meet_vertical({ H: 100, v0: 25 }), [4, 20]);
  close(models.vertical_height_times({ v0: 30, h: 40 }), [2, 4, 10]);
  close(models.speed_at_height({ v0: 20, h: 15 }), [10, 5]);
  assert.throws(() => models.vertical_height_times({ v0: 10, h: 100 }));
});

test('horizontal models', () => {
  close(models.const_velocity_meet({ d: 1000, v1: 20, v2: 30 }), [20, 400]);
  close(models.const_velocity_overtake({ gap: 200, v_fast: 25, v_slow: 15 }), [20, 500]);
  close(models.head_start_catch({ v_slow: 4, v_fast: 10, t0: 30 }), [20, 200]);
  close(models.const_accel_from_rest({ a: 2, t: 10 }), [20, 100]);
  close(models.accel_with_initial_speed_dist({ v0: 10, a: 2, x: 96 }), [22, 6]);
  close(models.accel_from_speeds_time({ v0: 20, v: 30, t: 5 }), [2, 125]);
  close(models.braking_only({ v: 30, a: 5 }), [6, 90]);
  close(models.braking_with_reaction({ v: 20, a: 5, tr: 1.5 }), [30, 40, 70]);
  close(models.accel_then_cruise({ a: 2, vmax: 20, D: 600 }), [10, 100, 35]);
  close(models.horizontal_launch({ h: 0.8, vx: 3 }), [0.4, 1.2, 5]);
  close(models.horizontal_launch_from_range({ h: 7.2, R: 6 }), [1.2, 5, 13]);
});

const sample = () => JSON.parse(JSON.stringify(JSON.parse(readFileSync(new URL('../data/physics.json', import.meta.url), 'utf8'))[0]));

test('shipped data is valid, 24 exercises, 12 per topic', () => {
  const list = JSON.parse(readFileSync(new URL('../data/physics.json', import.meta.url), 'utf8'));
  assert.deepEqual(checkAll(list), []);
  assert.equal(list.length, 24);
  assert.equal(list.filter((e) => e.topic === 'phys-vertical').length, 12);
  assert.equal(list.filter((e) => e.topic === 'phys-horizontal').length, 12);
});

test('checker rejects a wrong answer', () => {
  const ex = sample();
  ex.inputs[0].answer = '5';
  ex.inputs[0].tolerance = 0.05;
  assert.ok(checkExercise(ex).some((e) => e.includes('differs from recomputed')));
});

test('checker rejects bad structure', () => {
  const ex = sample();
  ex.tips.pop();
  ex.solution = ex.solution.slice(0, 2);
  ex.inputs[1].unit = '';
  ex.inputs[1].tolerance = 5;
  const errs = checkExercise(ex).join('\n');
  assert.match(errs, /tips must have exactly 3/);
  assert.match(errs, /at least 3 steps/);
  assert.match(errs, /unit missing/);
  assert.match(errs, /exceeds 2%/);
});

test('checker rejects leaking tip, Latin units, and >2 decimals', () => {
  const ex = sample();
  ex.tips[2] = `התשובה היא ${ex.inputs[0].answer}`;
  ex.unit = 'm/s';
  ex.inputs[1].unit = 'm/s';
  ex.statement += ' במהירות 20 m/s';
  ex.inputs[0].answer = '4.123';
  const errs = checkExercise(ex).join('\n');
  assert.match(errs, /Hebrew unit/);
  assert.match(errs, /Latin unit/);
  assert.match(errs, /plain decimal/);
  const leak = sample();
  leak.tips[2] = `התשובה היא ${leak.inputs[0].answer}`;
  assert.match(checkExercise(leak).join('\n'), /tip 3 contains the requested answer/);
});

test('every shipped answer has at most 2 decimals', () => {
  const list = JSON.parse(readFileSync(new URL('../data/physics.json', import.meta.url), 'utf8'));
  for (const ex of list) for (const i of ex.inputs) assert.match(i.answer, /^-?\d+(\.\d{1,2})?$/);
});

test('checker rejects duplicate ids and unknown models', () => {
  const a = sample();
  const b = sample();
  assert.ok(checkAll([a, b]).some((e) => e.includes('duplicate id')));
  b.id = 'phys-vertical-099';
  b.verify.model = 'nope';
  assert.ok(checkAll([a, b]).some((e) => e.includes('unknown model')));
});

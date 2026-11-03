import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, loadRecover } from '../tools/verify-recover.mjs';

const find = (list, id) => list.find((e) => e.id === id);
// Mutate one item of a fresh copy and return the validation errors that mention it.
const inject = (id, mutate) => {
  const copy = loadRecover();
  mutate(find(copy, id));
  return validate(copy).errors.filter((e) => e.startsWith(`${id}:`));
};

test('shipped data passes the independent verifier', () => {
  const { errors, stats } = validate(loadRecover());
  assert.deepEqual(errors, []);
  assert.equal(stats.math, 12);
  assert.equal(stats.physics, 12);
});

test('a wrong stored fix value is caught', () => {
  const errs = inject('rc-m-01', (e) => { e.fix.answer.value = '4'; });
  assert.ok(errs.some((e) => /fix:/.test(e)), errs.join('\n'));
});

test('a wrong stored remaining answer is caught', () => {
  const errs = inject('rc-p-04', (e) => { e.finish[0].answer.value = '4'; });
  assert.ok(errs.some((e) => /finish a:/.test(e)), errs.join('\n'));
});

test('a wrong ifError (what the erroneous chain gives) is caught', () => {
  const errs = inject('rc-p-05', (e) => { e.finish[0].ifError.value = '3'; });
  assert.ok(errs.some((e) => /ifError/.test(e)), errs.join('\n'));
});

test('an ifError equal to the correct answer is caught', () => {
  const errs = inject('rc-p-06', (e) => { e.finish[0].ifError.value = e.finish[0].answer.value; });
  assert.ok(errs.length > 0);
});

test('marking a numerically TRUE step as the error is caught', () => {
  const errs = inject('rc-m-06', (e) => { e.firstWrong = 0; });
  assert.ok(errs.some((e) => /claims|numerically/.test(e)), errs.join('\n'));
});

test('moving the error later makes the earlier erroneous step a failed "true" step', () => {
  const errs = inject('rc-p-02', (e) => { e.firstWrong = 2; });
  assert.ok(errs.some((e) => /should be numerically true/.test(e) || /claims/.test(e)), errs.join('\n'));
});

test('too few steps, a late error, and a missing model are caught', () => {
  assert.ok(inject('rc-m-10', (e) => { e.steps = e.steps.slice(0, 4); e.firstWrong = 1; }).some((e) => /5-7 steps/.test(e)));
  assert.ok(inject('rc-m-11', (e) => { e.firstWrong = 4; }).some((e) => /early/.test(e)));
  const copy = loadRecover();
  copy.find((e) => e.id === 'rc-m-09').id = 'rc-m-99';
  assert.ok(validate(copy).errors.some((e) => /no independent model/.test(e)));
});

test('an error that changes no answer is caught', () => {
  const errs = inject('rc-m-09', (e) => { for (const p of e.finish) { p.ifError = JSON.parse(JSON.stringify(p.answer)); } });
  assert.ok(errs.length > 0);
});

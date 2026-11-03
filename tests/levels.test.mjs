import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPools, validate, topicErrors, levelErrors } from '../tools/verify-levels.mjs';

const clone = () => structuredClone(loadPools());
const find = (pools, id) => Object.values(pools).flat().find((e) => e.id === id);

test('levels: real data has consistent topic tags and levels', () => {
  const { errors, items } = validate();
  assert.deepEqual(errors, []);
  assert.ok(items > 200);
});

test('levels: audit retags are in place and ids are unchanged', () => {
  const pools = loadPools();
  for (const id of ['lad-m4-07', 'lad-m4-08', 'lad-m4-09']) assert.equal(find(pools, id).topic, 'math-pow');
  for (const id of ['lad-m6-03', 'lad-m6-09']) assert.equal(find(pools, id).topic, 'math-hard-circle');
  for (const id of ['lad-m6-05', 'lad-m6-06']) assert.equal(find(pools, id).topic, 'trig');
  const ids = new Set(Object.values(pools).flat().map((e) => e.id));
  for (const id of ['mh-rad-8', 'mh-rad-5', 'lg-3-01', 'lg-4-06', 'lg-4-11', 'lg-5-12', 'lad-m6-07', 'lad-m6-06', 'lad-m6-09', 'math-lg-001', 'math-par-001', 'mh-par-8']) {
    assert.ok(ids.has(id), `${id} must still exist`);
  }
});

test('levels: an exponential item tagged math-rad, a circle item tagged math-par, a trig item tagged math-par are reported', () => {
  const pools = clone();
  find(pools, 'lad-m4-07').topic = 'math-rad';
  find(pools, 'lad-m6-03').topic = 'math-par';
  find(pools, 'lad-m6-05').topic = 'math-par';
  const errs = topicErrors(pools);
  for (const id of ['lad-m4-07', 'lad-m6-03', 'lad-m6-05']) assert.ok(errs.some((m) => m.startsWith(id)), id);
});

test('levels: an item far from the median of its method group is reported', () => {
  const pools = clone();
  find(pools, 'lg-5-12').tier = 5; // a single-log equation at the top tier
  assert.ok(levelErrors(pools).some((m) => m.startsWith('lg-5-12')));
  const p2 = clone();
  find(p2, 'lg-3-02').tier = 1;
  assert.ok(levelErrors(p2).some((m) => m.startsWith('lg-3-02')));
});

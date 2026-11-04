import test from 'node:test';
import assert from 'node:assert/strict';
import { createClock, CAP_FACTOR } from '../js/clock.js';

const fakeDoc = () => {
  const d = { visibilityState: 'visible', fns: [], addEventListener(t, f) { if (t === 'visibilitychange') d.fns.push(f); } };
  d.set = (v) => { d.visibilityState = v; d.fns.forEach((f) => f()); };
  return d;
};

test('a tab hidden for 10 minutes adds nothing: recorded seconds < 60', () => {
  const doc = fakeDoc();
  let t = 1_000_000;
  const clock = createClock({ doc, now: () => t });
  const sw = clock.start(180);
  t += 20_000; // 20 s looking at the question
  doc.set('hidden');
  t += 10 * 60_000; // phone locked
  doc.set('visible');
  t += 15_000;
  assert.equal(sw.seconds(), 35);
  assert.ok(sw.seconds() < 60);
});

test('time while hidden at the moment of reading is not counted either', () => {
  const doc = fakeDoc();
  let t = 0;
  const clock = createClock({ doc, now: () => t });
  const sw = clock.start(100);
  t += 5000;
  doc.set('hidden');
  t += 3_600_000;
  assert.equal(sw.seconds(), 5);
});

test('one item is capped at 3x its budget, and a missing budget uses the default', () => {
  const doc = fakeDoc();
  let t = 0;
  const clock = createClock({ doc, now: () => t });
  const sw = clock.start(60);
  t += 10_000_000;
  assert.equal(CAP_FACTOR, 3);
  assert.equal(sw.seconds(), 180);
  assert.equal(clock.start(undefined).cap, 900);
});

test('independent stopwatches share one clock; starting while hidden counts from the next visible moment', () => {
  const doc = fakeDoc();
  let t = 0;
  const clock = createClock({ doc, now: () => t });
  t += 4000;
  const a = clock.start(100);
  doc.set('hidden');
  t += 60_000;
  const b = clock.start(100);
  doc.set('visible');
  t += 2000;
  assert.equal(a.seconds(), 2);
  assert.equal(b.seconds(), 2);
});

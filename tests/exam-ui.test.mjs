import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.mjs';

const dom = installFakeDom(); // before importing the UI: exam-ui creates its ticker at import time
const X = await import('../js/exam.js');
const store = await import('../js/store.js');
const { viewExam } = await import('../js/exam-ui.js');

const EXS = [1, 2, 3].map((n) => ({
  id: `m-${n}`, topic: 'math-3', title: `Q${n}`, statement: 'st', inputs: [{ label: 'x', answer: n }],
}));
const ctx = {
  topics: [{ id: 'math-3', title: 'מתמטיקה' }],
  exercises: EXS,
  byId: (id) => EXS.find((e) => e.id === id),
  show: dom.show,
};

function start(limitMs) {
  dom.clock.now = 1_000_000;
  dom.intervals.clear();
  location.hash = '#/exam/run';
  store.saveExam(X.createExam({ ids: EXS.map((e) => e.id), seed: 1, limitMs, now: dom.clock.now }));
  viewExam(ctx, 'run');
}
const type = (value) => { const i = dom.root.querySelector('input'); i.value = value; i.dispatch('input'); };
const btn = (text) => dom.root.byText('button', text);

test('typing a answer before the limit saves it', () => {
  start(60000);
  dom.clock.now += 1000;
  type('1');
  assert.deepEqual(store.loadExam().answers['m-1'], ['1']);
  assert.equal(store.loadExam().endedAt, null);
});

test('typing after the limit (before the next tick) ends the exam without ReferenceError', () => {
  start(60000);
  dom.clock.now += 61000;
  type('1');
  const e = store.loadExam();
  assert.notEqual(e.endedAt, null);
  assert.equal(location.hash, '#/exam/report');
  assert.equal(e.answers['m-1'], undefined);
  assert.equal(dom.intervals.size, 0);
});

test('re-renders keep exactly one live interval; next / previous / skip work', () => {
  start(null);
  assert.equal(dom.intervals.size, 1);
  btn('הבאה').click();
  assert.equal(store.loadExam().idx, 1);
  btn('הקודמת').click();
  assert.equal(store.loadExam().idx, 0);
  btn('דלג').click();
  const e = store.loadExam();
  assert.equal(e.idx, 1);
  assert.ok(e.skipped['m-1']);
  assert.equal(dom.intervals.size, 1);
});

test('finish asks for confirmation, then grades and records the report', () => {
  start(null);
  type('1');
  btn('סיום מבחן').click();
  assert.equal(store.loadExam().endedAt, null);
  btn('כן, סיים').click();
  const e = store.loadExam();
  assert.notEqual(e.endedAt, null);
  assert.equal(location.hash, '#/exam/report');
  viewExam(ctx, 'report');
  assert.ok(dom.root.byText('h1', 'תוצאות'));
  assert.ok(dom.root.byText('div', '1 / 3'));
});

test('cleanup', () => dom.restore());

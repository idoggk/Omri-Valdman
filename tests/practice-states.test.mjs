// Renders every practice view under many storage states: none may throw, all must show sensible Hebrew.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.mjs';
import { readFileSync } from 'node:fs';

const dom = installFakeDom();
const store = await import('../js/store.js');
const UI = await import('../js/practice-ui.js');
const { ERROR_REASONS } = await import('../js/srs.js');

const EXS = ['math', 'physics'].flatMap((f) => JSON.parse(readFileSync(new URL(`../data/${f}.json`, import.meta.url), 'utf8')));
const TOPICS = [
  { id: 'math-3', title: 'מערכת משוואות עם 3 נעלמים' }, { id: 'math-4', title: 'מערכת משוואות עם 4 נעלמים' },
  { id: 'phys-vertical', title: 'תנועה אנכית' }, { id: 'phys-horizontal', title: 'תנועה אופקית' },
];
const ctx = { topics: TOPICS, exercises: EXS, byId: (id) => EXS.find((e) => e.id === id), show: dom.show };
const DAY = 86400000;
const NOW = 40 * DAY;

function manyAttempts() {
  const outcomes = ['alone', 'hinted', 'solution', 'wrong'];
  const log = [];
  for (let i = 0; i < 300; i++) {
    const a = { exerciseId: EXS[i % EXS.length].id, ts: NOW - (i % 12) * DAY - i * 1000, outcome: outcomes[i % 4], hintsUsed: i % 3, seconds: i };
    if (a.outcome === 'wrong') a.errorReason = ERROR_REASONS[i % ERROR_REASONS.length].id;
    log.push(a);
  }
  log.push({ exerciseId: 'gone-id', ts: NOW, outcome: 'alone' }); // exercise that no longer exists
  return log;
}

const STATES = {
  empty: {},
  'corrupt attempts json': { 'omri-study-attempts-v1': '{not json' },
  'corrupt progress json': { 'omri-study-progress-v2': '[[[', 'omri-study-workout-v1': 'x' },
  'wrong-typed json': { 'omri-study-attempts-v1': '"str"', 'omri-study-progress-v2': 'null', 'omri-study-workout-v1': '{"ids":5}' },
  'garbage records': { 'omri-study-attempts-v1': JSON.stringify([null, 1, 'x', {}, { exerciseId: 5 }, { exerciseId: 'a', outcome: 'zzz' }, { exerciseId: EXS[0].id, outcome: 'alone', ts: 'bad' }]) },
  'old v1 progress only': { 'omri-study-progress-v1': JSON.stringify({ done: { [EXS[0].id]: true, [EXS[1].id]: true }, tips: { [EXS[1].id]: 2 } }) },
  'old v2 progress only': { 'omri-study-progress-v2': JSON.stringify({ v: 2, ex: { [EXS[0].id]: { outcome: 'alone', attempts: 1, ts: 5 }, [EXS[1].id]: { outcome: 'review', attempts: 2, ts: 9 } }, att: {} }) },
  'populated history': { 'omri-study-attempts-v1': JSON.stringify(manyAttempts()) },
};

function setState(raw, { throwing = false } = {}) {
  dom.store.clear();
  for (const [k, v] of Object.entries(raw)) dom.store.set(k, v);
  store.resetCache();
  dom.clock.now = NOW;
  if (throwing) {
    globalThis.localStorage = {
      getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); },
    };
  }
}
const text = () => dom.root.textContent;
const hasHebrew = (s) => /[֐-׿]/.test(s);
const bad = (s) => !/undefined|NaN|\[object|null/.test(s);

const realStorage = globalThis.localStorage;
for (const [name, raw] of [...Object.entries(STATES), ['storage access throws', {}]]) {
  const throwing = name === 'storage access throws';
  test(`views render without throwing: ${name}`, () => {
    globalThis.localStorage = realStorage;
    setState(raw, { throwing });

    const card = UI.homeCard(ctx);
    assert.match(card.textContent, /האימון של היום/);
    assert.ok(bad(card.textContent), card.textContent);

    UI.viewProgress(ctx);
    assert.match(text(), /ההתקדמות שלי/);
    assert.match(text(), /רצף: \d+ (יום|ימים)/);
    assert.match(text(), /היעד הבא/);
    assert.equal(dom.root.all((n) => n.className === 'day').length, 7);
    assert.equal(dom.root.all((n) => n.className === 'topic-row').length, TOPICS.length);
    assert.ok(hasHebrew(text()) && bad(text()), text());

    assert.equal(UI.startWorkout(EXS, NOW), true);
    const w = store.loadWorkout() || { ids: EXS.slice(0, 10).map((e) => e.id) }; // nothing persists when storage throws
    if (!throwing) assert.equal(w.ids.length, 10, 'workout of 10 stored');
    assert.match(UI.workoutBar(1, w.ids.length).textContent, /שאלה 1 מתוך 10/);

    UI.viewWorkoutSummary(ctx);
    assert.match(text(), throwing ? /אין אימון פעיל/ : /סיכום האימון/);
    if (!throwing) assert.match(text(), /דולגו/);
    assert.ok(bad(text()), text());

    const rec = store.recordAttempt({ exerciseId: w.ids[0], outcome: 'wrong' });
    const box = UI.reasonChips((r) => store.setAttemptReason(rec, r));
    assert.equal(box.all((n) => n.tagName === 'BUTTON').length, ERROR_REASONS.length + 1);
    box.byText('button', 'טעות בסימן').click();
    assert.match(box.textContent, /נשמר: טעות בסימן/);

    UI.viewWorkoutSummary(ctx);
    assert.ok(bad(text()), text());
    UI.viewProgress(ctx);
    assert.match(text(), /סיבות חוזרות לטעויות/);
  });
}

test('no workout stored: summary shows the Hebrew empty state', () => {
  globalThis.localStorage = realStorage;
  setState({});
  UI.viewWorkoutSummary(ctx);
  assert.match(text(), /אין אימון פעיל/);
});

test('populated history: recurring reasons are listed with counts', () => {
  globalThis.localStorage = realStorage;
  setState(STATES['populated history']);
  UI.viewProgress(ctx);
  assert.ok(dom.root.all((n) => n.className === 'reasons').length === 1);
  assert.match(text(), /: \d+/);
});

test('progress view with no exercises loaded yet', () => {
  globalThis.localStorage = realStorage;
  setState({});
  UI.viewProgress({ ...ctx, exercises: [] });
  assert.match(text(), /ההתקדמות שלי/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { pickWorkout, topicLevels, levelLine } from '../js/workout.js';
import { cleanList } from '../js/feedback.js';

const NOW = new Date(2026, 0, 10, 12).getTime();
const mk = (topic, level, n) => Array.from({ length: n }, (_, i) => ({ id: `${topic}-${level}-${i + 1}`, topic, level }));
const EXS = [...mk('p', 1, 6), ...mk('p', 2, 6), ...mk('p', 3, 6), ...mk('m', 1, 6), ...mk('m', 2, 6)];
const att = (exerciseId, outcome, ts, hintsUsed = 0) => ({ exerciseId, ts, outcome, hintsUsed, seconds: 30 });
const fb = (exerciseId, rating, extra = {}) => ({ id: exerciseId, ts: 1, exerciseId, rating, hintsUsed: 0, solutionViewed: false, correct: true, ...extra });
// level 1 solved alone 3x (unlocks level 2 globally) so the base level is 2 for the "p" tests
const base = [att('p-1-1', 'alone', 1), att('p-1-2', 'alone', 2), att('p-1-3', 'alone', 3)];
const three = (lvl, from = 10) => [1, 2, 3].map((i) => att(`p-${lvl}-${i}`, 'alone', from + i));

test('three easy solves at the current level promote the topic by one', () => {
  const log = [...base, ...three(2)];
  const fbs = [1, 2, 3].map((i) => fb(`p-2-${i}`, i === 2 ? 2 : 1));
  const p = topicLevels(log, EXS, fbs).get('p');
  assert.equal(p.level, 3); assert.equal(p.from, 2); assert.equal(p.rated, true);
  assert.equal(topicLevels(log, EXS, fbs).get("m").from, null); // other topic unaffected
  assert.match(levelLine(log, EXS, fbs, () => 'פיזיקה'), /רמת האימון עלתה ב/);
});

test('missing rating: correct and no hints is enough', () => {
  const p = topicLevels([...base, ...three(2)], EXS, []).get('p');
  assert.equal(p.level, 3); assert.equal(p.rated, false);
});

test('no promotion: rating 3, hints, solution viewed, wrong outcome or fewer than 3 attempts', () => {
  const log = [...base, ...three(2)];
  const lv = (l, f) => topicLevels(l, EXS, f).get("p").from;
  assert.equal(lv(log, [fb('p-2-1', 3)]), null);
  assert.equal(lv(log, [fb('p-2-1', 1, { hintsUsed: 1 })]), null);
  assert.equal(lv(log, [fb('p-2-1', 1, { solutionViewed: true })]), null);
  assert.equal(topicLevels([...base, ...three(2).slice(0, 2)], EXS, []).get("p").level, 2);
  assert.equal(topicLevels([...base, att("p-2-1", "hinted", 11, 1), att("p-2-2", "alone", 12), att("p-2-3", "alone", 13)], EXS, []).get("p").level, 2);
  assert.equal(topicLevels([...base, ...three(2).slice(0, 2), att("p-2-3", "wrong", 20)], EXS, []).get("p").level, 2);
});

test('promotion chains up to the hardest level and stops there; failure keeps the floor', () => {
  const log = [...base, ...three(2), ...three(3, 30)];
  assert.equal(topicLevels(log, EXS, []).get('p').level, 3);
  const failed = [...log, att('p-3-4', 'wrong', 50)];
  assert.equal(topicLevels(failed, EXS, []).get('p').level, 3); // never below the level of the last failure
});

test('deterministic and the promoted topic gets its higher-level exercises first', () => {
  const log = [...base, ...three(2)];
  const a = pickWorkout(log, EXS, NOW, 6, { feedback: [] });
  assert.deepEqual(a, pickWorkout([...log].reverse(), EXS, NOW, 6, { feedback: [] }));
  assert.ok(a.some((id) => id.startsWith('p-3-')), a.join());
});

test('ladder share: about a third of the workout comes from the highest unlocked stage', () => {
  const stages = [
    { id: 'S1', items: [{ ref: 'p-1-1' }, { ref: 'p-1-2' }, { ref: 'p-1-3' }] },
    { id: 'S2', items: [{ ref: 'p-3-1' }, { ref: 'p-3-2' }, { ref: 'p-3-3' }, { ref: 'p-3-4' }, { ref: 'm-1-1' }] },
    { id: 'S3', items: [{ ref: 'p-3-6' }] },
  ];
  const w = pickWorkout(base, EXS, NOW, 9, { ladder: stages });
  const fromStage = w.filter((id) => stages[1].items.some((it) => it.ref === id));
  assert.ok(fromStage.length >= 3, w.join());
  assert.ok(!w.includes('p-3-6')); // S3 still locked
  assert.deepEqual(w, pickWorkout(base, EXS, NOW, 9, { ladder: stages }));
});

test('ladder share counts inline items: inline-only S3 done, share comes from S4 refs', async () => {
  const P = await import('../js/progress.js');
  const items = P.emptyState();
  P.completeCorrect(items, 'inl-1'); P.completeCorrect(items, 'inl-2');
  const store = { 'omri-study-ladder-v1': JSON.stringify({ v: 1, skip: {}, items }) };
  globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
  try {
    const stages = [
      { id: 'S1', items: [{ ref: 'p-1-1' }, { ref: 'p-1-2' }, { ref: 'p-1-3' }] },
      { id: 'S3', items: [{ id: 'inl-1' }, { id: 'inl-2' }] },
      { id: 'S4', items: [{ ref: 'p-3-1' }, { ref: 'p-3-2' }, { ref: 'p-3-3' }, { ref: 'p-3-4' }] },
    ];
    const w = pickWorkout(base, EXS, NOW, 9, { ladder: stages });
    assert.ok(w.filter((id) => stages[2].items.some((it) => it.ref === id)).length >= 3, w.join());
  } finally { delete globalThis.localStorage; }
});

test('old state still loads: no opts, garbage feedback, attempts without extras', () => {
  assert.equal(pickWorkout([], EXS, NOW, 5).length, 5);
  assert.equal(pickWorkout(null, EXS, NOW, 5, { feedback: 'junk', ladder: 'x' }).length, 5);
  assert.equal(topicLevels(base, EXS, [null, 3, { exerciseId: 7 }, { exerciseId: "p-2-1" }]).get("p").level, 2);
  assert.deepEqual(cleanList({ v: 1, records: [{ exerciseId: 'p-2-1', rating: 1 }, { nope: 1 }] }).length, 0); // ts 0 -> dropped, no throw
});

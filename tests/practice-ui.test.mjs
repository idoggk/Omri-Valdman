import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.mjs';

const dom = installFakeDom();
const store = await import('../js/store.js');
const UI = await import('../js/practice-ui.js');

const EXS = Array.from({ length: 12 }, (_, i) => ({
  id: `m-${i}`, topic: i < 6 ? 'math-3' : 'math-4', level: 1 + (i % 3), title: `Q${i}`, statement: 's', inputs: [{ label: 'x', answer: i }],
}));
const TOPICS = [{ id: 'math-3', title: 'שלושה נעלמים' }, { id: 'math-4', title: 'ארבעה נעלמים' }];
const ctx = { topics: TOPICS, exercises: EXS, byId: (id) => EXS.find((e) => e.id === id), show: dom.show };
const text = () => dom.root.textContent;

test('home card shows counts and a start button for a fresh user', () => {
  const card = UI.homeCard(ctx);
  assert.match(card.textContent, /האימון של היום/);
  assert.match(card.textContent, /חדשים/);
  assert.ok(card.all((n) => n.tagName === 'A' && n.getAttribute('href') === '#/workout/start').length === 1);
});

test('workoutMix splits due / weak / fresh', () => {
  const now = 10 * 86400000;
  const log = [
    { exerciseId: 'm-0', ts: 1000, outcome: 'wrong' },      // due long ago
    { exerciseId: 'm-1', ts: now - 1000, outcome: 'wrong' }, // attempted, not yet due
  ];
  assert.deepEqual(UI.workoutMix(log, EXS, now, ['m-0', 'm-1', 'm-2']), { due: 1, weak: 1, fresh: 1 });
});

test('startWorkout stores 10 ids; summary lists results; bar shows "שאלה 3 מתוך 10"', () => {
  dom.clock.now = 5 * 86400000;
  assert.equal(UI.startWorkout(EXS), true);
  const w = store.loadWorkout();
  assert.equal(w.ids.length, 10);
  assert.match(UI.workoutBar(3, 10).textContent, /שאלה 3 מתוך 10/);
  store.recordAttempt({ exerciseId: w.ids[0], outcome: 'alone' });
  store.recordAttempt({ exerciseId: w.ids[1], outcome: 'wrong' });
  UI.viewWorkoutSummary(ctx);
  assert.match(text(), /סיכום האימון/);
  assert.equal(dom.root.all((n) => n.tagName === 'LI' && n.textContent.includes('נפתרו לבד'))[0].textContent.trim().startsWith('1'), true);
  assert.equal(dom.root.all((n) => n.tagName === 'LI' && n.textContent.includes('דולגו'))[0].textContent.trim().startsWith('8'), true);
});

test('reason chips: one tap saves the reason on the attempt record; skip saves nothing', () => {
  const rec = store.recordAttempt({ exerciseId: 'm-5', outcome: 'wrong' });
  const box = UI.reasonChips((r) => store.setAttemptReason(rec, r));
  assert.equal(box.all((n) => n.tagName === 'BUTTON').length, 8); // 7 reasons + skip
  box.byText('button', 'טעות בסימן').click();
  assert.equal(store.getAttempts().find((a) => a.exerciseId === 'm-5').errorReason, 'sign');
  const rec2 = store.recordAttempt({ exerciseId: 'm-6', outcome: 'wrong' });
  const box2 = UI.reasonChips((r) => store.setAttemptReason(rec2, r));
  box2.byText('button', 'דלג').click();
  assert.equal(box2.children.length, 0);
  assert.equal(store.getAttempts().find((a) => a.exerciseId === 'm-6').errorReason, undefined);
});

test('progress screen renders streak, week bars, topic bars, recurring reasons, next target', () => {
  const rec = store.recordAttempt({ exerciseId: 'm-7', outcome: 'wrong' });
  store.setAttemptReason(rec, 'sign');
  UI.viewProgress(ctx);
  const t = text();
  assert.match(t, /רצף: 1 יום/);
  assert.match(t, /טעות בסימן: 2/);
  assert.match(t, /שלושה נעלמים/);
  assert.match(t, /היעד הבא/);
  assert.equal(dom.root.all((n) => n.className === 'day').length, 7);
});

test('progress screen with no attempts still renders', () => {
  ctx.exercises = [];
  UI.viewProgress({ ...ctx, exercises: [] });
  assert.match(text(), /ההתקדמות שלי/);
});

test('suggestedLevel is a number or null and never throws on empty topics', () => {
  assert.ok([1, 2, 3, null].includes(UI.suggestedLevel(EXS)));
  assert.equal(UI.suggestedLevel([]), null);
});

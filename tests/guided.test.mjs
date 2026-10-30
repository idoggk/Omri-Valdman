import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../js/guided.js';
import * as P from '../js/progress.js';
import { cleanExamples, cleanFormulas, revealNext } from '../js/examples.js';
import { sanitizeHtml } from '../js/sanitize.js';
import { isolateFormulas, isolateRanges } from '../js/bidi.js';

const STEPS = [
  { q: 'מה הצעד הראשון?', options: ['א', 'ב', 'ג'], correct: 0, explain: 'כי כך', wrongExplain: ['', 'ב שגוי', 'ג שגוי'] },
  { q: 'ואז?', options: ['א', 'ב'], correct: 1, explain: 'סיום' },
];

test('validGuided accepts good steps and rejects bad ones', () => {
  assert.ok(G.validGuided(STEPS));
  assert.ok(!G.validGuided([]));
  assert.ok(!G.validGuided(undefined));
  assert.ok(!G.validGuided([{ q: 'x', options: ['a'], correct: 0 }]));
  assert.ok(!G.validGuided([{ q: 'x', options: ['a', 'b'], correct: 2 }]));
});

test('stepper: right answer, wrong answer with retry, finish', () => {
  let s = G.startGuided();
  assert.deepEqual(G.progress(s, STEPS), { current: 1, total: 2 });
  assert.equal(G.feedback(s, STEPS), null);
  assert.equal(G.next(s, STEPS), s); // cannot skip an unanswered step
  s = G.pick(G.pick(s, STEPS, 0), STEPS, 1); // second pick ignored
  assert.equal(s.picked.length, 1);
  assert.equal(G.feedback(s, STEPS).ok, true);
  s = G.next(s, STEPS);
  assert.equal(s.i, 1);
  s = G.pick(s, STEPS, 0);
  const f = G.feedback(s, STEPS);
  assert.equal(f.ok, false);
  assert.equal(s.mistakes, 1);
  s = G.retry(s, STEPS);
  assert.equal(G.answered(s), false);
  s = G.next(G.pick(s, STEPS, 1), STEPS);
  assert.equal(s.done, true);
  assert.equal(G.pick(s, STEPS, 0), s);
});

test('wrong answer shows the per-option explanation', () => {
  let s = G.pick(G.startGuided(), STEPS, 1);
  assert.equal(G.feedback(s, STEPS).why, 'ב שגוי');
});

test('progress: guided counts as tips used, never as solved', () => {
  const st = P.emptyState();
  P.markGuided(st, 'e1');
  assert.equal(P.isDone(st, 'e1'), false);
  assert.ok(P.usedGuided(st, 'e1'));
  P.completeCorrect(st, 'e1', 10);
  assert.equal(P.outcomeOf(st, 'e1'), 'hinted');
  assert.equal(st.ex.e1.guided, true);
  assert.equal(P.migrate(JSON.parse(JSON.stringify(st))).ex.e1.guided, true);
  const plain = P.emptyState();
  P.completeCorrect(plain, 'e2', 10);
  assert.equal(P.outcomeOf(plain, 'e2'), 'alone');
});

test('progress: exam results feed the queue', () => {
  const st = P.emptyState();
  P.recordExamResult(st, 'ok', true, 1);
  P.recordExamResult(st, 'bad', false, 2);
  assert.equal(P.outcomeOf(st, 'ok'), 'alone');
  assert.equal(P.outcomeOf(st, 'bad'), 'review');
  assert.deepEqual(P.reviewQueue(st, ['ok', 'bad']), ['bad']);
});

test('examples/formulas loaders are defensive', () => {
  assert.deepEqual(cleanExamples(null), []);
  assert.deepEqual(cleanExamples({}), []);
  assert.equal(cleanExamples([{ id: 'a', topic: 't', title: 'x', steps: ['s'] }, { id: 'b' }, null]).length, 1);
  assert.deepEqual(cleanFormulas(null), {});
  assert.deepEqual(cleanFormulas({ topics: { a: {}, b: 3 } }), {});
  const f = cleanFormulas({ topics: { a: { title: 'T', sections: [{ heading: 'h', items: [] }, 7], mistakes: ['m', 5] } } });
  assert.equal(f.a.sections.length, 1);
  assert.deepEqual(f.a.mistakes, ['m']);
  assert.equal(revealNext(0, 3), 1);
  assert.equal(revealNext(3, 3), 3);
});

test('sanitizeHtml keeps formula markup and drops active content', () => {
  assert.equal(sanitizeHtml('x<sup>2</sup> <span dir="ltr">a+b</span>'), 'x<sup>2</sup> <span dir="ltr">a+b</span>');
  assert.equal(sanitizeHtml('<img src=x onerror=alert(1)>hi'), 'hi');
  assert.equal(sanitizeHtml('<script>alert(1)</script>ok'), 'ok');
  assert.equal(sanitizeHtml('<span onclick="x()" dir=ltr>a</span>'), '<span dir="ltr">a</span>');
  assert.equal(sanitizeHtml('a < b'), 'a &lt; b');
  assert.equal(sanitizeHtml(null), '');
});

test('bidi: formula titles are isolated, Hebrew stays outside', () => {
  const t = isolateFormulas('x² + y² ו·xy – ארבעה פתרונות');
  assert.ok(t.includes('⁦x² + y²⁩'), t);
  assert.ok(t.includes('⁦xy⁩'), t);
  assert.ok(t.includes('ארבעה פתרונות') && !/⁦[^⁩]*ארבעה/.test(t));
  assert.equal(isolateFormulas('מערכת פשוטה'), 'מערכת פשוטה');
  assert.equal(isolateFormulas('תרגיל 3 ו-4'), 'תרגיל 3 ו-4');
  assert.ok(isolateFormulas('v = 10 m/s בשנייה').includes('⁦v = 10 m/s⁩'));
  assert.equal(isolateFormulas('3–5 יח״ל'), isolateRanges('3–5 יח״ל'));
});

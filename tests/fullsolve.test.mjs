import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './fake-dom.mjs';

const dom = installFakeDom();
const S = await import('../js/fullsolve-ui.js');
const store = await import('../js/store.js');
const B = await import('../js/backup.js');
const N = await import('../js/nav.js');

const load = (f) => JSON.parse(readFileSync(new URL('../data/' + f, import.meta.url), 'utf8'));
const exercises = [...load('math.json'), ...load('physics.json')];
const TOPICS = [{ id: 'math-3', title: 'מערכת משוואות עם 3 נעלמים' }, { id: 'math-4', title: 'מערכת משוואות עם 4 נעלמים' },
  { id: 'phys-vertical', title: 'תנועה אנכית' }, { id: 'phys-horizontal', title: 'תנועה אופקית' }];
const ctx = { show: dom.show, exercises, topics: TOPICS, byId: (id) => exercises.find((e) => e.id === id), rnd: () => 0.5 };
const reset = () => { dom.store.clear(); store.resetCache(); dom.root.replaceChildren(); };

test('calibration classification', () => {
  assert.equal(S.classify(false, true), 'sure-wrong');
  assert.equal(S.classify(true, true), 'sure-right');
  assert.equal(S.classify(true, false), 'unsure-right');
  assert.equal(S.classify(false, false), 'unsure-wrong');
  const c = S.calibration([{ correct: false, confident: true }, { correct: false, confident: true }, { correct: true, confident: false }]);
  assert.deepEqual(c, { 'sure-right': 0, 'sure-wrong': 2, 'unsure-right': 1, 'unsure-wrong': 0 });
  assert.equal(S.calibrationLine([]), null);
});

test('rubric: one row per solution step, generic 4 lines otherwise; percent', () => {
  assert.equal(S.rubricItems({ solution: ['a', 'b', 'c'] }).length, 3);
  assert.equal(S.rubricItems({}).length, 4);
  assert.equal(S.rubricItems({ solution: [] }).length, 4);
  assert.equal(S.rubricPercent(1, 4), 25);
  assert.equal(S.rubricPercent(0, 0), 0);
});

test('surprise prefers wrong / not-alone exercises', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const outcome = (id) => ({ a: 'alone', b: 'alone', c: null }[id]);
  const log = [{ exerciseId: 'b', ts: 1, outcome: 'wrong' }];
  assert.equal(S.pickSurprise(list, log, outcome, () => 0.99).id, 'c');
  assert.equal(S.pickSurprise(list, log, outcome, () => 0.4).id, 'b'); // wrong (6) outweighs fresh (3)
  assert.equal(S.pickSurprise([], [], outcome), null);
});

test('conf storage sanitizes, caps and is in the backup allowlist', () => {
  assert.ok(S.CONF_KEY in B.KNOWN_KEYS);
  const d = S.sanitizeConf({ recs: [{ id: 'x', ts: 5, correct: 1, confident: true, seconds: -4, rubric: 250 }, { id: '' }, 7] });
  assert.deepEqual(d.recs, [{ id: 'x', ts: 5, correct: false, confident: true, seconds: 0, rubric: 100 }]);
  assert.deepEqual(S.sanitizeConf('junk'), { v: 1, recs: [] });
  reset();
  S.recordConf({ id: 'x', ts: 1, correct: true, confident: false, seconds: 3, rubric: null });
  const code = B.buildBackup(globalThis.localStorage, 1);
  assert.ok(JSON.parse(code).data[S.CONF_KEY]);
});

test('routes: resolveRoute knows solve and solve/<id>', () => {
  assert.deepEqual(N.resolveRoute('#/solve'), { name: 'solve', args: [] });
  assert.deepEqual(N.resolveRoute('#/solve/abc'), { name: 'solve', args: ['abc'] });
});

test('picker lists exercises and links to #/solve/<id>', () => {
  reset();
  S.viewSolveRoute(ctx);
  assert.match(dom.root.textContent, /הפתיעו אותי/);
  const links = dom.root.all((n) => n.tagName === 'A' && /^#\/solve\/./.test(n.getAttribute('href') || ''));
  assert.equal(links.length, exercises.length);
});

test('flow: validation, wrong answer, then correct answer record attempts, mistakes and confidence', () => {
  reset();
  const ex = exercises.find((e) => Array.isArray(e.inputs) && !e.answerSets && Array.isArray(e.solution) && e.solution.length);
  S.viewSolveRoute(ctx, ex.id);
  assert.match(dom.root.textContent, /כמו במבחן/);
  assert.ok(!dom.root.byText('button', 'רמז'), 'no hint buttons');
  const form = dom.root.querySelector('form');
  const submit = () => form.dispatch('submit');
  const inputs = dom.root.all((n) => n.tagName === 'INPUT' && n.getAttribute('type') === 'text');
  assert.equal(inputs.length, ex.inputs.length);

  submit(); // blank
  assert.match(dom.root.textContent, /הזינו תשובה סופית/);
  inputs.forEach((i) => { i.value = '999'; });
  submit(); // no confidence
  assert.match(dom.root.textContent, /בחרו קודם/);
  assert.equal(store.getAttempts().length, 0);

  dom.root.byText('button', 'בטוח').click();
  dom.clock.now += 65_000;
  submit();
  assert.match(dom.root.textContent, /שגויה/);
  assert.match(dom.root.textContent, /סומן לחזרה בעדיפות/);
  assert.match(dom.root.textContent, /1:05/);
  const att = store.getAttempts();
  assert.equal(att.length, 1);
  assert.equal(att[0].outcome, 'wrong');
  assert.equal(att[0].hintsUsed, 0);
  assert.deepEqual(store.reviewQueue([ex.id]), [ex.id]);
  assert.equal(S.loadConf().recs[0].confident, true);
  assert.equal(S.loadConf().recs[0].correct, false);

  // rubric: one checkbox per step, score is stored
  const boxes = dom.root.all((n) => n.tagName === 'INPUT' && n.getAttribute('type') === 'checkbox');
  assert.equal(boxes.length, ex.solution.length);
  boxes[0].checked = true; boxes[0].dispatch('change');
  assert.equal(S.loadConf().recs[0].rubric, Math.round(100 / ex.solution.length));
  submit(); // double submit ignored
  assert.equal(store.getAttempts().length, 1);

  // second visit, correct and unsure
  S.viewSolveRoute(ctx, ex.id);
  dom.root.all((n) => n.tagName === 'INPUT' && n.getAttribute('type') === 'text').forEach((i, k) => { i.value = String(ex.inputs[k].answer); });
  dom.root.byText('button', 'לא בטוח').click();
  dom.root.querySelector('form').dispatch('submit');
  assert.match(dom.root.textContent, /התשובה הסופית נכונה/);
  assert.equal(store.getAttempts()[1].outcome, 'alone');
  assert.equal(store.outcomeOf(ex.id), 'alone');
  assert.deepEqual(store.reviewQueue([ex.id]), []);
  assert.equal(S.calibration(S.loadConf().recs)['unsure-right'], 1);
});

test('unknown exercise id shows a not-found page; timer stops after submit', () => {
  reset();
  S.viewSolveRoute(ctx, 'nope');
  assert.match(dom.root.textContent, /לא נמצא/);
});

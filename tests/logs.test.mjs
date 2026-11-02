import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './fake-dom.mjs';
import { validate, verifyItem, loadAll, identityHolds } from '../tools/verify-logs.mjs';

const dom = installFakeDom();
const L = await import('../js/logs.js');
const M = await import('../js/mathhard.js');
const UI = await import('../js/logs-ui.js');
const nav = await import('../js/nav.js');
const fb = await import('../js/feedback.js');

const data = loadAll();
const clone = () => JSON.parse(JSON.stringify(data));
const fetchFn = async (u) => ({ ok: true, json: async () => JSON.parse(readFileSync(new URL('../' + u, import.meta.url), 'utf8')) });
const ctx = { topics: [], exercises: [], byId: () => null, show: dom.show, fetchFn };
const press = (label) => dom.root.all((n) => n.tagName === 'BUTTON' && !n.disabled && n.textContent === label)[0].dispatch('click');
const boxes = () => dom.root.all((n) => n.tagName === 'INPUT' && !n.disabled);

test('verifier: every lesson example, quiz item, rule, card and exercise is verified numerically', () => {
  const { errors, stats } = validate(data);
  assert.deepEqual(errors, []);
  assert.equal(stats.lessons, 12);
  assert.equal(stats.cards, 10);
  assert.ok(stats.exercises >= 70);
  assert.ok(stats.examples >= 24 && stats.quiz === 36);
  for (const t of [1, 2, 3, 4, 5]) assert.ok(stats.byTier[t] >= 12);
  assert.ok(stats.byCheck.param >= 3 && stats.byCheck.system >= 4 && stats.byCheck.ineq >= 8);
});

test('verifier fails on a wrong equation answer, domain, inequality, system point, parameter set, quiz option and card', () => {
  // lessons / cards are re-validated whole (fast); only the exercises that were edited are re-verified (the full set takes ~10 s)
  const run = (mutate) => {
    const d = clone();
    mutate(d);
    const errs = validate({ ...d, exercises: [] }).errors;
    d.exercises.forEach((e, i) => { if (JSON.stringify(e) !== JSON.stringify(data.exercises[i])) verifyItem(e, (m) => errs.push(m)); });
    return errs;
  };
  const ex = (d, id) => d.exercises.find((e) => e.id === id);
  assert.ok(run((d) => { ex(d, 'lg-3-02').answer.values = ['-2', '4']; }).some((m) => m.startsWith('lg-3-02')));
  assert.ok(run((d) => { ex(d, 'lg-3-02').domain.set = '(0,inf)'; }).some((m) => m.startsWith('lg-3-02')));
  assert.ok(run((d) => { ex(d, 'lg-4-02').answer.text = '(3/2,7/2)'; }).some((m) => m.startsWith('lg-4-02')));
  assert.ok(run((d) => { ex(d, 'lg-4-02').answer.text = '[7/2,inf)'; }).some((m) => m.startsWith('lg-4-02')));
  assert.ok(run((d) => { ex(d, 'lg-5-04').answer.points.push(['-6', '-2']); }).some((m) => m.startsWith('lg-5-04')));
  assert.ok(run((d) => { ex(d, 'lg-5-03').answer.points = [['4', '8']]; }).some((m) => m.startsWith('lg-5-03')));
  assert.ok(run((d) => { ex(d, 'lg-4-12').answer.text = '(-inf,2]'; }).some((m) => m.startsWith('lg-4-12')));
  assert.ok(run((d) => { ex(d, 'lg-2-06').answer.value = '3/5'; }).some((m) => m.startsWith('lg-2-06')));
  assert.ok(run((d) => { d.lessons[0].quiz[0].ans = 0; }).some((m) => m.includes('quiz')));
  assert.ok(run((d) => { d.lessons[0].examples[0].answer.value = '4'; }).some((m) => m.startsWith('what/')));
  assert.ok(run((d) => { d.cards[3].ver = 'log_a(x+y) = log_a(x) + log_a(y)'; }).some((m) => m.startsWith('card c-prod')));
  assert.ok(run((d) => { d.lessons[6].rules[1].ver = 'log_a(x^2) = 2*log_a(x)'; }).some((m) => m.includes('not an identity')), 'log(x^2) = 2 log x fails for negative x');
  assert.ok(run((d) => { ex(d, 'lg-3-02').trap.extraneous = ['4']; }).some((m) => m.includes('trap value 4')));
});

test('identity checker: laws hold, common mistakes do not', () => {
  assert.ok(identityHolds('log_a(x*y) = log_a(x) + log_a(y)').ok);
  assert.ok(identityHolds('log_a(x) = log_b(x) / log_b(a)').ok);
  assert.ok(!identityHolds('log_a(x+y) = log_a(x) + log_a(y)').ok);
  assert.ok(!identityHolds('log_a(x/y) = log_a(x) / log_a(y)').ok);
  assert.ok(identityHolds('log_a(x^2) = 2*log_a(|x|)', true).ok);
  assert.ok(!identityHolds('log_a(x^2) = 2*log_a(x)', true).ok);
});

test('log syntax: base / argument rules and notations', () => {
  const v = (s, vars = {}) => M.evalExact(L.lx(s), vars);
  assert.equal(L.lx('log_2(8)'), 'log(2;8)');
  assert.equal(L.lx('log_(1/2)(8)'), 'log(1/2;8)');
  assert.equal(L.lx('lg(x)'), 'log(10;x)');
  assert.ok(Math.abs(v('log_2(8)') - 3) < 1e-12);
  assert.ok(Math.abs(v('log_(1/2)(8)') + 3) < 1e-12);
  assert.ok(Math.abs(v('lg(1000)') - 3) < 1e-12);
  assert.ok(Math.abs(v('ln(x)', { x: 1 })) < 1e-12);
  assert.ok(Math.abs(v('3 + log_x(9)', { x: 3 }) - 5) < 1e-12);
  assert.ok(Number.isNaN(v('log_2(-8)')));
  assert.ok(Number.isNaN(v('log_1(5)')));
  assert.ok(Number.isNaN(v('log_(-2)(4)')));
  assert.ok(Number.isNaN(v('log_2(0)')));
  assert.equal(M.evalExact('2+3*4'), 14, 'the shared parser still works for plain expressions');
});

test('data shape: 70+ exercises in 5 tiers, 2 hints, Hebrew method cards, 12 lessons with 3 quiz items each', () => {
  assert.equal(L.TIERS.length, 5);
  for (const t of L.TIERS) { assert.ok(t.method.length >= 3); assert.ok(data.exercises.filter((e) => e.tier === t.id).length >= 12); }
  assert.ok(data.exercises.every((e) => L.validExercise(e) && e.hints.length === 2 && e.steps.length >= 3));
  assert.ok(data.exercises.filter((e) => e.trap).length >= 20);
  assert.ok(data.exercises.every((e) => !e.wrongs || e.wrongs.every((w) => /[א-ת]/.test(w.msg))));
  assert.equal(new Set(data.exercises.map((e) => e.id)).size, data.exercises.length);
  assert.ok(data.lessons.every((l) => L.validLesson(l) && l.examples.length >= 2 && l.examples.length <= 3 && l.quiz.length === 3));
  assert.deepEqual(data.lessons.map((l) => l.id), ['what', 'eye', 'domain', 'special', 'product', 'quotient', 'power', 'base', 'notation', 'equations', 'expo', 'ineq']);
});

test('routes, feedback mode, hub and home links, cache version', () => {
  assert.deepEqual(nav.resolveRoute('#/logs/ex/lg-1-01'), { name: 'logs', args: ['ex', 'lg-1-01'] });
  assert.equal(nav.activeTab('#/logs'), 'practice');
  assert.ok(fb.MODES.includes('logs'));
  assert.equal(fb.sanitizeRecord({ exerciseId: 'lg-1-01', mode: 'logs', rating: 4 }).mode, 'logs');
  dom.show();
  nav.viewHub(ctx);
  assert.ok(dom.root.all((n) => n.attrs && n.attrs.href === '#/logs').length >= 1);
  dom.show();
  nav.viewHome({ ...ctx, topics: [], exercises: [] });
  assert.ok(dom.root.all((n) => n.attrs && n.attrs.href === '#/logs').length >= 1);
});

test('UI: hub, lesson list, a full lesson page with examples, mistake box and quiz', async () => {
  await UI.viewLogsRoute(ctx);
  assert.match(dom.root.textContent, /לוגריתמים מהיסוד/);
  await UI.viewLogsRoute(ctx, 'learn');
  assert.match(dom.root.textContent, /מהו לוגריתם/);
  await UI.viewLogsRoute(ctx, 'learn', 'power');
  const t = dom.root.textContent;
  assert.match(t, /דוגמה 1/);
  assert.match(t, /דוגמה 3/);
  assert.match(t, /טעות נפוצה/);
  assert.match(t, /בדקו את עצמכם/);
  assert.match(t, /המלכודת: log\(x²\) = 4|המלכודת/);
  press('הצעד הבא');
  assert.match(dom.root.textContent, /צעד 1\./);
  const opt = dom.root.all((n) => n.tagName === 'BUTTON' && n.textContent === '10')[0];
  opt.dispatch('click');
  assert.match(dom.root.textContent, /נכון!/);
  await UI.viewLogsRoute(ctx, 'learn', 'nope');
  assert.match(dom.root.textContent, /שיעורים/);
});

test('UI: flashcards use Leitner boxes, wrong cards come back, state is saved under its own key', async () => {
  dom.store.clear();
  await UI.viewLogsRoute(ctx, 'cards');
  assert.match(dom.root.textContent, /כסו את התשובה/);
  press('הצג תשובה');
  press('לא ידעתי ✗');
  const saved = JSON.parse(dom.store.get(L.LOGS_KEY));
  assert.equal(Object.keys(saved.cards).length, 1);
  assert.equal(Object.values(saved.cards)[0].box, 0);
  assert.equal(Object.values(saved.cards)[0].lapses, 1);
  for (let i = 0; i < 40 && /הצג תשובה/.test(dom.root.textContent); i++) { press('הצג תשובה'); press('ידעתי ✓'); }
  assert.match(dom.root.textContent, /סיימנו/);
  assert.match(dom.root.textContent, /כמה היה קשה/);
  await UI.viewLogsRoute(ctx, 'cards');
  assert.match(dom.root.textContent, /אין כרטיסים לתרגול|כסו/);
});

test('UI: practice list shows 5 method cards; wrong then right answer records progress and feedback', async () => {
  await UI.viewLogsRoute(ctx, 'practice');
  assert.equal(dom.root.all((n) => n.tagName === 'SUMMARY' && n.textContent === 'כרטיס שיטה').length, 5);
  await UI.viewLogsRoute(ctx, 'ex', 'lg-1-06');
  assert.match(dom.root.textContent, /בסיס נעלם/);
  boxes()[0].value = '-7';
  boxes()[1].value = '7';
  press('בדיקה');
  assert.match(dom.root.textContent, /כללתם את -7/);
  press('הצגת התחום');
  assert.match(dom.root.textContent, /שלב התחום/);
  boxes()[0].value = '7';
  boxes()[1].value = '';
  press('בדיקה');
  assert.match(dom.root.textContent, /נכון!/);
  assert.match(dom.root.textContent, /כמה היה קשה/);
  const it = M.loadSaved().items['lg-1-06'];
  assert.equal(it.solved, true);
  assert.equal(it.alone, false);
});

test('UI: interval, points and value answers are graded; show-solution path records an unsolved attempt', async () => {
  await UI.viewLogsRoute(ctx, 'ex', 'lg-4-02');
  const ins = boxes();
  ins[0].value = '3/2';
  ins[1].value = '7/2';
  dom.root.all((n) => n.tagName === 'BUTTON' && n.textContent === ')')[0].dispatch('click'); // -> ]
  press('בדיקה');
  assert.match(dom.root.textContent, /נכון!/);
  await UI.viewLogsRoute(ctx, 'ex', 'lg-5-03');
  const p = boxes();
  p[0].value = '4'; p[1].value = '8'; p[2].value = '8'; p[3].value = '4';
  press('בדיקה');
  assert.match(dom.root.textContent, /נכון!/);
  await UI.viewLogsRoute(ctx, 'ex', 'lg-2-06');
  boxes()[0].value = '5/3';
  press('בדיקה');
  assert.match(dom.root.textContent, /נכון!/);
  await UI.viewLogsRoute(ctx, 'ex', 'lg-3-05');
  press('הצגת פתרון מלא');
  assert.match(dom.root.textContent, /פתרון/);
  assert.match(dom.root.textContent, /מלכודת/);
  assert.equal(M.loadSaved().items['lg-3-05'].solved, false);
  await UI.viewLogsRoute(ctx, 'ex', 'missing');
  assert.match(dom.root.textContent, /תרגילים/);
});

test('load failure shows a retry button', async () => {
  L.resetLogsCache();
  const bad = { ...ctx, fetchFn: async () => ({ ok: false, status: 500 }) };
  await UI.viewLogsRoute(bad);
  assert.match(dom.root.textContent, /לא ניתן לטעון/);
  press('נסו שוב');
  L.resetLogsCache();
});

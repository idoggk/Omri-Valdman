import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.mjs';

const dom = installFakeDom();
const S = await import('../js/sprint.js');
const UI = await import('../js/sprint-ui.js');
const store = await import('../js/store.js');
const B = await import('../js/backup.js');
const SRS = await import('../js/srs.js');
const E = await import('../js/engine.js');
const C = await import('../js/ceiling.js');
const N = await import('../js/nav.js');
const { verifyAll } = await import('../tools/verify-sprint.mjs');

const fake = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } }; };
const item = (kind, answer, extra = {}) => ({ id: 't', kind, answer, ref: answer, vars: { x: [-6, 6] }, ...extra });
const ok = (it, text) => { const r = S.checkSprintAnswer(it, text); return r.valid && r.correct; };

test('verifier: 2000 generated items across seeds are all correct (independent evaluator)', () => {
  const r = verifyAll(2000);
  assert.deepEqual(r.errs, []);
  assert.equal(Object.keys(r.counts).length, 27);
});

test('generators are deterministic and seeds differ', () => {
  for (const f of S.FAMILIES) for (const l of [1, 2, 3]) {
    assert.deepEqual(S.makeItem(f.id, l, 42), S.makeItem(f.id, l, 42));
    const ids = new Set(Array.from({ length: 25 }, (_, i) => { const x = S.makeItem(f.id, l, i + 1); return `${x.prompt}|${x.math}`; }));
    assert.ok(ids.size > 5, `${f.id} level ${l} varies`);
  }
  assert.throws(() => S.makeItem('nope', 1, 1));
  assert.equal(S.makeItem('factor', 99, 1).level, 3);
});

test('checker: equivalent forms pass, near-misses fail', () => {
  const fac = item('factored', '(x+2)*(x+3)');
  assert.ok(ok(fac, '(x+3)(x+2)') && ok(fac, '(x + 2) * (x + 3)'));
  assert.ok(!ok(fac, 'x^2+5x+6'), 'expanded form is not factored');
  assert.ok(!ok(fac, '(x+2)(x+4)') && !ok(fac, '(x-2)(x-3)'));
  const sq = item('factored', '(x+3)*(x+3)');
  assert.ok(ok(sq, '(x+3)^2'));
  const frac = item('frac', '2/3');
  assert.ok(ok(frac, '2/3') && ok(frac, ' 2 / 3 '));
  assert.equal(S.checkSprintAnswer(frac, '4/6').correct, false);
  assert.match(S.checkSprintAnswer(frac, '4/6').note, /לא מצומצם/);
  assert.ok(!ok(frac, '0.6667') && !ok(frac, '0.66666666666'));
  const surd = item('surd', '6*sqrt(2)');
  assert.ok(ok(surd, '6sqrt(2)') && ok(surd, '6*√2'.replace('√2', 'sqrt(2)')) && ok(surd, 'sqrt(2)*6'));
  assert.ok(!ok(surd, 'sqrt(72)') && !ok(surd, '3*sqrt(8)'));
  assert.ok(!ok(item('surd', '2*sqrt(3)'), '6'));
  const roots = item('roots', '-3, 2');
  assert.ok(ok(roots, '2, -3') && ok(roots, 'x=2; x=-3') && ok(roots, '-3 2'));
  assert.ok(!ok(roots, '2') && !ok(roots, '3, -2') && !ok(roots, '2, 2'));
  assert.ok(ok(item('roots', '3'), '3, 3'));
  const ineq = item('ineq', 'x>3');
  assert.ok(ok(ineq, 'x>3') && ok(ineq, '3<x') && ok(ineq, 'x > 3'));
  assert.ok(!ok(ineq, 'x<3') && !ok(ineq, 'x>=3') && !ok(ineq, 'x>-3'));
  assert.ok(ok(item('ineq', 'x<=-2'), 'x≤-2') && ok(item('ineq', 'x<=-2'), '-2>=x'));
  const num = item('num', '-3/2');
  assert.ok(ok(num, '-1.5') && ok(num, 'x=-3/2') && ok(num, '−3/2'));
  assert.ok(!ok(num, '3/2') && !ok(num, '-1.4'));
  const re = item('expr', '(v^2-v0^2)/(2*a)', { vars: { v: [3, 9], v0: [1, 4], a: [1, 5] }, target: 'x' });
  assert.ok(ok(re, '(v^2-v0^2)/(2a)') && ok(re, 'x = (v^2 - v0^2)/(2*a)') && ok(re, '0.5*(v^2-v0^2)/a'));
  assert.ok(!ok(re, '(v^2+v0^2)/(2a)'));
  assert.equal(S.checkSprintAnswer(re, 'x/2').valid, false, 'the target variable is not allowed in the answer');
  const poly = item('poly', 'x+3');
  assert.ok(ok(poly, 'x+3') && !ok(poly, '(x^2-9)/(x-3)'));
  const single = item('singlefrac', '(5*x-16)/((x-2)*(x-5))', { vars: { x: [-9, 9] } });
  assert.ok(ok(single, '(5x-16)/((x-2)(x-5))') && !ok(single, '2/(x-2)+3/(x-5)'));
  assert.ok(ok(item('mono', 'x^7', { vars: { x: [1.2, 4] } }), 'x^7') && !ok(item('mono', 'x^7', { vars: { x: [1.2, 4] } }), 'x^3*x^4'));
});

test('unreadable input is invalid, not wrong', () => {
  for (const [it, bad] of [[item('num', '3'), 'abc'], [item('num', '3'), ''], [item('roots', '1, 2'), 'x'], [item('ineq', 'x>3'), '3'], [item('frac', '1/2'), '1/0']]) {
    const r = S.checkSprintAnswer(it, bad);
    assert.equal(r.valid, false, `${it.kind} "${bad}"`);
    assert.ok(r.error);
  }
});

test('scoring: correct per minute and accuracy', () => {
  assert.deepEqual(S.scoreSet({ correct: 12, wrong: 3, skipped: 2, dur: 120 }), { correct: 12, wrong: 3, skipped: 2, dur: 120, cpm: 6, acc: 0.8 });
  assert.equal(S.scoreSet({ correct: 20, wrong: 0, dur: 300 }).cpm, 4);
  assert.equal(S.scoreSet({ correct: 0, wrong: 0, dur: 120 }).acc, 0);
});

test('adaptivity: a level up needs 5 results at 85%+, a drop 4 results at 50% or less, per family', () => {
  const s = S.emptySaved();
  for (let i = 0; i < 4; i++) assert.equal(S.adapt(s, 'factor', true), null);
  assert.equal(S.adapt(s, 'factor', true), 'up');
  assert.equal(S.levelOf(s, 'factor'), 2);
  assert.equal(S.levelOf(s, 'lineq'), 1, 'other families untouched');
  assert.equal(S.adapt(s, 'factor', false), null);
  assert.equal(S.adapt(s, 'factor', false), null);
  assert.equal(S.adapt(s, 'factor', false), null);
  assert.equal(S.adapt(s, 'factor', false), 'down');
  assert.equal(S.levelOf(s, 'factor'), 1);
  for (let i = 0; i < 6; i++) S.adapt(s, 'factor', false);
  assert.equal(S.levelOf(s, 'factor'), 1, 'never below 1');
  const t = S.emptySaved();
  t.levels.quadeq = 3;
  for (let i = 0; i < 12; i++) S.adapt(t, 'quadeq', true);
  assert.equal(S.levelOf(t, 'quadeq'), 3, 'never above 3');
  const u = S.emptySaved();
  for (let i = 0; i < 5; i++) S.adapt(u, 'ineq', i % 2 === 0);
  assert.equal(S.levelOf(u, 'ineq'), 1, '60% neither promotes nor demotes');
});

test('session: seeded family order, answers, skips and the end summary', () => {
  const a = S.newSession({ seed: 7 });
  const b = S.newSession({ seed: 7 });
  assert.deepEqual(a.order, b.order);
  assert.equal(new Set(a.order).size, 9);
  assert.equal(S.newSession({ seed: 1, family: 'lineq' }).order.length, 1);
  const sess = S.newSession({ seed: 3, family: 'lineq', saved: S.emptySaved() });
  const first = S.currentItem(sess);
  assert.equal(S.submitAnswer(sess, 'zzz').valid, false);
  assert.equal(sess.results.length, 0);
  assert.equal(S.currentItem(sess).id, first.id, 'still the same item after unreadable input');
  const r1 = S.submitAnswer(sess, first.answer, 4);
  assert.equal(r1.correct, true);
  assert.equal(r1.result.seconds, 4);
  const second = S.currentItem(sess);
  assert.notEqual(second.id, first.id);
  const r2 = S.submitAnswer(sess, second.wrong[0], 6);
  assert.equal(r2.correct, false);
  assert.equal(r2.expected, second.answer);
  S.skipItem(sess, 2);
  const out = S.finishSession(sess, 5000);
  assert.deepEqual([out.score.correct, out.score.wrong, out.score.skipped], [1, 1, 1]);
  assert.equal(out.score.cpm, 0.5);
  assert.equal(out.isBest, false, '50% accuracy cannot set a record');
  assert.equal(sess.saved.history.length, 1);
});

test('personal bests need accuracy and beat the previous best of the same length', () => {
  const run = (nCorrect, nWrong, dur, saved) => {
    const sess = S.newSession({ seed: 5, family: 'lineq', dur, saved });
    for (let i = 0; i < nCorrect; i++) S.submitAnswer(sess, S.currentItem(sess).answer);
    for (let i = 0; i < nWrong; i++) S.submitAnswer(sess, S.currentItem(sess).wrong[0]);
    return S.finishSession(sess, 1000 + i0++);
  };
  let i0 = 0;
  const saved = S.emptySaved();
  assert.equal(run(10, 0, 120, saved).isBest, true);
  assert.equal(saved.best[120].cpm, 5);
  assert.equal(run(8, 0, 120, saved).isBest, false);
  assert.equal(run(20, 15, 120, saved).isBest, false, 'higher speed but 57% accuracy');
  const better = run(14, 1, 120, saved);
  assert.equal(better.isBest, true);
  assert.equal(better.previousBest.cpm, 5);
  assert.equal(run(10, 0, 300, saved).isBest, true, 'the 5-minute best is separate');
  assert.equal(saved.best[300].cpm, 2);
  assert.ok(saved.history.length <= S.HISTORY_CAP);
});

test('persistence: sanitize, round trip and backup key', () => {
  assert.deepEqual(S.sanitizeSaved(null), S.emptySaved());
  assert.deepEqual(S.sanitizeSaved({ levels: { factor: 9, lineq: 2, bogus: 3 }, recent: { factor: [1, 'x', 0] }, history: 'nope', best: { 120: { cpm: -4 } } }).levels, { lineq: 2 });
  const clean = S.sanitizeSaved({ levels: { factor: 2 }, recent: { factor: [1, 'x', 0] }, history: [{ ts: 1, dur: 7, mode: 'mixed', correct: 3 }, 5], best: { 120: { cpm: 4, acc: 2, ts: 3 } } });
  assert.deepEqual(clean.recent.factor, [1, 0]);
  assert.equal(clean.history.length, 1);
  assert.equal(clean.history[0].dur, 120);
  assert.equal(clean.best[120].acc, 1);
  const st = fake();
  const saved = S.emptySaved();
  saved.levels.factor = 3;
  S.saveSaved(saved, st);
  assert.equal(S.loadSaved(st).levels.factor, 3);
  st.setItem(S.KEY, '{broken');
  assert.deepEqual(S.loadSaved(st), S.emptySaved());
  assert.ok(S.KEY in B.KNOWN_KEYS);
  assert.ok(JSON.parse(B.buildBackup((() => { const s = fake(); S.saveSaved(saved, s); return s; })(), 10)).data[S.KEY]);
});

test('sprint attempts: own topic, reserved from mastery and review, titled and linked, with a fast ceiling budget', () => {
  assert.equal(S.sprintTopic('factor'), 'sprint-factor');
  assert.ok(SRS.isReservedTopic('sprint-factor'));
  assert.match(E.topicTitle('sprint-factor'), /פירוק/);
  assert.equal(E.topicHref('sprint-lineq'), '#/sprint');
  assert.equal(C.budgetOf('sprint-factor'), C.SPRINT_BUDGET);
  assert.equal(C.budgetOf('math-3'), 300);
  const log = [{ ts: 1, exerciseId: 'sp-factor-1-a', topic: 'sprint-factor', outcome: 'wrong' }];
  assert.deepEqual(SRS.dueReviews(log, 1e12), []);
  assert.ok(!SRS.withVirtual([], log).length);
});

test('routes and hub', () => {
  assert.equal(N.resolveRoute('#/sprint/run/120/factor').name, 'sprint');
  assert.deepEqual(N.resolveRoute('#/sprint/run/300/mixed').args, ['run', '300', 'mixed']);
  assert.ok(N.HUB_GROUPS.some((g) => g.id === 'more'));
});

test('screen: home, then a run records attempts under sprint-<family> and ends with the list', () => {
  dom.store.clear();
  store.resetCache();
  const ctx = { show: dom.show };
  UI.viewSprint(ctx, undefined);
  assert.match(dom.root.textContent, /ספרינטים באלגברה/);
  assert.ok(dom.root.all((n) => n.tagName === 'A' && (n.getAttribute('href') || '').startsWith('#/sprint/run/120/')).length >= 9);
  const sess = UI.viewSprint(ctx, 'run', '120', 'lineq');
  const text = () => dom.root.textContent.replace(/[⁦-⁩]/g, '');
  const input = dom.root.all((n) => n.tagName === 'INPUT')[0];
  const check = () => dom.root.all((n) => n.tagName === 'BUTTON' && n.textContent.trim() === 'בדיקה')[0];
  const first = S.currentItem(sess);
  input.value = 'nonsense';
  check().click();
  assert.equal(sess.results.length, 0);
  assert.match(text(), /לא הצלחתי לקרוא/);
  input.value = first.answer;
  check().click();
  assert.match(text(), /✓ נכון/);
  const second = S.currentItem(sess);
  input.value = second.wrong[0];
  check().click();
  assert.match(text(), /✗ לא נכון/);
  assert.equal(dom.store.get('omri-study-attempts-v1'), undefined, 'no per-item rows while the set runs');
  assert.equal(JSON.parse(dom.store.get(S.KEY)).recent.lineq.length, 2);
  dom.clock.now += 121_000;
  check().click(); // time is up: the click ends the set instead of counting
  assert.match(text(), /סיימנו/);
  assert.match(text(), /נכונות ב־2 דקות/);
  const saved = JSON.parse(dom.store.get(S.KEY));
  assert.equal(saved.history.length, 1);
  assert.deepEqual(saved.history[0].items.map((x) => [x[0], x[1]]), [['lineq', 1], ['lineq', 0]], 'per-item detail stays in the sprint store');
  const log = JSON.parse(dom.store.get('omri-study-attempts-v1'));
  assert.equal(log.length, 1, 'one aggregated row per set');
  assert.deepEqual([log[0].topic, log[0].items, log[0].correct, log[0].score, log[0].outcome], ['sprint-lineq', 2, 1, 0.5, 'wrong']);
});

test('log capacity: 60 simulated sets add 60 rows (not thousands), and sprint rows never evict real history', () => {
  let log = [];
  for (let i = 0; i < 5000 - 60; i++) log.push({ exerciseId: `ex-${i}`, ts: 1000 + i, outcome: 'alone', hintsUsed: 0, seconds: 30 });
  const real = log.length;
  for (let n = 0; n < 60; n++) {
    const sess = S.newSession({ seed: n + 1, dur: n % 2 ? 300 : 120, family: n % 3 ? 'mixed' : 'lineq' });
    for (let k = 0; k < 40; k++) {
      const item = S.currentItem(sess);
      if (k % 5) S.submitAnswer(sess, item.answer, 3); else S.skipItem(sess, 3);
    }
    const row = S.setAttempt(sess, 10_000 + n);
    assert.equal(row.items, 40);
    log.push(SRS.makeAttempt(row));
  }
  assert.equal(log.length, 5000);
  assert.equal(new Set(log.map((a) => a.exerciseId)).size, 5000);
  // 600 more sets would overflow the cap: only sprint rows go
  for (let n = 60; n < 660; n++) log.push(SRS.makeAttempt({ exerciseId: `sprint-mixed-${n}-120`, topic: 'sprint-mixed', ts: 10_000 + n, outcome: 'alone', items: 30, correct: 30, seconds: 100 }));
  const out = SRS.compactLog(log);
  assert.ok(out.length <= SRS.MAX_LOG_ROWS);
  assert.equal(out.filter((a) => !a.topic).length, real, 'every real row kept');
  assert.ok(out.filter((a) => a.topic === 'sprint-mixed').some((a) => a.exerciseId === 'sprint-mixed-659-120'), 'newest sprint rows kept');
  assert.ok(!out.some((a) => a.exerciseId === 'sprint-mixed-60-120'), 'oldest sprint rows dropped first');
  // a log that is all real rows still compacts as before
  const allReal = Array.from({ length: 5100 }, (_, i) => ({ exerciseId: `r-${i}`, ts: i, outcome: 'alone', hintsUsed: 0, seconds: 1 }));
  assert.ok(SRS.compactLog(allReal).length <= SRS.MAX_LOG_ROWS);
});

test('cleanup', () => dom.restore());

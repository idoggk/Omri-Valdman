import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.mjs';
import { validate, loadAll } from '../tools/verify-mathhard.mjs';

const dom = installFakeDom();
const M = await import('../js/mathhard.js');
const UI = await import('../js/mathhard-ui.js');
const nav = { ...(await import('../js/nav.js')), ...(await import('../js/hub.js')) }; // hub.js is loaded lazily by the app
const fb = await import('../js/feedback.js');

const data = loadAll();
const byId = (id) => data.find((e) => e.id === id);
const fetchFn = async (u) => ({ ok: true, json: async () => JSON.parse((await import('node:fs')).readFileSync(new URL('../' + u, import.meta.url), 'utf8')) });
const ctx = { topics: [], exercises: [], byId: () => null, show: dom.show, fetchFn };

test('verifier: all exercises verified numerically (statement, domain, answer, traps)', () => {
  const { errors, stats } = validate(data);
  assert.deepEqual(errors, []);
  assert.ok(stats.exercises >= 40);
});

test('verifier fails on a wrong answer, a wrong domain and a wrong statement', () => {
  const clone = (id) => JSON.parse(JSON.stringify(byId(id)));
  const badAns = clone('mh-rat-1'); badAns.answer.text = '[2,7/2]';
  const badDom = clone('mh-rat-1'); badDom.domain.set = '(-inf,inf)';
  const badEq = clone('mh-rat-1'); badEq.eq = ['(x+1)/(x−2) ≥ 4'];
  const badSet = clone('mh-rad-3'); badSet.answer.values = ['2', '-3/4'];
  for (const e of [badAns, badDom, badEq, badSet]) {
    const { errors } = validate([e]);
    assert.ok(errors.some((m) => m.startsWith(e.id)), JSON.stringify(e.eq));
  }
});

test('data shape: 5 families x 3 tiers, 2 hints, Hebrew method cards', () => {
  assert.equal(M.FAMILIES.length, 5);
  for (const f of M.FAMILIES) {
    assert.ok(f.method.length >= 3);
    for (const t of M.TIERS) assert.ok(data.some((e) => e.family === f.id && e.tier === t.id), `${f.id}/${t.id}`);
  }
  for (const e of data) assert.equal(e.hints.length, 2);
  assert.ok(data.filter((e) => e.trap).length >= 15);
});

test('expression parser: precedence, implicit product, roots, powers, abs', () => {
  assert.equal(M.evalExact('2+3*4'), 14);
  assert.equal(M.evalExact('-2^2'), -4);
  assert.equal(M.evalExact('2sqrt(9)'), 6);
  assert.equal(M.evalExact('√16 + ∛8'), 6);
  assert.equal(M.evalExact('(1/4)^(3/2)'), 0.125);
  assert.equal(M.evalExact('3x+1', { x: 2 }), 7);
  assert.equal(M.evalExact('|x−2|', { x: -1 }), 3);
  assert.ok(Number.isNaN(M.evalExact('(-8)^(1/3)')));
  assert.throws(() => M.evalExact('2+'));
  assert.throws(() => M.evalExact('2 $ 3'));
});

test('relations: tolerance and undefined values', () => {
  const r = M.parseRelation('1/(x−2) ≥ 1');
  assert.equal(M.holds(r, { x: 3 }), true);
  assert.equal(M.holds(r, { x: 2 }), false);
  assert.equal(M.holds(M.parseRelation('x < 1'), { x: 1 }), false);
  assert.equal(M.holds(M.parseRelation('x ≤ 1'), { x: 1 }), true);
});

test('intervals: parse, merge, membership, complement', () => {
  const u = M.normUnion(M.parseIntervals('(-inf,-1) U [-1,2] U (2,5) U (7,7]'));
  assert.deepEqual(u.map((p) => [p.lo, p.hi, p.lc, p.hc]), [[-Infinity, 5, false, false]]);
  const v = M.normUnion(M.parseIntervals('(1,2) U (2,3)'));
  assert.equal(v.length, 2);
  assert.equal(M.inUnion(v, 2), false);
  assert.equal(M.inUnion(M.parseIntervals('(2,7/2]'), 3.5), true);
  assert.equal(M.inUnion(M.parseIntervals('(2,7/2]'), 2), false);
  const c = M.complementUnion(M.normUnion(M.parseIntervals('(-inf,-1] U [4,inf)')));
  assert.deepEqual(c.map((p) => [p.lo, p.hi, p.lc, p.hc]), [[-1, 4, false, false]]);
  assert.deepEqual(M.normUnion(M.parseIntervals('{3}')).map((p) => [p.lo, p.hi]), [[3, 3]]);
  assert.throws(() => M.parseIntervals('2,3'));
});

test('grading: sets, points, intervals, number; open/closed matters', () => {
  const g = (id, input) => {
    const e = byId(id);
    const r = M.studentCanon(e.answer.kind, input);
    return r.ok ? M.sameCanon(r.canon, M.canonSpec(e.answer)) : r.error;
  };
  assert.equal(g('mh-rad-1', { rows: ['1', '-3'] }), true);
  assert.equal(g('mh-rad-1', { rows: ['1', ''] }), false);
  assert.equal(g('mh-rad-2', { rows: ['(-3-√17)/2', '(−3+sqrt(17))/2'] }), true);
  assert.equal(g('mh-rad-4', { rows: ['2*cbrt(2)'] }), true);
  assert.equal(g('mh-rat-1', { rows: [{ lc: false, lo: '2', hi: '3.5', hc: true }] }), true);
  assert.equal(g('mh-rat-1', { rows: [{ lc: true, lo: '2', hi: '7/2', hc: true }] }), false);
  assert.equal(g('mh-rat-6', { rows: [{ lc: false, lo: '-inf', hi: '-4', hc: false }, { lc: true, lo: '-2', hi: '3', hc: false }] }), true);
  assert.equal(g('mh-rat-6', { rows: [{ lc: false, lo: '-inf', hi: '-4', hc: false }, { lc: true, lo: '-2', hi: '1', hc: false }, { lc: false, lo: '1', hi: '3', hc: false }] }), false);
  assert.equal(g('mh-cir-2', { rows: [['-2', '-1'], ['3', '4']] }), true);
  assert.equal(g('mh-cir-2', { rows: [['3', '4']] }), false);
  assert.equal(g('mh-cir-4', { rows: ['3√2'] }), true);
  assert.equal(g('mh-par-1', { none: true }), false);
  assert.match(g('mh-rad-1', { rows: ['abc'] }), /לא הצלחנו/);
  assert.match(g('mh-rad-1', { rows: ['', ''] }), /הזינו/);
  assert.equal(M.studentCanon('set', { none: true }).canon.vals.length, 0);
});

test('diagnose: names the likely mistake (listed wrong answer, extra root, flipped sign, closure)', () => {
  const run = (id, input) => {
    const e = byId(id);
    return M.diagnose(e, M.studentCanon(e.answer.kind, input).canon, M.canonSpec(e.answer), M.FAMILIES.find((f) => f.id === e.family));
  };
  assert.match(run('mh-rad-3', { rows: ['2', '-3/4'] }), /הצבה/);
  assert.match(run('mh-exp-2', { rows: [{ lo: '-inf', hi: '2-sqrt(7)' }, { lo: '2+sqrt(7)', hi: 'inf' }] }), /הבסיס 1\/3/);
  assert.match(run('mh-rat-1', { rows: [{ lc: false, lo: '2', hi: '7/2', hc: false }] }), /סוגריים/);
  assert.match(run('mh-rat-3', { rows: [{ lo: '-inf', hi: '-7' }, { lo: '-1', hi: '2' }] }), /להפוך/);
  assert.match(run('mh-rad-1', { rows: ['5'] }), /./);
});

test('saved progress: sanitize + record (alone only without hints and wrong tries)', () => {
  assert.deepEqual(M.sanitizeSaved('junk'), { v: 1, items: {} });
  M.recordAttempt('mh-x', { solved: true, hints: 1, wrongs: 0 });
  assert.equal(M.loadSaved().items['mh-x'].alone, false);
  M.recordAttempt('mh-y', { solved: true, hints: 0, wrongs: 0 });
  assert.equal(M.loadSaved().items['mh-y'].alone, true);
  M.recordAttempt('mh-z', { solved: false, hints: 0, wrongs: 2 });
  assert.equal(M.loadSaved().items['mh-z'].solved, false);
});

test('routes + feedback mode + hub/home links', () => {
  assert.deepEqual(nav.resolveRoute('#/mathhard/mh-rad-1'), { name: 'mathhard', args: ['mh-rad-1'] });
  assert.equal(nav.activeTab('#/mathhard'), 'practice');
  assert.ok(fb.MODES.includes('mathhard'));
  assert.equal(fb.sanitizeRecord({ exerciseId: 'mh-rad-1', mode: 'mathhard', rating: 7 }).mode, 'mathhard');
  dom.show();
  nav.viewHub(ctx);
  assert.ok(dom.root.all((n) => n.attrs && n.attrs.href === '#/mathhard').length >= 1);
});

const press = (label) => dom.root.all((n) => n.tagName === 'BUTTON' && !n.disabled && n.textContent === label)[0].dispatch('click');
const boxes = () => dom.root.all((n) => n.tagName === 'INPUT' && !n.disabled);

test('UI: list shows method cards; wrong then right answer records and shows feedback card', async () => {
  await UI.viewMathHard(ctx);
  assert.match(dom.root.textContent, /כרטיס שיטה/);
  assert.match(dom.root.textContent, /משוואות ואי־שוויונות עם שורשים/);
  await UI.viewMathHard(ctx, 'mh-rad-3');
  boxes()[0].value = '2';
  boxes()[1].value = '-3/4';
  press('בדיקה');
  assert.match(dom.root.textContent, /לא מדויק/);
  assert.match(dom.root.textContent, /הצבה/);
  press('רמז 1');
  assert.match(dom.root.textContent, /רמז 1:/);
  boxes()[1].value = '';
  press('בדיקה');
  assert.match(dom.root.textContent, /נכון!/);
  assert.match(dom.root.textContent, /כמה היה קשה התרגיל/);
  const it = M.loadSaved().items['mh-rad-3'];
  assert.equal(it.solved, true);
  assert.equal(it.alone, false);
});

test('UI: interval answer with "no solution" style input and reveal-solution path', async () => {
  await UI.viewMathHard(ctx, 'mh-rat-1');
  const ins = boxes();
  ins[0].value = '2';
  ins[1].value = '7/2';
  const brackets = dom.root.all((n) => n.tagName === 'BUTTON' && ['(', ')'].includes(n.textContent));
  brackets[1].dispatch('click'); // right bracket -> ]
  press('בדיקה');
  assert.match(dom.root.textContent, /נכון!/);
  await UI.viewMathHard(ctx, 'mh-rat-2');
  press('הצגת פתרון מלא');
  assert.match(dom.root.textContent, /פתרון/);
  assert.equal(M.loadSaved().items['mh-rat-2'].solved, false);
});

test('step chain: a wrongly flipped displayed inequality line is caught', () => {
  const bad = JSON.parse(JSON.stringify(data));
  const e = bad.find((x) => x.id === 'mh-rat-8');
  e.steps[2] = e.steps[2].replace('(x + 4 − 3x − 3)/D ≥ 0', '(x + 4 − 3x − 3)/D ≤ 0');
  const { errors } = validate(bad);
  assert.ok(errors.some((m) => m.startsWith('mh-rat-8') && /not equivalent/.test(m)));
});

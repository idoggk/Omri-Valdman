import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './fake-dom.mjs';
import {
  fr, F, parseNum, toDecimal, decimals, equationRow, solveLinear, solveQuadratic, sqrtExact,
  checkItem, checkLadder, inlineItems, parseExpr, evalExact, linearForm,
} from '../tools/verify-ladder-math.mjs';

const dom = installFakeDom();
const L = await import('../js/ladder.js');
const U = await import('../js/ladder-ui.js');
const nav = await import('../js/nav.js');
const { renderExercise } = await import('../js/exercise-view.js');
const store = await import('../js/store.js');

const read = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const data = read('ladder-math.json');
const math = read('math.json');
const physicsLadder = read('ladder.json');
const physics = read('physics.json');
const stages = data.stages;
const clone = (x) => JSON.parse(JSON.stringify(x));
const inline = inlineItems(data);

// the shared fake DOM's replaceChildren() rejects plain strings, which the real DOM (and exercise-view.js) accepts
const Proto = Object.getPrototypeOf(document.createElement('x'));
const realReplace = Proto.replaceChildren;
Proto.replaceChildren = function (...kids) { return realReplace.apply(this, kids.map((k) => (typeof k === 'string' ? document.createTextNode(k) : k))); };

// ---------------------------------------------------------------- data
test('ladder-math.json: six stages, M1-M3 filled, M4-M6 "coming soon"', () => {
  assert.equal(data.v, 1);
  assert.deepEqual(stages.map((s) => s.id), ['M1', 'M2', 'M3', 'M4', 'M5', 'M6']);
  for (const s of stages) { assert.match(s.title, /[א-ת]/); assert.match(s.intro, /[א-ת]/); }
  assert.deepEqual(stages.slice(0, 3).map((s) => s.title), ['השיטה הבסיסית', 'שני נעלמים', 'שלושה נעלמים']);
  for (const id of ['M4', 'M5', 'M6']) {
    const s = stages.find((x) => x.id === id);
    assert.equal(s.items.length, 0);
    assert.match(s.soon, /בקרוב/);
  }
  for (const id of ['M1', 'M2', 'M3']) assert.ok(inline.filter((x) => x.stage === id).length >= 8, `${id} has at least 8 new items`);
  const refs = stages.flatMap((s) => s.items.filter((i) => i.ref).map((i) => i.ref));
  assert.equal(refs.length, 10);
  const byId = new Map(math.map((e) => [e.id, e]));
  for (const r of refs) { const e = byId.get(r); assert.ok(e && e.level <= 2 && e.topic === 'math-3' && e.verify.kind === 'unique', r); }
  assert.ok(stages[2].items.slice(0, 10).every((i) => i.ref), 'the pool exercises come first in M3');
});

test('every inline item: exactly re-solved, 3 tips, 3-5 lettered parts, Hebrew, no word problems, 2-decimal answers', () => {
  assert.deepEqual(checkLadder(data, math), []);
  assert.ok(inline.length >= 24);
  for (const { it } of inline) {
    assert.equal(it.tips.length, 3, it.id);
    assert.ok(it.inputs.length >= 3 && it.inputs.length <= 5, it.id);
    assert.ok(it.solution.length >= 4 && it.solution.some((s) => s.includes('✓') || s.includes('סעיף')), it.id);
    for (const inp of it.inputs) assert.ok(/^-?\d+(\.\d{1,2})?$/.test(inp.answer), `${it.id} ${inp.answer}`);
    assert.ok(!/\bkm|ק"מ|ש"ח|דקות|ילד|חנות/.test(it.statement), `${it.id}: no word problems`);
    assert.ok(!/<(?!\/?(span|br)\b)[a-z]/i.test(it.statement), it.id);
  }
  // all three sorts of M1 work and M3 includes fractions, decimals, brackets and variables on both sides
  assert.ok(inline.some((x) => x.it.verify.kind === 'eval') && inline.some((x) => x.it.verify.vars?.length === 1));
  const m3 = inline.filter((x) => x.stage === 'M3').map((x) => x.it.verify.eqs.join(' '));
  assert.ok(m3.some((e) => /\d\/\d|[a-z]\/\d/.test(e)) && m3.some((e) => /\d\.\d/.test(e)) && m3.some((e) => /\(/.test(e)));
  assert.ok(inline.some((x) => x.it.inputs.some((i) => Number(i.answer) < 0)) && inline.some((x) => x.it.inputs.some((i) => /\./.test(i.answer))));
});

// ---------------------------------------------------------------- the exact solver
test('exact arithmetic: fractions, decimals and the 2-decimal rule', () => {
  assert.deepEqual(parseNum('-0.25'), fr(-1n, 4n));
  assert.deepEqual(parseNum('3/6'), fr(1n, 2n));
  assert.equal(toDecimal(fr(5n, 2n)), '2.5');
  assert.equal(toDecimal(fr(-7n)), '-7');
  assert.equal(toDecimal(fr(1n, 3n)), null);
  assert.equal(decimals(fr(1n, 8n)), 3);
  assert.equal(decimals(fr(1n, 4n)), 2);
  assert.equal(decimals(fr(1n, 3n)), Infinity);
  assert.ok(F.eq(evalExact(parseExpr('0.1+0.2'), {}), parseNum('0.3')), 'no binary rounding');
  assert.ok(F.eq(evalExact(parseExpr('(x+1)*(x-1)'), { x: parseNum('3') }), parseNum('8')));
  assert.throws(() => linearForm(parseExpr('x*y')), /not linear/);
  assert.throws(() => parseExpr('2$x'));
});

test('Gaussian elimination: 2x2, 3x3 with a zero pivot, fractions, singular systems', () => {
  const solve = (eqs, vars) => {
    const rows = eqs.map((e) => equationRow(e, vars));
    return solveLinear(rows.map((r) => r.co), rows.map((r) => r.rhs));
  };
  const s2 = solve(['2*x+3*y=-1', '5*x-3*y=29'], ['x', 'y']);
  assert.deepEqual(s2.x.map(toDecimal), ['4', '-3']);
  const s3 = solve(['y+z=1', 'x+y=5', 'x+2*z=1'], ['x', 'y', 'z']); // first pivot is zero
  assert.equal(s3.status, 'unique');
  assert.deepEqual(s3.x.map(toDecimal), ['3', '2', '-1']);
  const sf = solve(['x/2+y/4=2', 'x/3-y/2=4'], ['x', 'y']);
  assert.deepEqual(sf.x.map(toDecimal), ['6', '-4']);
  assert.equal(solve(['x+y=2', '2*x+2*y=4'], ['x', 'y']).status, 'singular');
  assert.equal(solve(['x+y+z=1', 'x-y=0', '2*x+z=1'], ['x', 'y', 'z']).status, 'singular', 'the third equation follows from the first two');
  const bad = solve(['x+y=1', 'x+y=2'], ['x', 'y']);
  assert.equal(bad.status, 'singular');
});

test('discriminant solver (for the quadratic stages): 0, 1, 2 roots, irrational and degenerate cases, all exact', () => {
  const q = (a, b, c) => solveQuadratic(parseNum(a), parseNum(b), parseNum(c));
  assert.deepEqual(q('1', '-5', '6').roots.map(toDecimal), ['2', '3']);
  assert.deepEqual(q('1', '2', '1').roots.map(toDecimal), ['-1']);
  assert.equal(q('1', '2', '1').count, 1);
  assert.equal(q('1', '0', '4').count, 0);
  assert.deepEqual(q('2', '-3', '1').roots.map(toDecimal), ['0.5', '1']);
  assert.deepEqual(q('0.25', '0', '-4').roots.map(toDecimal), ['-4', '4']);
  assert.equal(q('1', '0', '-2').irrational, true);
  assert.deepEqual(q('0', '2', '-6').roots.map(toDecimal), ['3']);
  assert.equal(sqrtExact(fr(9n, 4n)).n, 3n);
  assert.equal(sqrtExact(fr(2n)), null);
});

// ---------------------------------------------------------------- the verifier catches mistakes
test('verifier catches: wrong answer in any part, singular system, 3 decimals, missing equation, leaked tip, wrong residual', () => {
  const find = (id) => inline.find((x) => x.it.id === id).it;
  const mutate = (id, fn) => { const it = clone(find(id)); fn(it); return checkItem(it).join('|'); };
  assert.deepEqual(checkItem(find('lad-m3-01')), []);
  assert.match(mutate('lad-m3-01', (it) => { it.inputs[2].answer = '4'; }), /part 3: stored answer 4 differs/);
  assert.match(mutate('lad-m3-01', (it) => { it.inputs[3].answer = '5.5'; }), /part 4/);
  assert.match(mutate('lad-m3-01', (it) => { it.inputs[4].answer = '9'; }), /part 5/);
  assert.match(mutate('lad-m2-01', (it) => { it.verify.eqs[1] = '4*x+6*y=-2'; it.statement = it.statement.replace('5x − 3y = 29', '4x + 6y = −2'); }), /singular/);
  assert.match(mutate('lad-m2-01', (it) => { it.verify.eqs[1] = '5*x-3*y=30'; }), /statement does not show equation 2|differs/);
  assert.match(mutate('lad-m2-01', (it) => { it.verify.eqs[1] = '5*x-3*y=28'; it.statement = it.statement.replace('29', '28'); }), /differs|decimal/);
  assert.match(mutate('lad-m2-01', (it) => { it.inputs[0].answer = '4.000'; }), /canonical decimal|differs/);
  assert.match(mutate('lad-m2-01', (it) => { it.tips[1] += ' x = 4'; }), /a tip gives the answer to part 1/);
  assert.match(mutate('lad-m2-01', (it) => { it.tips.pop(); }), /exactly 3/);
  assert.match(mutate('lad-m2-01', (it) => { it.inputs.pop(); }), /differ in length|lettered/);
  assert.match(mutate('lad-m2-01', (it) => { it.inputs[0].tolerance = 0.5; }), /tolerance/);
  assert.match(mutate('lad-m2-01', (it) => { it.inputs[1].unit = 'מ'; }), /no unit/);
  assert.match(mutate('lad-m2-01', (it) => { it.id = 'lad-m2-1'; }), /bad id/);
  assert.match(mutate('lad-m1-09', (it) => { it.verify.values.x = '4'; }), /statement does not give x = 4/);
  assert.match(mutate('lad-m1-09', (it) => { it.inputs[1].answer = '14'; }), /part 2/);
  // a solution that is not a 2-decimal number
  assert.match(mutate('lad-m2-01', (it) => { it.verify.eqs = ['3*x+y=1', 'x+3*y=1']; it.statement = it.statement.replace('2x + 3y = −1', '3x + y = 1').replace('5x − 3y = 29', 'x + 3y = 1'); }), /at most 2 decimals/);
});

test('verifier ladder checks: wrong refs, duplicate ids, thin stages, wrong stage ids', () => {
  const d1 = clone(data); d1.stages[2].items[0].ref = 'math-3-001';
  assert.match(checkLadder(d1, math).join('|'), /ref math-3-001/);
  const d2 = clone(data); d2.stages[2].items[0].ref = 'nope';
  assert.match(checkLadder(d2, math).join('|'), /unknown ref/);
  const d3 = clone(data); d3.stages[0].items.length = 5;
  assert.match(checkLadder(d3, math).join('|'), /needs at least 8/);
  const d4 = clone(data); d4.stages[1].items.push(clone(d4.stages[1].items[0]));
  assert.match(checkLadder(d4, math).join('|'), /duplicate/);
  const d5 = clone(data); d5.stages[3].soon = '';
  assert.match(checkLadder(d5, math).join('|'), /needs a "soon" note/);
  const d6 = clone(data); d6.stages.pop();
  assert.match(checkLadder(d6, math).join('|'), /stages must be M1..M6/);
});

// ---------------------------------------------------------------- engine: subjects, routes, state compatibility
test('routes: #/ladder/math, /M2 and /M2/3 resolve and parse; physics routes parse as before', () => {
  for (const h of ['#/ladder/math', '#/ladder/math/M2', '#/ladder/math/M2/3']) assert.equal(nav.resolveRoute(h).name, 'ladder');
  assert.deepEqual(nav.resolveRoute('#/ladder/math/M2/3').args, ['math', 'M2', '3']);
  assert.deepEqual(L.parseLadderArgs(['math', 'M2', '3']), { subject: 'math', stageId: 'M2', itemNo: '3' });
  assert.deepEqual(L.parseLadderArgs(['math']), { subject: 'math', stageId: undefined, itemNo: undefined });
  assert.deepEqual(L.parseLadderArgs(['S2', '4']), { subject: 'physics', stageId: 'S2', itemNo: '4' });
  assert.deepEqual(L.parseLadderArgs([]), { subject: 'physics', stageId: undefined, itemNo: undefined });
  assert.deepEqual(L.parseLadderArgs(['physics', 'S1']), { subject: 'physics', stageId: 'S1', itemNo: undefined });
  assert.equal(nav.activeTab('#/ladder/math/M1'), 'practice');
  assert.equal(L.subjectOf('math').file, 'data/ladder-math.json');
  assert.equal(L.subjectOf('zzz').id, 'physics');
});

test('saved state: an old physics-only file is read unchanged, and the math ladder shares the same key without clobbering it', () => {
  localStorage.clear?.();
  localStorage.setItem(L.LADDER_KEY, JSON.stringify({ v: 1, skip: { S3: true } }));
  assert.deepEqual(L.loadLadder(), { v: 1, skip: { S3: true } });
  L.setSkip('M2');
  assert.deepEqual(L.loadLadder().skip, { S3: true, M2: true });
  L.setSkip('S3', false);
  assert.deepEqual(L.loadLadder().skip, { M2: true });
  // inline progress of a physics item and a math item live side by side
  const ph = physicsLadder.stages[2].items[0].id;
  const mi = inline[0].it.id;
  L.inlineSink(ph).correct();
  L.inlineSink(mi).correct();
  assert.equal(L.inlineOutcome(ph), 'alone');
  assert.equal(L.inlineOutcome(mi), 'alone');
  assert.deepEqual(Object.keys(L.loadLadder().items.ex).sort(), [mi, ph].sort());
  // stage ids and inline ids never collide across subjects
  const ids = [...physicsLadder.stages, ...stages].map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  const itemIds = [...physicsLadder.stages, ...stages].flatMap((s) => s.items.map(L.itemId));
  assert.equal(new Set(itemIds).size, itemIds.length);
  localStorage.removeItem(L.LADDER_KEY);
});

test('math unlock rule: 70% alone of the previous non-empty stage, skip opens one stage, M4-M6 are "soon" and never block', () => {
  const none = () => null;
  assert.deepEqual(L.ladderStatus(stages, none, {}).map((e) => e.status), ['unlocked', 'locked', 'locked', 'soon', 'soon', 'soon']);
  const m1 = stages[0].items.map(L.itemId);
  const need = L.needed(m1.length);
  const some = new Set(m1.slice(0, need));
  const st = L.ladderStatus(stages, (id) => (some.has(id) ? 'alone' : null), {});
  assert.deepEqual(st.map((e) => e.status), ['done', 'unlocked', 'locked', 'soon', 'soon', 'soon']);
  const fewer = new Set(m1.slice(0, need - 1));
  assert.equal(L.ladderStatus(stages, (id) => (fewer.has(id) ? 'alone' : null), {})[1].status, 'locked');
  assert.equal(L.ladderStatus(stages, (id) => (some.has(id) ? 'hinted' : null), {})[1].status, 'locked', 'hinted does not count');
  assert.equal(L.ladderStatus(stages, none, { M3: true })[2].status, 'unlocked');
});

// ---------------------------------------------------------------- UI
const ctx = {
  show: dom.show,
  ladder: physicsLadder.stages,
  ladderMath: stages,
  topicOf: () => ({ title: 'מתמטיקה' }),
  byId: (id) => math.find((e) => e.id === id) || physics.find((e) => e.id === id),
  renderExercise: (ex, o) => renderExercise(ex, o),
};
const hrefs = () => dom.root.all((n) => n.tagName === 'A').map((a) => a.getAttribute('href'));
const press = () => dom.root.all((n) => n.classList).forEach((n) => { n.classList.add = (c) => n.classList.toggle(c, true); n.classList.remove = (c) => n.classList.toggle(c, false); });

test('UI: math overview has the subject tabs, six cards, progress, soon notes; physics overview is unchanged', async () => {
  store.resetCache();
  localStorage.removeItem(L.LADDER_KEY);
  await U.viewLadderRoute(ctx, 'math');
  const text = dom.root.textContent;
  assert.match(text, /הסלם במתמטיקה/);
  assert.match(text, /פיזיקה/);
  assert.match(text, /מתמטיקה/);
  assert.deepEqual(hrefs().filter((h) => /^#\/ladder(\/math)?$/.test(h)), ['#/ladder', '#/ladder/math']);
  assert.deepEqual(hrefs().filter((h) => /^#\/ladder\/math\/M\d$/.test(h)), ['#/ladder/math/M1', '#/ladder/math/M2', '#/ladder/math/M3']);
  assert.match(text, /0\/10 לבד/);
  assert.match(text, /0\/19 לבד/);
  assert.equal((text.match(/⏳ בקרוב/g) || []).length, 3);
  assert.match(text, /🔒 נעול/);
  // the physics overview is the default and keeps its wording and hrefs
  await U.viewLadderRoute(ctx);
  assert.match(dom.root.textContent, /הסלם לרמת מבחן/);
  assert.match(dom.root.textContent, /שישה שלבים, מתרגיל של נוסחה אחת/);
  assert.deepEqual(hrefs().filter((h) => /^#\/ladder\/S\d$/.test(h)), ['#/ladder/S1', '#/ladder/S2', '#/ladder/S3', '#/ladder/S4', '#/ladder/S5', '#/ladder/S6']);
  await U.viewLadderRoute(ctx, 'S1', '1');
  assert.ok(hrefs().includes('#/ladder/S1/2'), 'physics item navigation keeps its links');
});

test('UI: math stage list: locked M2 offers the skip link, skipping opens it, soon stage shows the note', async () => {
  store.resetCache();
  localStorage.removeItem(L.LADDER_KEY);
  await U.viewLadderRoute(ctx, 'math', 'M2');
  assert.match(dom.root.textContent, /השלב נעול/);
  assert.equal(hrefs().filter((h) => /^#\/ladder\/math\/M2\/\d+$/.test(h)).length, 0);
  const skip = dom.root.all((n) => n.tagName === 'BUTTON').find((b) => /לדלג/.test(b.textContent));
  assert.ok(skip);
  skip.dispatch('click');
  assert.deepEqual(L.loadLadder().skip, { M2: true });
  assert.equal(hrefs().filter((h) => /^#\/ladder\/math\/M2\/\d+$/.test(h)).length, 10);
  await U.viewLadderRoute(ctx, 'math', 'M5');
  assert.match(dom.root.textContent, /יתווספו בקרוב/);
  await U.viewLadderRoute(ctx, 'math', 'M4', '1'); // a soon stage never renders items
  assert.match(dom.root.textContent, /יתווספו בקרוב/);
  await U.viewLadderRoute(ctx, 'math', 'Mx'); // unknown stage falls back to the math overview
  assert.match(dom.root.textContent, /הסלם במתמטיקה/);
  localStorage.removeItem(L.LADDER_KEY);
});

test('UI: an inline math item renders, a correct answer is recorded in the ladder key, a pool exercise in the main store', async () => {
  store.resetCache();
  localStorage.removeItem(L.LADDER_KEY);
  L.setSkip('M3');
  await U.viewLadderRoute(ctx, 'math', 'M3', '11');
  const it = stages[2].items[10];
  assert.ok(L.isInline(it));
  assert.match(dom.root.textContent, new RegExp(it.title.slice(0, 8)));
  assert.ok(hrefs().includes('#/ladder/math/M3/12') && hrefs().includes('#/ladder/math/M3/10'));
  let inputs = dom.root.all((n) => n.tagName === 'INPUT');
  assert.equal(inputs.length, it.inputs.length);
  inputs.forEach((inp, i) => { inp.value = it.inputs[i].answer; });
  press();
  dom.root.querySelector('form').dispatch('submit');
  assert.match(dom.root.textContent, /נכון/);
  assert.equal(L.inlineOutcome(it.id), 'alone');
  assert.equal(store.outcomeOf(it.id), null);
  // a pool exercise (ref) is recorded in the main store
  await U.viewLadderRoute(ctx, 'math', 'M3', '1');
  const ref = math.find((e) => e.id === stages[2].items[0].ref);
  inputs = dom.root.all((n) => n.tagName === 'INPUT');
  assert.equal(inputs.length, ref.inputs.length);
  inputs.forEach((inp, i) => { inp.value = ref.inputs[i].answer; });
  press();
  dom.root.querySelector('form').dispatch('submit');
  assert.equal(store.outcomeOf(ref.id), 'alone');
  await U.viewLadderRoute(ctx, 'math', 'M3');
  assert.match(dom.root.textContent, /2\/19 לבד/);
  assert.ok(hrefs().includes('#/ladder/math'), 'crumb back to the math overview');
  await U.viewLadderRoute(ctx, 'math', 'M3', '19');
  assert.ok(hrefs().includes('#/ladder/math'), 'last item links back to the math overview');
  localStorage.removeItem(L.LADDER_KEY);
});

test('UI: a math load failure shows an error', async () => {
  await U.viewLadderRoute({ show: dom.show }, 'math');
  assert.match(dom.root.textContent, /לא ניתן לטעון/);
  assert.match(dom.root.textContent, /הסלם במתמטיקה/);
});

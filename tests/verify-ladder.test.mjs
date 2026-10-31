import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkItem, checkLadder, inlineItems, trace, stateAt, firstCross, evalQuery } from '../tools/verify-ladder.mjs';
import { ladderDiagram, graph, seriesSamples, layoutIssues, validateSvg, diagrams } from '../tools/diagrams.mjs';
import { models } from '../tools/verify-physics.mjs';

const data = JSON.parse(readFileSync(new URL('../data/ladder.json', import.meta.url), 'utf8'));
const items = inlineItems(data).filter((x) => x.stage === 'S3').map((x) => x.it);
const s4 = inlineItems(data).filter((x) => x.stage === 'S4').map((x) => x.it);
const clone = (x) => JSON.parse(JSON.stringify(x));
const first = () => clone(items[0]);

test('ladder data: at least 12 inline S3 items, all verified by the independent simulator', () => {
  assert.ok(items.length >= 12);
  assert.ok(inlineItems(data).every((x) => ['S3', 'S4', 'S5', 'S6'].includes(x.stage)));
  assert.deepEqual(checkLadder(data), []);
});

test('simulator: stepping and bisection agree with known cases', () => {
  const up = trace({ id: 'A', p0: 25, v0: 20, a: -10 });
  assert.ok(Math.abs(firstCross((t) => stateAt(up, t).v) - 2) < 1e-6);
  assert.ok(Math.abs(firstCross((t) => stateAt(up, t).p) - 5) < 1e-6);
  const tr = { A: up };
  assert.ok(Math.abs(evalQuery({ q: 'peakP', body: 'A' }, tr, 0) - 45) < 1e-6);
  assert.ok(Math.abs(evalQuery({ q: 'area', body: 'A', t0: 0, t1: 5, neg: true }, tr, 0) - 25) < 1e-3);
  assert.throws(() => evalQuery({ q: 'nope' }, tr, 0));
});

test('every item hides its graph-only numbers from the statement and shows 3-5 lettered parts', () => {
  for (const it of items) {
    assert.ok(it.verify.graphOnly.length >= 3, it.id);
    assert.equal(it.tips.length, 3, it.id);
    assert.ok(it.inputs.length >= 3 && it.inputs.length <= 5, it.id);
    assert.ok(!it.inputs.some((i) => /[a-z]/i.test(i.unit)), it.id);
  }
  assert.ok(items.some((i) => i.graph.kind === 'yt') && items.some((i) => i.graph.kind === 'vt') && items.some((i) => i.graph.kind === 'xt'));
});

test('every inline diagram is generated from its graph spec, valid and overlap-free', () => {
  for (const it of items) {
    assert.equal(it.diagram, ladderDiagram(it), it.id);
    assert.deepEqual(validateSvg(it.diagram), [], it.id);
    assert.deepEqual(layoutIssues(it.diagram), [], it.id);
    assert.match(it.diagram, /viewBox="0 0 320 \d+"/);
    assert.ok(!/NaN|undefined|Infinity/.test(it.diagram), it.id);
  }
});

test('verifier catches: wrong answer, wrong plotted curve, off-curve mark, leaked number, bad structure', () => {
  const mutate = (fn) => { const it = first(); fn(it); return checkItem(it); };
  assert.deepEqual(checkItem(first()), []);
  assert.match(mutate((it) => { it.inputs[1].answer = '46'; it.inputs[1].tolerance = 0.46; }).join('|'), /differs from simulated/);
  assert.match(mutate((it) => { it.graph.series[0].fn[1] = 25; }).join('|'), /plotted/);
  assert.match(mutate((it) => { it.graph.marks[1].y = 50; }).join('|'), /not on the simulated curve/);
  assert.match(mutate((it) => { it.statement += ' הגובה הוא 25.'; }).join('|'), /graph-only number 25/);
  assert.match(mutate((it) => { it.tips[0] += ' 45'; }).join('|'), /tip 1 contains the graph-only number 45|a tip contains the answer 45/);
  assert.match(mutate((it) => { it.tips.pop(); }).join('|'), /exactly 3 items/);
  assert.match(mutate((it) => { it.id = 'lad-s3-1'; }).join('|'), /bad id/);
  assert.match(mutate((it) => { it.inputs[0].unit = 'm'; }).join('|'), /Hebrew unit/);
  assert.match(mutate((it) => { it.inputs[0].answer = '25.125'; }).join('|'), /at most 2 decimals/);
  assert.match(mutate((it) => { it.verify.graphOnly = [25, 45, 3]; }).join('|'), /not visible in the graph/);
  assert.match(mutate((it) => { it.verify.bodies[0].a = -9.8; }).join('|'), /a = -10/);
  assert.match(mutate((it) => { it.diagram = it.diagram.replace('45', '46'); }).join('|'), /differs from the generated/);
});

test('graph(): parabola sampling, ticks hold the marked values, labels do not overlap; bad marks are refused', () => {
  const spec = { kind: 'yt', title: 'בדיקה', series: [{ fn: [25, 20, -5], t1: 5 }], marks: [{ t: 2, y: 45, label: 'שיא' }], area: undefined };
  const s = seriesSamples(spec.series[0], 1);
  assert.deepEqual(s.map(([t, y]) => [t, y]), [[0, 25], [1, 40], [2, 45], [3, 40], [4, 25], [5, 0]]);
  const svg = graph(spec);
  assert.deepEqual(layoutIssues(svg), []);
  assert.ok(svg.includes('stroke-dasharray'), 'dashed guide lines');
  assert.ok(svg.includes('<path d="M'), 'exact quadratic curve');
  assert.ok(/>45</.test(svg.replace(/<[^>]*>[⁦-⁩]*/g, '>')) || svg.includes('45'));
  assert.throws(() => graph({ kind: 'yt', title: 'בדיקה', series: [{ fn: [25, 20, -5], t1: 5 }], marks: [{ t: 0.3, y: 25 }] }), /labelled tick/);
  const shaded = graph({ kind: 'vt', title: 'בדיקה', series: [{ fn: [20, -10], t1: 5 }], area: { series: 0, t0: 0, t1: 2 } });
  assert.ok(shaded.includes('<polygon'));
  assert.deepEqual(layoutIssues(shaded), []);
});

test('the graph generator does not touch the physics registry (model-key equality stays green)', () => {
  assert.deepEqual(Object.keys(diagrams).sort(), Object.keys(models).sort());
});

// ---------------------------------------------------------------- stage S4 (angled launch)
import { checkItemS4, traceBody, evalS4 } from '../tools/verify-ladder.mjs';
import { parse, isCorrect } from '../js/check.js';

test('S4: at least 12 items, ids lad-s4-NN, 4-5 parts, signed angle answers in degrees', () => {
  assert.ok(s4.length >= 12);
  for (const it of s4) {
    assert.deepEqual(checkItemS4(it), [], it.id);
    assert.match(it.id, /^lad-s4-\d{2}$/);
    assert.ok(it.inputs.length >= 4 && it.inputs.length <= 5, it.id);
    for (const inp of it.inputs.filter((i) => i.unit === 'מעלות')) assert.ok(inp.tolerance <= 0.5, it.id);
  }
  assert.ok(s4.some((it) => it.inputs.some((i) => i.unit === 'מעלות' && Number(i.answer) < 0)), 'a negative (below the horizontal) direction exists');
  assert.ok(s4.some((it) => it.inputs.some((i) => i.unit === 'מעלות' && Number(i.answer) > 0)), 'a positive direction exists');
});

test('S4 simulator: dt stepping + bisection give landing time, speed and signed direction', () => {
  const tbs = { A: traceBody({ id: 'A', x0: 0, y0: 45, vx: 16, vy: 0 }) };
  assert.ok(Math.abs(evalS4({ body: 'A', what: 't', at: 'land' }, tbs) - 3) < 1e-6);
  assert.ok(Math.abs(evalS4({ body: 'A', what: 'speed', at: 'land' }, tbs) - 34) < 1e-3);
  assert.ok(Math.abs(evalS4({ body: 'A', what: 'ang', at: 'land' }, tbs) + 61.9275) < 1e-3);
  assert.ok(Math.abs(evalS4({ body: 'A', what: 'y', at: { x: 32 } }, tbs) - 25) < 1e-3);
});

test('S4 verifier catches: wrong answer, lost sign, bad angle tolerance, missing sign line, wrong hoop, wrong stated angle', () => {
  const mutate = (idx, fn) => { const it = clone(s4[idx]); fn(it); return checkItemS4(it).join('|'); };
  const angIdx = (it) => it.inputs.findIndex((i) => i.unit === 'מעלות');
  assert.match(mutate(0, (it) => { it.inputs[1].answer = '50'; it.inputs[1].tolerance = 0.5; }), /differs from simulated/);
  assert.match(mutate(0, (it) => { const i = angIdx(it); it.inputs[i].answer = it.inputs[i].answer.replace('-', ''); }), /differs from simulated|angle sign/);
  assert.match(mutate(0, (it) => { it.inputs[angIdx(it)].tolerance = 1; }), /exceeds 0.5 degrees/);
  assert.match(mutate(0, (it) => { it.statement = it.statement.replace('זווית מעל (+) או מתחת (−) לאופק', ''); }), /sign-convention/);
  assert.match(mutate(3, (it) => { it.verify.target.y = 3.4; it.scene.target.y = 3.4; }), /target: at x = 8/);
  assert.match(mutate(4, (it) => { it.verify.claims[0].value = 60; }), /statement value 60/);
  assert.match(mutate(0, (it) => { it.inputs[0].answer = '3.125'; }), /at most 2 decimals/);
});

test('answer checker accepts negative angles with minus variants and the unit label מעלות', () => {
  assert.equal(parse('-53.13'), -53.13);
  assert.equal(parse('−53.13'), -53.13);
  assert.equal(parse('-53.13 מעלות'), -53.13);
  assert.equal(parse('-53.13°'), -53.13);
  assert.equal(parse('33.69 מעלות'), 33.69);
  assert.ok(isCorrect('-53.1', '-53.13', 0.5));
  assert.ok(!isCorrect('53.13', '-53.13', 0.5), 'the sign matters');
  assert.equal(parse('מעלות'), null);
});

// ---------------------------------------------------------------- stage S5 (two bodies meeting)
import { checkItemS5, traceDuo, evalS5, duoMeeting } from '../tools/verify-ladder.mjs';
const s5 = inlineItems(data).filter((x) => x.stage === 'S5').map((x) => x.it);

test('S5: at least 10 inline items, ids lad-s5-NN after the refs, 4-5 parts, Hebrew, 3 tips, diagram with both bodies', () => {
  assert.ok(s5.length >= 10);
  const stage = data.stages.find((s) => s.id === 'S5');
  const firstInline = stage.items.findIndex((it) => !it.ref);
  assert.ok(stage.items.slice(0, firstInline).every((it) => it.ref) && stage.items.slice(firstInline).every((it) => !it.ref), 'inline items come after the refs');
  for (const it of s5) {
    assert.deepEqual(checkItemS5(it), [], it.id);
    assert.match(it.id, /^lad-s5-\d{2}$/);
    assert.ok(it.inputs.length >= 4 && it.inputs.length <= 5 && it.tips.length === 3, it.id);
    assert.ok(it.diagram.includes('<svg') && layoutIssues(it.diagram).length === 0, it.id);
  }
  for (const kind of ['table', 'cars', 'tower3', 'columns', 'intercept']) assert.ok(s5.some((it) => it.scene.kind === kind), kind);
});

test('S5: exactly the no-meeting items carry the yes/no part, answered 2, with the entry rule in the statement', () => {
  const yn = s5.filter((it) => it.inputs.some((i) => /נפגשים/.test(i.label)));
  assert.ok(yn.length >= 1);
  for (const it of yn) {
    assert.equal(it.verify.noMeet, true);
    assert.equal(it.inputs.find((i) => /נפגשים/.test(i.label)).answer, '2');
    assert.match(it.statement, /1 = כן/);
    assert.match(it.statement, /2 = לא/);
  }
  assert.equal(s5.filter((it) => it.verify.noMeet).length, yn.length);
});

test('S5 simulator: meeting by bisection on the separation, delayed start, no-meeting detection', () => {
  const cars = { A: traceDuo({ id: 'A', x0: 0, y0: 0, vx: 0, vy: 0, ax: 2, ay: 0 }), B: traceDuo({ id: 'B', x0: 108, y0: 0, vx: 0, vy: 0, ax: -4, ay: 0 }) };
  const m = duoMeeting({ a: 'A', b: 'B', axis: 'x' }, cars, false);
  assert.ok(m.ok && Math.abs(m.t - 6) < 1e-6);
  const v = { meet: { a: 'A', b: 'B', axis: 'x' } };
  assert.ok(Math.abs(evalS5({ body: 'B', what: 'speed', at: 'meet' }, cars, v) - 24) < 1e-3);
  const late = { A: traceDuo({ id: 'A', x0: 0, y0: 0, vx: 0, vy: 0, ax: 3, ay: 0 }), B: traceDuo({ id: 'B', x0: 70, y0: 0, vx: 0, vy: 0, ax: -2, ay: 0, t0: 2 }) };
  assert.ok(Math.abs(duoMeeting({ a: 'A', b: 'B', axis: 'x' }, late, false).t - 6) < 1e-6);
  const far = { A: traceDuo({ id: 'A', x0: 0, y0: 1.8, vx: 3, vy: 0 }), B: traceDuo({ id: 'B', x0: 2.4, y0: 4, vx: 0, vy: -2 }) };
  assert.equal(evalS5({ op: 'meets' }, far, { floor: true, meet: { a: 'A', b: 'B', axis: 'x' } }), 2);
  assert.throws(() => evalS5({ body: 'Z', what: 'y', at: 'start' }, far, { floor: true }));
});

test('S5 verifier catches: wrong answer, wrong yes/no, a no-meet item that meets, missing entry rule, stray label number, stale diagram', () => {
  const mutate = (id, fn) => { const it = clone(s5.find((x) => x.id === id)); fn(it); return checkItemS5(it).join('|'); };
  assert.match(mutate('lad-s5-03', (it) => { it.inputs[1].answer = '7'; it.inputs[1].tolerance = 0.07; }), /differs from simulated/);
  assert.match(mutate('lad-s5-02', (it) => { it.inputs[4].answer = '1'; it.inputs[4].tolerance = 0.01; }), /differs from simulated|requires noMeet/);
  assert.match(mutate('lad-s5-02', (it) => { it.verify.bodies[1].x0 = 1.2; it.verify.bodies[1].vy = -5.5; }), /noMeet: the simulation finds a meeting/);
  assert.match(mutate('lad-s5-02', (it) => { it.statement = it.statement.replace('1 = כן', 'כן'); }), /yes\/no part must tell how to enter/);
  assert.match(mutate('lad-s5-01', (it) => { it.scene.labels.H = 'H = 9 מ\''; }), /statement does not give|differs from the generated/);
  assert.match(mutate('lad-s5-06', (it) => { it.statement = it.statement.replace('כיוון חיובי הוא כלפי מעלה.', ''); }), /signed-velocity/);
  assert.match(mutate('lad-s5-09', (it) => { it.statement = it.statement.replace('כיוון המהירות = זווית מעל (+) או מתחת (−) לאופק.', ''); }), /sign-convention/);
  assert.match(mutate('lad-s5-04', (it) => { it.verify.bodies[1].t0 = 0; }), /differs from simulated/);
});

// ---- stage S6 (full exam items with sketch parts)
import { checkItemS6, evalS6 } from '../tools/verify-ladder.mjs';
const s6 = inlineItems(data).filter((x) => x.stage === 'S6').map((x) => x.it);

test('S6 data: at least 8 items, 5-6 parts, each with a sketch part whose reference graph follows the simulator', () => {
  assert.ok(s6.length >= 8);
  for (const it of s6) {
    assert.deepEqual(checkItemS6(it), [], it.id);
    assert.ok(it.inputs.length + it.sketches.length >= 5, it.id);
    for (const sk of it.sketches) {
      assert.equal(sk.checklist.length, 3, it.id);
      assert.deepEqual(validateSvg(sk.svg), [], it.id);
      assert.deepEqual(layoutIssues(sk.svg), [], it.id);
    }
  }
  assert.ok(s6.some((i) => i.inputs.some((p) => p.unit === 'מעלות' && Number(p.answer) < 0)), 'signed directions');
  assert.ok(s6.some((i) => i.graph) && s6.some((i) => i.scene && i.scene.kind === 'drop'), 'graph-given and plane/jeep items');
});

test('S6 verifier catches: wrong answer, bad sketch graph, missing sketch, too few parts, wrong hoop, unequal landing', () => {
  const mutate = (idx, fn) => { const it = clone(s6[idx]); fn(it); return checkItemS6(it).join('|'); };
  assert.match(mutate(0, (it) => { it.inputs[1].answer = '3'; it.inputs[1].tolerance = 0.04; }), /differs from simulated/);
  assert.match(mutate(0, (it) => { it.sketches[0].graph.series[0].fn[1] = -9; }), /plotted|stored graph differs/);
  assert.match(mutate(0, (it) => { it.sketches[0].svg = it.sketches[0].svg.replace('<svg', '<svg data-x="1"'); }), /stored graph differs/);
  assert.match(mutate(0, (it) => { it.sketches = []; }), /at least one sketch part/);
  assert.match(mutate(0, (it) => { it.inputs.pop(); it.verify.queries.pop(); }), /5-6 lettered parts|more lettered parts|lacks part marker/);
  assert.match(mutate(0, (it) => { it.sketches[0].checklist.pop(); }), /exactly 3 Hebrew lines/);
  assert.match(mutate(3, (it) => { it.verify.targets[0].y = 3.5; }), /target 1/);
  assert.match(mutate(1, (it) => { it.verify.bodies[2].vx = 5; }), /together/);
  assert.match(mutate(2, (it) => { it.verify.bodies[1].x0 = 150; }), /no real meeting|stored answer|differs/);
  assert.match(mutate(0, (it) => { it.statement = it.statement.replace('g = 10', 'g'); }), /g = 10/);
  assert.ok(Math.abs(evalS6({ op: 'accel', body: 'B', axis: 'x' }, { B: { b: { id: 'B' }, t0: 0, X: trace({ p0: 0, v0: 0, a: 2 }), Y: trace({ p0: 0, v0: 0, a: 0 }) } }, {}) - 2) < 1e-6);
});

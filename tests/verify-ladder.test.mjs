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
  assert.ok(inlineItems(data).every((x) => x.stage === 'S3' || x.stage === 'S4'));
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkItem, checkLadder, inlineItems, trace, stateAt, firstCross, evalQuery } from '../tools/verify-ladder.mjs';
import { ladderDiagram, graph, seriesSamples, layoutIssues, validateSvg, diagrams } from '../tools/diagrams.mjs';
import { models } from '../tools/verify-physics.mjs';

const data = JSON.parse(readFileSync(new URL('../data/ladder.json', import.meta.url), 'utf8'));
const items = inlineItems(data).map((x) => x.it);
const clone = (x) => JSON.parse(JSON.stringify(x));
const first = () => clone(items[0]);

test('ladder data: at least 12 inline S3 items, all verified by the independent simulator', () => {
  assert.ok(items.length >= 12);
  assert.ok(inlineItems(data).every((x) => x.stage === 'S3'));
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

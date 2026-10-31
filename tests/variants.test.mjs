import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, listTemplates, makeRng } from '../js/variants.js';
import { verifyExercise, verifyTemplate, tipLeaks, fromDecimal, statementEquations } from '../tools/verify-variants.mjs';

const ids = listTemplates().map((t) => t.id);
const clone = (x) => JSON.parse(JSON.stringify(x));

test('at least 12 templates covering math-3, math-4 and both physics topics', () => {
  assert.ok(ids.length >= 12);
  const topics = new Set(listTemplates().map((t) => t.topic));
  for (const t of ['math-3', 'math-4', 'phys-vertical', 'phys-horizontal']) assert.ok(topics.has(t), t);
});

test('PRNG and generate are deterministic', () => {
  const a = makeRng(7);
  const b = makeRng(7);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  for (const id of ids) {
    assert.deepEqual(generate(id, 42), generate(id, 42), id);
    assert.equal(generate(id, 42).id, `var-${id}-42`);
  }
});

test('different seeds give different exercises', () => {
  for (const id of ['m3-linear-int', 'm4-quad', 'm3-param']) {
    const s = new Set([...Array(30).keys()].map((i) => generate(id, i).statement));
    assert.ok(s.size > 25, id);
  }
});

test('unknown template and bad seed throw', () => {
  assert.throws(() => generate('nope', 1));
  assert.throws(() => generate('m3-linear-int', -1));
  assert.throws(() => generate('m3-linear-int', 1.5));
});

test('every template: 150 seeds satisfy all hard constraints under the independent verifier', () => {
  for (const id of ids) {
    const r = verifyTemplate(id, 150);
    assert.deepEqual(r.failures.slice(0, 2), [], id);
  }
});

test('exercise shape: Hebrew, 3 tips, answers are <=2 decimals', () => {
  for (const id of ids) {
    const ex = generate(id, 3);
    assert.equal(ex.tips.length, 3);
    assert.ok(/[א-ת]/.test(ex.statement));
    const answers = ex.inputs ? ex.inputs.map((i) => i.answer) : ex.answerSets.sets.flat();
    for (const a of answers) assert.match(a, /^-?\d+(\.\d{1,2})?$/, `${id} ${a}`);
  }
});

test('quadratic templates give answerSets with the full finite set', () => {
  for (const id of ['m3-quad', 'm4-quad', 'm3-cyclic-prod']) {
    const ex = generate(id, 11);
    assert.equal(ex.answerSets.count, 2);
    assert.equal(ex.answerSets.sets.length, 2);
  }
});

test('statementEquations parses printed systems back', () => {
  const ex = generate('m3-quad', 1);
  assert.equal(statementEquations(ex.statement).length, 3);
  assert.equal(fromDecimal('-2.5').toString(), '-5/2');
});

// ----- verifier failure injection -----
const sample = (id, seed = 5) => ({ ex: generate(id, seed), id, seed });

test('verifier accepts untouched exercises', () => {
  for (const id of ids) {
    const { ex, seed } = sample(id);
    assert.deepEqual(verifyExercise(ex, id, seed), [], id);
  }
});

test('injection: wrong linear answer is caught', () => {
  for (const id of ['m3-linear-int', 'm3-linear-dec', 'm4-linear', 'm4-cyclic']) {
    const { ex, seed } = sample(id);
    const bad = clone(ex);
    bad.inputs[0].answer = String(Number(bad.inputs[0].answer) + 1);
    assert.ok(verifyExercise(bad, id, seed).length > 0, id);
  }
});

test('injection: dropped or wrong solution set is caught', () => {
  for (const id of ['m3-quad', 'm4-quad', 'm3-cyclic-prod']) {
    const { ex, seed } = sample(id);
    const missing = clone(ex);
    missing.answerSets.sets.pop();
    missing.answerSets.count = missing.answerSets.sets.length;
    assert.ok(verifyExercise(missing, id, seed).some((e) => /missing|sets/.test(e)), `${id} missing`);
    const wrong = clone(ex);
    wrong.answerSets.sets[0][0] = String(Number(wrong.answerSets.sets[0][0]) + 1);
    assert.ok(verifyExercise(wrong, id, seed).some((e) => /not a solution/.test(e)), `${id} wrong`);
  }
});

test('injection: altered statement (changed coefficient) no longer matches answers', () => {
  const { ex, seed } = sample('m3-linear-int');
  const bad = clone(ex);
  bad.statement = bad.statement.replace(/(\d+)(?=[xyz])/, (m) => String(Number(m) + 1));
  assert.ok(verifyExercise(bad, 'm3-linear-int', seed).length > 0);
});

test('injection: param exercise with wrong k is caught', () => {
  const { ex, seed } = sample('m3-param');
  const bad = clone(ex);
  bad.inputs[0].answer = String(Number(bad.inputs[0].answer) + 1);
  assert.ok(verifyExercise(bad, 'm3-param', seed).length > 0);
});

test('injection: tip that leaks an answer is caught', () => {
  const { ex, seed } = sample('ph-throw-up');
  const bad = clone(ex);
  const ans = ex.inputs[2].answer;
  bad.tips[1] = `התשובה היא ${ans}`;
  // answer must not be in the statement for this check, so strip it from the statement numbers if present
  assert.ok(tipLeaks({ ...bad, statement: 'x' }).length > 0);
  if (!new RegExp(`\\b${ans}\\b`).test(ex.statement.replace(/<[^>]*>/g, ' '))) {
    assert.ok(verifyExercise(bad, 'ph-throw-up', seed).some((e) => /leaks/.test(e)));
  }
});

test('injection: physics answers and >2 decimal answers are caught', () => {
  for (const id of ['ph-throw-up', 'ph-nth-second', 'ph-horizontal', 'ph-horizontal-range', 'ph-meeting']) {
    const { ex, seed } = sample(id);
    const bad = clone(ex);
    bad.inputs[0].answer = String(Number(bad.inputs[0].answer) + 3);
    assert.ok(verifyExercise(bad, id, seed).length > 0, id);
    const long = clone(ex);
    long.inputs[0].answer = '1.234';
    assert.ok(verifyExercise(long, id, seed).some((e) => /decimal/.test(e)), `${id} decimals`);
  }
});

test('injection: non-Hebrew tip, wrong tip count, bad id are caught', () => {
  const { ex, seed } = sample('m3-linear-int');
  const a = clone(ex); a.tips[0] = 'english only';
  assert.ok(verifyExercise(a, 'm3-linear-int', seed).length > 0);
  const b = clone(ex); b.tips.pop();
  assert.ok(verifyExercise(b, 'm3-linear-int', seed).length > 0);
  const c = clone(ex); c.id = 'var-other-1';
  assert.ok(verifyExercise(c, 'm3-linear-int', seed).length > 0);
});

test('injection: answer missing from the worked solution is caught', () => {
  const { ex, seed } = sample('m3-linear-int');
  const bad = clone(ex);
  bad.solution = bad.solution.slice(0, 2).map((s) => s.replace(/\d+/g, ''));
  assert.ok(verifyExercise(bad, 'm3-linear-int', seed).some((e) => /absent/.test(e)));
});

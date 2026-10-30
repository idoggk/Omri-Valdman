import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { htmlProblems, validateFormulas, validateExamples, models, TOPICS } from '../tools/verify-content.mjs';

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const load = (f) => JSON.parse(readFileSync(path.join(dataDir, f), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));

test('real formulas.json passes', () => {
  assert.deepEqual(validateFormulas(load('formulas.json')), []);
});

test('real examples.json passes and covers every topic', () => {
  const ex = load('examples.json');
  assert.deepEqual(validateExamples(ex), []);
  assert.ok(ex.length >= 14);
  for (const t of TOPICS) assert.ok(ex.some((e) => e.topic === t), t);
});

test('formulas: at least 8 items and 6 mistakes per topic', () => {
  const f = load('formulas.json');
  for (const t of TOPICS) {
    const items = f.topics[t].sections.reduce((n, s) => n + s.items.length, 0);
    assert.ok(items >= 8, `${t} items ${items}`);
    assert.ok(f.topics[t].mistakes.length >= 6, `${t} mistakes`);
  }
});

test('htmlProblems accepts simple markup and rejects unsafe or broken markup', () => {
  assert.deepEqual(htmlProblems('<span dir="ltr">x<sup>2</sup> + y<sub>1</sub></span><br>טקסט'), []);
  assert.ok(htmlProblems('<script>alert(1)</script>').length);
  assert.ok(htmlProblems('<span onclick="x()">a</span>').length);
  assert.ok(htmlProblems('<a href="javascript:alert(1)">a</a>').length);
  assert.ok(htmlProblems('<span dir="ltr">a<sup>2</span>').length);
  assert.ok(htmlProblems('a < b').length);
  assert.deepEqual(htmlProblems('a &lt; b'), []);
});

test('formulas: missing section content is reported', () => {
  const f = clone(load('formulas.json'));
  f.topics['math-3'].mistakes = f.topics['math-3'].mistakes.slice(0, 2);
  f.topics['phys-vertical'].sections[0].items[0].note = 'english only';
  f.topics['math-4'].sections[0].items[0].formula = 'x = 1';
  const errs = validateFormulas(f);
  assert.ok(errs.some((e) => e.includes('math-3') && e.includes('mistakes')));
  assert.ok(errs.some((e) => e.includes('phys-vertical') && e.includes('Hebrew')));
  assert.ok(errs.some((e) => e.includes('math-4') && e.includes('ltr')));
});

test('examples: wrong math solution is caught', () => {
  const ex = clone(load('examples.json'));
  ex[0].verify.solution = [2, -1, 4];
  assert.ok(validateExamples(ex).some((e) => e.includes(ex[0].id) && e.includes('mismatch')));
});

test('examples: incomplete solution list of a quadratic system is caught', () => {
  const ex = clone(load('examples.json'));
  const q = ex.find((e) => e.id === 'ex-math-3-quad');
  q.verify.solutions = [[3, 2, 1]];
  assert.ok(validateExamples(ex).some((e) => e.includes('ex-math-3-quad')));
});

test('examples: wrong physics expectation is caught', () => {
  const ex = clone(load('examples.json'));
  const p = ex.find((e) => e.id === 'ex-phys-horizontal-chase');
  p.verify.expect.t = 21;
  assert.ok(validateExamples(ex).some((e) => e.includes('ex-phys-horizontal-chase') && e.includes('expected 21')));
});

test('examples: verified number must appear in the steps', () => {
  const ex = clone(load('examples.json'));
  const p = ex.find((e) => e.id === 'ex-phys-horizontal-launch');
  p.steps = p.steps.map((s) => s.replaceAll('120', '1X0'));
  assert.ok(validateExamples(ex).some((e) => e.includes('does not appear')));
});

test('examples: structure rules (duplicate id, few steps, bad topic, unsafe html)', () => {
  const ex = clone(load('examples.json'));
  ex[1].id = ex[0].id;
  ex[2].steps = ex[2].steps.slice(0, 2);
  ex[3].topic = 'chemistry';
  ex[4].problem = '<script>1</script>' + ex[4].problem;
  const errs = validateExamples(ex, { skipCoverage: true });
  assert.ok(errs.some((e) => e.includes('duplicate id')));
  assert.ok(errs.some((e) => e.includes('at least 3')));
  assert.ok(errs.some((e) => e.includes('bad topic')));
  assert.ok(errs.some((e) => e.includes('forbidden tag')));
});

test('examples: missing verify block is an error unless disabled', () => {
  const ex = clone(load('examples.json'));
  delete ex[0].verify;
  assert.ok(validateExamples(ex).some((e) => e.includes('verify block missing')));
  assert.ok(!validateExamples(ex, { requireVerify: false }).some((e) => e.includes('verify block missing')));
});

test('physics models give the known textbook values', () => {
  assert.deepEqual(models.vertical_from_height({ h: 25, v0: 20 }), { t: 5, hmax: 45, vfinal: -30 });
  assert.equal(models.horizontal_launch({ h: 80, vx: 30 }).v, 50);
  assert.equal(models.chase_accel({ v: 20, d0: 100, a: 2.5 }).t, 20);
  assert.equal(models.vt_trapezoid({ t1: 5, t2: 10, t3: 5, v: 20 }).dist, 300);
});

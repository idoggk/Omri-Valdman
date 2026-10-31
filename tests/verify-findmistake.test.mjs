import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate, mathTruth, physTruth } from '../tools/verify-findmistake.mjs';

const load = () => JSON.parse(readFileSync(new URL('../data/findmistake.json', import.meta.url), 'utf8'));
const data = load();
const byId = (list, id) => list.find((e) => e.id === id);
// Mutate one item of a fresh copy and return the validation errors that mention that item.
const inject = (id, mutate) => {
  const copy = load();
  mutate(byId(copy, id));
  return validate(copy).filter((e) => e.startsWith(`${id}:`));
};

test('data file passes the verifier', () => {
  assert.deepEqual(validate(data), []);
});

test('30 items: 15 math (7 + 8) and 15 physics (8 vertical + 7 horizontal)', () => {
  const count = (t) => data.filter((e) => e.topic === t).length;
  assert.equal(data.length, 30);
  assert.deepEqual([count('math-3'), count('math-4'), count('vertical'), count('horizontal')], [7, 8, 8, 7]);
  assert.equal(new Set(data.map((e) => e.id)).size, 30);
});

test('every item has 4-8 steps, a firstWrong index and an error type', () => {
  for (const e of data) {
    assert.ok(e.steps.length >= 4 && e.steps.length <= 8, e.id);
    assert.ok(Number.isInteger(e.firstWrong) && e.firstWrong >= 1 && e.firstWrong < e.steps.length, e.id);
    assert.equal(typeof e.errorType, 'string');
  }
  const types = new Set(data.map((e) => e.errorType));
  for (const t of ['sign', 'division-by-zero', 'lost-root', 'extraneous', 'arithmetic', 'wrong-formula', 'wrong-axis', 'units', 'gravity-sign', 'mixed-components']) {
    assert.ok(types.has(t), `no item with errorType ${t}`);
  }
});

test('math truth: independent exact solutions', () => {
  const sol = (id) => mathTruth(byId(data, id).verify).solutions.map((s) => s.map(String));
  assert.deepEqual(sol('fm-m-001'), [['1', '2', '3']]);
  assert.deepEqual(sol('fm-m-003'), [['0', '4', '2'], ['2', '3', '1']]);
  assert.deepEqual(sol('fm-m-004'), [['-3', '2', '-5'], ['3', '2', '1']]);
  assert.deepEqual(sol('fm-m-005'), [['1/2', '2', '5/2'], ['3', '7', '10']]);
});

test('physics truth: models and derived quantities', () => {
  const ctx = physTruth(byId(data, 'fm-p-001').verify);
  assert.equal(ctx.tPeak, 3);
  assert.equal(ctx.hMax, 45);
  assert.equal(ctx.tTotal, 6);
  assert.equal(physTruth(byId(data, 'fm-p-003').verify).hTop, 45);
});

test('failure injection (math): flawed step made correct is rejected', () => {
  const errs = inject('fm-m-002', (e) => { e.steps[3].check = { type: 'holds', eqs: ['y=-1'] }; });
  assert.ok(errs.some((m) => /actually consistent/.test(m)), errs.join('\n'));
});

test('failure injection (math): a wrong step before firstWrong is rejected', () => {
  const errs = inject('fm-m-001', (e) => { e.steps[1].check = { type: 'holds', eqs: ['3*x+y=6'] }; });
  assert.ok(errs.some((m) => /before firstWrong/.test(m)), errs.join('\n'));
});

test('failure injection (math): firstWrong pointing at a correct step', () => {
  const errs = inject('fm-m-001', (e) => { e.firstWrong = 1; });
  assert.ok(errs.some((m) => /actually consistent/.test(m)), errs.join('\n'));
});

test('failure injection (math): wrong correctFinal and wrong corrected step', () => {
  assert.ok(inject('fm-m-001', (e) => { e.correctFinal[0].answer = '2'; }).some((m) => /correctFinal/.test(m)));
  assert.ok(inject('fm-m-001', (e) => { e.verify.corrected = { type: 'holds', eqs: ['-7*x=7'] }; }).some((m) => /corrected/.test(m)));
});

test('failure injection (math): flawed chain that ends at the true answer', () => {
  const errs = inject('fm-m-001', (e) => { e.steps[4].check = { type: 'sols', sols: [[1, 2, 3]] }; });
  assert.ok(errs.some((m) => /equals the true solution/.test(m)), errs.join('\n'));
});

test('failure injection (math): lost root claimed as complete, and altered system', () => {
  // claiming both roots in the flawed step makes it correct
  assert.ok(inject('fm-m-004', (e) => { e.steps[2].check = { type: 'holds', eqs: ['(x-3)*(x+3)=0'] }; }).some((m) => /actually consistent/.test(m)));
  // changing the system changes the true solution, so the stored answer no longer matches
  assert.ok(inject('fm-m-001', (e) => { e.verify.equations[0] = 'x+y+z=7'; }).length > 0);
});

test('failure injection (math): quadratic with an irrational root cannot be certified', () => {
  const errs = inject('fm-m-005', (e) => { e.verify.equations[0] = '2*x^2-7*x+1=0'; });
  assert.ok(errs.some((m) => /certified|irrational|true solution/.test(m)), errs.join('\n'));
});

test('failure injection (physics): flawed step made correct is rejected', () => {
  const errs = inject('fm-p-001', (e) => { e.steps[2].check.value = 45; e.steps[2].text = e.steps[2].text.replace('135', '45'); });
  assert.ok(errs.some((m) => /actually consistent/.test(m)), errs.join('\n'));
});

test('failure injection (physics): inconsistent earlier step and bad via', () => {
  assert.ok(inject('fm-p-001', (e) => { e.steps[1].check.value = 4; e.steps[1].text += ' 4'; }).some((m) => /before firstWrong/.test(m)));
  assert.ok(inject('fm-p-001', (e) => { e.steps[2].check.via = 'v0*tPeak-0.5*g*tPeak*tPeak'; }).some((m) => /via/.test(m)));
});

test('failure injection (physics): wrong correctFinal, corrected step and model parameters', () => {
  assert.ok(inject('fm-p-002', (e) => { e.correctFinal[1].answer = '2'; }).some((m) => /correctFinal/.test(m)));
  assert.ok(inject('fm-p-002', (e) => { e.verify.corrected.value = 3; e.correctedStep += ' 3'; }).some((m) => /corrected/.test(m)));
  assert.ok(inject('fm-p-002', (e) => { e.verify.params.v0 = 30; }).length > 0);
});

test('failure injection (physics): value missing from the step text', () => {
  const errs = inject('fm-p-002', (e) => { e.steps[1].text = 'הגובה המרבי הוא כמה מטרים.'; });
  assert.ok(errs.some((m) => /does not appear/.test(m)), errs.join('\n'));
});

test('failure injection: structure, text and topic counts', () => {
  assert.ok(inject('fm-p-001', (e) => { e.steps.splice(1); }).some((m) => /4-8/.test(m)));
  assert.ok(inject('fm-p-001', (e) => { e.firstWrong = 0; }).some((m) => /firstWrong/.test(m)));
  assert.ok(inject('fm-p-001', (e) => { e.errorType = 'nope'; }).some((m) => /errorType/.test(m)));
  assert.ok(inject('fm-p-001', (e) => { e.whyWrong = 'english only'; }).some((m) => /Hebrew/.test(m)));
  assert.ok(inject('fm-p-001', (e) => { e.title += ' <script>x</script>'; }).some((m) => /not allowed/.test(m)));
  assert.ok(inject('fm-p-001', (e) => { e.whyWrong += ' מספר מרוכב'; }).some((m) => /complex/.test(m)));
  const dropped = load().slice(1);
  assert.ok(validate(dropped).some((m) => /expected 7 items/.test(m) || /expected 8 items/.test(m)));
  const dup = load();
  dup[1].id = dup[0].id;
  assert.ok(validate(dup).some((m) => /duplicate id/.test(m)));
});

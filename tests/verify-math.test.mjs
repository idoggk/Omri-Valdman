import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { solveSystem, parseFrac, parseEquation, solveFinite, rowsFromEquations, validate, tipLeaks, guidedProblems, inIdealDeg1 } from '../tools/verify-math.mjs';

const str = (sol) => sol.map(String);
const dataFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'math.json');
const only = (errs) => errs.filter((e) => !e.includes('exercises, found'));

test('parseFrac handles integers, fractions, decimals', () => {
  assert.equal(String(parseFrac('6/4')), '3/2');
  assert.equal(String(parseFrac('-2.5')), '-5/2');
  assert.equal(String(parseFrac(7)), '7');
  assert.throws(() => parseFrac('abc'));
});

test('unique 3x3 solution', () => {
  const r = solveSystem([[1, 1, 1, 6], [2, -1, 1, 3], [1, 2, -1, 2]]);
  assert.equal(r.kind, 'unique');
  assert.deepEqual(str(r.solution), ['1', '2', '3']);
});

test('unique 3x3 with fractional solution', () => {
  const r = solveSystem([[2, 1, 2, 3], [1, -2, 2, -2], [4, 3, -2, -1]]);
  assert.deepEqual(str(r.solution), ['-1', '2', '3/2']);
});

test('no solution', () => {
  const r = solveSystem([[1, 1, 1, 4], [2, 3, -1, 1], [3, 4, 0, 7]]);
  assert.equal(r.kind, 'none');
  assert.equal(r.solution, null);
});

test('infinitely many solutions', () => {
  const r = solveSystem([[1, -1, 2, 3], [2, 1, -1, 3], [3, 0, 1, 6]]);
  assert.equal(r.kind, 'infinite');
  assert.equal(r.rank, 2);
});

test('unique 4x4 solution', () => {
  const r = solveSystem([[1, 1, 2, 1, 5], [2, -1, 2, -1, -6], [1, 2, -4, 2, 7], [3, 1, 0, -1, -4]]);
  assert.equal(r.kind, 'unique');
  assert.deepEqual(str(r.solution), ['-1', '2', '1/2', '3']);
});

test('4x4 none and infinite', () => {
  assert.equal(solveSystem([[1, 1, 1, 1, 10], [1, -1, 1, -1, 2], [2, 0, 2, 0, 13], [1, 2, 0, 3, 9]]).kind, 'none');
  assert.equal(solveSystem([[1, 1, 1, 1, 6], [1, 3, 1, 3, 14], [2, 4, 2, 4, 20], [2, 0, 2, 0, 4]]).kind, 'infinite');
});

test('fraction strings are accepted in system rows', () => {
  const r = solveSystem([['1/2', 0, 0, 1], [0, 1, 0, 2], [0, 0, '1/3', 1]]);
  assert.deepEqual(str(r.solution), ['2', '2', '3']);
});

// ---------------------------------------------------------------- equation grammar
const XYZ = ['x', 'y', 'z'];
const evalAt = (eq, vals) => String(parseEquation(eq, XYZ).partial(vals.map(parseFrac)).constValue());

test('parser: precedence, powers, unary minus, parentheses', () => {
  assert.equal(evalAt('x^2+y^2=25', [3, 4, 0]), '0');
  assert.equal(evalAt('-x^2=0', [3, 0, 0]), '-9'); // -(x^2) - 0
  assert.equal(evalAt('2*(x+y)-3*(z-1)=-4', [2, -1, 3]), '0');
  assert.equal(evalAt('(x-y)^2=0', [1, 4, 0]), '9');
  assert.equal(evalAt('x^2-y^2=15', [4, 1, 0]), '0');
});

test('parser: fractions, decimals and implicit multiplication', () => {
  assert.equal(evalAt('x/2+y/3-z/6=0', [4, -3, 6]), '0');
  assert.equal(evalAt('(x+z)/5+y=-1', [4, -3, 6]), '0');
  assert.equal(evalAt('0.5*x=1', [2, 0, 0]), '0');
  assert.equal(evalAt('2xy+3(x+z)=0', [1, 2, 3]), '16');
  assert.equal(evalAt('x(x-4)=-3', [1, 0, 0]), '0');
});

test('parser rejects bad input', () => {
  assert.throws(() => parseEquation('x+y', XYZ), /expected "="/);
  assert.throws(() => parseEquation('x+w=1', XYZ), /unknown variable/);
  assert.throws(() => parseEquation('x/y=1', XYZ), /divide/);
  assert.throws(() => parseEquation('x^y=1', XYZ), /exponent/);
  assert.throws(() => parseEquation('(x+y=1', XYZ), /missing \)/);
  assert.throws(() => parseEquation('x+$=1', XYZ), /unexpected character/);
});

test('rowsFromEquations rejects non-linear equations', () => {
  assert.deepEqual(rowsFromEquations(['x+2y=3'], ['x', 'y']).map((r) => r.map(String)), [['1', '2', '3']]);
  assert.throws(() => rowsFromEquations(['x*y=3'], ['x', 'y']), /not linear/);
});

// ---------------------------------------------------------------- finite solver
const solveStr = (eqs, vars) => {
  const polys = eqs.map((e) => parseEquation(e, vars));
  const r = solveFinite(polys, vars.length);
  return { sols: r.solutions.map((s) => s.map(String).join(',')).sort(), incomplete: r.incomplete };
};

test('finite solver: sphere + two planes has exactly two solutions', () => {
  const r = solveStr(['5*x+y=7', '7*x+y+z=12', 'x^2+y^2+z^2=14'], XYZ);
  assert.deepEqual(r.sols, ['1,2,3', '2,-3,1']);
  assert.equal(r.incomplete, null);
});

test('finite solver: sum/product pair with a third unknown (four solutions)', () => {
  const r = solveStr(['x^2+y^2=25', 'x*y=12', '2*x-y+z=9'], XYZ);
  assert.deepEqual(r.sols, ['-3,-4,11', '-4,-3,14', '3,4,7', '4,3,4']);
});

test('finite solver: decoupled 4-unknown system and decimals', () => {
  const r = solveStr(['3*x+3*y=18', 'x*y=5', 'x*z=4', 'y*z=5*w'], ['x', 'y', 'z', 'w']);
  assert.deepEqual(r.sols, ['1,5,4,4', '5,1,4/5,4/25']);
});

test('finite solver: no real solutions, inconsistent linear part', () => {
  assert.deepEqual(solveStr(['x^2+y^2=-1', 'z=0'], XYZ).sols, []);
  assert.deepEqual(solveStr(['x+y=1', 'x+y=2', 'x^2=z'], XYZ).sols, []);
});

test('finite solver reports irrational roots and underdetermined systems', () => {
  assert.match(solveStr(['x^2=2', 'y=1', 'z=1'], XYZ).incomplete, /irrational/);
  assert.match(solveStr(['x^2=4', 'y=1'], XYZ).incomplete, /not determined/);
});

// ---------------------------------------------------------------- validate()
const heb = { title: 'כותרת', tips: ['א', 'ב', 'ג'], solution: ['א', 'ב', 'ג'] };
const linearBase = () => ({
  id: 'math-3-001', topic: 'math-3', level: 1, ...heb, statement: 'פתרו: x + y + z = 6, 2x − y + z = 3, x + 2y − z = 2',
  inputs: [{ label: 'x', unit: '', answer: '1', tolerance: 0.01 }, { label: 'y', unit: '', answer: '2', tolerance: 0.01 }, { label: 'z', unit: '', answer: '3', tolerance: 0.01 }],
  verify: { system: [[1, 1, 1, 6], [2, -1, 1, 3], [1, 2, -1, 2]], kind: 'unique' },
});
const finiteBase = () => ({
  id: 'math-3-002', topic: 'math-3', level: 3, ...heb, statement: 'מצאו: 5x + y = 7, 7x + y + z = 12, x² + y² + z² = 14',
  answerSets: { labels: ['x', 'y', 'z'], count: 2, sets: [['1', '2', '3'], ['2', '-3', '1']], tolerance: 0.01 },
  verify: { equations: ['5*x+y=7', '7*x+y+z=12', 'x^2+y^2+z^2=14'], vars: XYZ, solutions: [[1, 2, 3], [2, -3, 1]], kind: 'finite' },
});

test('validate: valid linear and finite exercises pass', () => {
  assert.deepEqual(only(validate([linearBase()], { expectedPerTopic: 1 })).filter((e) => !e.includes('math-4')), []);
  assert.deepEqual(only(validate([finiteBase()])).filter((e) => !e.includes('math-4')), []);
});

test('validate reports a wrong answer', () => {
  const ex = linearBase();
  ex.inputs[0].answer = '9';
  assert.ok(validate([ex]).some((e) => e.includes('input 1 answer "9"')));
});

test('validate rejects fraction answers and complex text', () => {
  const frac = linearBase();
  frac.inputs[0].answer = '2/2';
  assert.ok(validate([frac]).some((e) => e.includes('at most 2 decimal')));
  const cx = linearBase();
  cx.tips = ['x = 2 + 3 i', 'ב', 'ג'];
  assert.ok(validate([cx]).some((e) => e.includes('complex')));
});

test('validate rejects word problems (statement without equations)', () => {
  const ex = linearBase();
  ex.statement = 'דנה קנתה שלוש מחברות ועטים ושילמה סכום כלשהו';
  assert.ok(validate([ex]).some((e) => e.includes('at least 3 equations')));
});

test('validate: equations and system must agree', () => {
  const ex = linearBase();
  ex.verify.equations = ['x+y+z=6', '2*x-y+z=3', 'x+2*y-z=3'];
  assert.ok(validate([ex]).some((e) => e.includes('different systems')));
});

test('validate: finite claimed solution that is wrong', () => {
  const ex = finiteBase();
  ex.verify.solutions[1] = [2, -3, 2];
  ex.answerSets.sets[1] = ['2', '-3', '2'];
  assert.ok(validate([ex]).some((e) => e.includes('does not satisfy all equations exactly')));
});

test('validate: finite system with an unlisted solution is rejected', () => {
  const ex = finiteBase();
  ex.verify.solutions.pop();
  ex.answerSets.sets.pop();
  ex.answerSets.count = 1;
  const errs = validate([ex]);
  assert.ok(errs.some((e) => e.includes('not listed: (2, -3, 1)')), errs.join('\n'));
});

test('validate: answerSets must equal verify.solutions', () => {
  const ex = finiteBase();
  ex.answerSets.sets[1] = ['2', '-3', '0'];
  assert.ok(validate([ex]).some((e) => e.includes('answerSets.sets differ')));
});

test('validate: several solutions need answerSets, decimals limited to 2 places', () => {
  const ex = finiteBase();
  delete ex.answerSets;
  ex.inputs = [{ label: 'x', unit: '', answer: '1', tolerance: 0.01 }];
  assert.ok(validate([ex]).some((e) => e.includes('several solutions: use answerSets')));
  const none = finiteBase();
  delete none.answerSets;
  assert.ok(validate([none]).some((e) => e.includes('exactly one of inputs / choice / answerSets')));
  const dec = finiteBase();
  dec.verify.equations = ['x=1/3', 'y=0', 'z=0'];
  dec.verify.solutions = [['1/3', 0, 0]];
  assert.ok(validate([dec]).some((e) => e.includes('at most 2 decimal places')));
});

test('validate: wrong declared kind and wrong choice', () => {
  const ex = linearBase();
  ex.verify.kind = 'infinite';
  assert.ok(validate([ex]).some((e) => e.includes('declared kind')));
  const ch = linearBase();
  delete ch.inputs;
  ch.choice = { options: ['אין פתרון', 'פתרון יחיד', 'אינסוף פתרונות'], correct: 0 };
  assert.ok(validate([ch]).some((e) => e.includes('choice marks')));
});

test('validate: also[] checks for parameter exercises', () => {
  const ex = linearBase();
  delete ex.inputs;
  ex.inputs = [{ label: 'k', unit: '', answer: '1', tolerance: 0.01 }];
  ex.verify = { system: [[1, 1, 1, 6], [2, 2, 2, 12], [1, 2, -1, 2]], kind: 'infinite', also: [{ system: [[1, 1, 1, 6], [2, 2, 2, 13], [1, 2, -1, 2]], kind: 'unique' }] };
  assert.ok(validate([ex]).some((e) => e.includes('also[0]')));
});

// ---------------------------------------------------------------- the real data
test('data/math.json passes validation (30 + 30 exercises)', () => {
  const data = JSON.parse(readFileSync(dataFile, 'utf8'));
  assert.deepEqual(validate(data), []);
  assert.equal(data.length, 60);
});

test('data/math.json: ids unique, levels mostly 3, several multi-solution sets', () => {
  const data = JSON.parse(readFileSync(dataFile, 'utf8'));
  assert.equal(new Set(data.map((e) => e.id)).size, data.length);
  assert.ok(data.filter((e) => e.level === 3).length >= 20);
  assert.ok(data.filter((e) => e.level === 1).length <= 4);
  assert.ok(data.filter((e) => e.answerSets).length >= 10);
  for (const e of data) {
    assert.equal(e.tips.length, 3);
    assert.ok(e.solution.length >= 3);
  }
});

test('independent float grid search agrees with the listed solutions (3 unknowns, step 1/4)', () => {
  const data = JSON.parse(readFileSync(dataFile, 'utf8')).filter((e) => e.verify.kind === 'finite' && e.topic === 'math-3');
  assert.ok(data.length >= 6);
  for (const e of data) {
    const vars = e.verify.vars;
    // turn each equation into a JS function (test-only evaluator)
    const fns = e.verify.equations.map((s) => {
      const [l, r] = s.split('=');
      const js = (t) => t.replace(/\^/g, '**').replace(/(\d)([a-z(])/g, '$1*$2').replace(/([a-z)])([a-z(])/g, '$1*$2').replace(/([a-z)])([a-z(])/g, '$1*$2');
      return new Function(...vars, `return (${js(l)}) - (${js(r)});`);
    });
    const found = [];
    for (let a = -60; a <= 60; a++) for (let b = -60; b <= 60; b++) for (let c = -60; c <= 60; c++) {
      const v = [a / 4, b / 4, c / 4];
      if (fns.every((f) => Math.abs(f(...v)) < 1e-9)) found.push(v.join(','));
    }
    const listed = e.verify.solutions.map((s) => s.map(Number)).filter((s) => s.every((x) => Math.abs(x * 4 - Math.round(x * 4)) < 1e-9)).map((s) => s.join(','));
    assert.deepEqual(found.sort(), listed.sort(), e.id);
  }
});

test('tipLeaks flags an answer value in a tip but allows numbers from the statement', () => {
  const base = {
    statement: 'x + 2y = 7', tips: ['a', 'b', 'c'],
    inputs: [{ label: 'x', answer: '3' }, { label: 'y', answer: '2' }],
  };
  assert.deepEqual(tipLeaks(base), []);
  assert.deepEqual(tipLeaks({ ...base, tips: ['הערך הוא 3', 'b', 'c'] }), ['tip 1 contains 3']);
  assert.deepEqual(tipLeaks({ ...base, statement: 'x + 2y = 3', tips: ['a', 'כפלו ב־3', 'c'] }), []);
  assert.deepEqual(tipLeaks({ ...base, tips: ['a', 'b', 'פתרון: 4x − 3'] }), ['tip 3 contains 3']);
  const sets = { statement: 'xy = 6', tips: ['a', 'x = 0.8', 'c'], answerSets: { sets: [['1', '0.8'], ['2', '3']] } };
  assert.deepEqual(tipLeaks(sets), ['tip 2 contains 0.8']);
});

test('no tip in data/math.json leaks an answer value', () => {
  const data = JSON.parse(readFileSync(dataFile, 'utf8'));
  for (const e of data) assert.deepEqual(tipLeaks(e), [], e.id);
});

// ---------------------------------------------------------------- guided steps, derived inputs, implied equations
const step = () => ({ q: 'מה עושים עכשיו?', options: ['א', 'ב', 'ג'], correct: 1, explain: 'כי כך', wrongExplain: ['לא', '', 'לא'] });
const cleanErrs = (errs) => errs.filter((e) => !e.includes('exercises, found') && !e.includes('math-4'));

test('guidedProblems accepts a valid guided list and rejects schema violations', () => {
  assert.deepEqual(guidedProblems(undefined), []);
  assert.deepEqual(guidedProblems([step(), step(), step()]), []);
  assert.equal(guidedProblems([step()]).length, 1); // too few steps
  const bad = (patch) => guidedProblems([step(), { ...step(), ...patch }, step()]);
  assert.ok(bad({ correct: 3 }).some((m) => m.includes('correct index')));
  assert.ok(bad({ correct: -1 }).some((m) => m.includes('correct index')));
  assert.ok(bad({ options: ['א'] }).some((m) => m.includes('2-4')));
  assert.ok(bad({ options: ['א', 'ב', 'ג', 'ד', 'ה'] }).some((m) => m.includes('2-4')));
  assert.ok(bad({ explain: '  ' }).some((m) => m.includes('explain')));
  assert.ok(bad({ wrongExplain: ['לא'] }).some((m) => m.includes('wrongExplain length')));
  assert.ok(bad({ wrongExplain: ['', '', 'לא'] }).some((m) => m.includes('wrongExplain[0]')));
  assert.deepEqual(bad({ wrongExplain: undefined }), []);
});

test('validate reports guided problems with the exercise id', () => {
  const ex = linearBase();
  ex.guided = [step(), { ...step(), correct: 9 }, step()];
  assert.ok(validate([ex]).some((e) => e.startsWith('math-3-001: guided: step 2')));
});

test('derived inputs: count, expr with aggregate and base inputs are verified', () => {
  const mk = () => {
    const ex = finiteBase();
    delete ex.answerSets;
    ex.inputs = [
      { label: 'כמה', unit: '', answer: '2', tolerance: 0.01, count: true },
      { label: 'סכום x', unit: '', answer: '3', tolerance: 0.01, expr: 'x', agg: 'sum' },
      { label: 'מקסימום z', unit: '', answer: '3', tolerance: 0.01, expr: 'z', agg: 'max' },
    ];
    return ex;
  };
  assert.deepEqual(cleanErrs(validate([mk()])), []);
  const wrongCount = mk(); wrongCount.inputs[0].answer = '3';
  assert.ok(validate([wrongCount]).some((e) => e.includes('number of solutions is 2')));
  const wrongSum = mk(); wrongSum.inputs[1].answer = '4';
  assert.ok(validate([wrongSum]).some((e) => e.includes('sum of x is 3')));
  const noAgg = mk(); delete noAgg.inputs[1].agg;
  assert.ok(validate([noAgg]).some((e) => e.includes('give agg')));
  const same = mk(); same.inputs[1] = { label: 'x', unit: '', answer: '1', tolerance: 0.01, expr: 'x', agg: 'same' };
  assert.ok(validate([same]).some((e) => e.includes('not the same in all solutions')));
  const base = mk(); base.inputs.push({ label: 'x', unit: '', answer: '1', tolerance: 0.01 });
  assert.ok(validate([base]).some((e) => e.includes('several solutions')));
});

test('parameter checks: bind, param and finite variants in verify.also', () => {
  const mk = () => ({
    ...linearBase(),
    inputs: [{ label: 'k', unit: '', answer: '0', tolerance: 0.01 }, { label: 'x', unit: '', answer: '1', tolerance: 0.01 }, { label: 'y', unit: '', answer: '2', tolerance: 0.01 }, { label: 'z', unit: '', answer: '3', tolerance: 0.01 }],
    verify: {
      equations: ['x+y+z=6', 'x+y+z=7', 'x+2*y=0'], kind: 'none', param: { input: 0, value: 0 },
      also: [{ equations: ['x+y+z=6', '2*x-y+z=3', 'x+2*y-z=2'], kind: 'unique', bind: [1, 2, 3] }],
    },
  });
  assert.deepEqual(cleanErrs(validate([mk()])), []);
  const badBind = mk(); badBind.inputs[2].answer = '5';
  assert.ok(validate([badBind]).some((e) => e.includes('also[0]: input 3 should be 2')));
  const badParam = mk(); badParam.inputs[0].answer = '4';
  assert.ok(validate([badParam]).some((e) => e.includes('should be the parameter value 0')));
  // finite variants: another parameter value is solved exactly and compared with the listed solutions
  const fin = finiteBase();
  fin.verify.also = [{ equations: ['x+y=1', 'x*y=1', 'z=0'], solutions: [] }, { equations: ['x+y=2', 'x*y=1', 'z=0'], solutions: [] }];
  assert.ok(validate([fin]).some((e) => e.includes('also[1]: expected 0 solution(s) but the solver found 1')));
  assert.ok(!validate([fin]).some((e) => e.includes('also[0]')));
});

test('implied equations must be combinations of the system and enable the completeness proof', () => {
  const polys = ['x^2+y^2+z^2=26', '(x-2)^2+(y+1)^2+(z-3)^2=6', 'x+y=-2'].map((s) => parseEquation(s, XYZ));
  assert.ok(inIdealDeg1(parseEquation('2*x-y+3*z=17', XYZ), polys, 3));
  assert.ok(!inIdealDeg1(parseEquation('x=1', XYZ), polys, 3));
  const ex = finiteBase();
  ex.verify.implied = ['x=1'];
  assert.ok(validate([ex]).some((e) => e.includes('verify.implied[0] is not a combination')));
});

// ---------------------------------------------------------------- the 20 harder exercises
const newIds = [];
for (let i = 26; i <= 35; i++) newIds.push(`math-3-0${i}`);
for (let i = 28; i <= 37; i++) newIds.push(`math-4-0${i}`);

test('20 new hard exercises: ids, levels, long solutions, equation-only', () => {
  const data = JSON.parse(readFileSync(dataFile, 'utf8'));
  const fresh = newIds.map((id) => data.find((e) => e.id === id));
  assert.ok(fresh.every(Boolean));
  assert.equal(fresh.filter((e) => e.topic === 'math-3').length, 10);
  assert.equal(fresh.filter((e) => e.topic === 'math-4').length, 10);
  assert.ok(fresh.filter((e) => e.level === 3).length >= 12);
  for (const e of fresh) {
    assert.ok(e.solution.length >= 6, `${e.id}: at least 6 solution steps`);
    assert.equal(e.tips.length, 3);
  }
  assert.equal(data.filter((e) => !newIds.includes(e.id)).length, 40); // the original 40 keep their ids
});

test('guided steps: at least 10 new exercises and 8 existing level-3 exercises have them, all valid', () => {
  const data = JSON.parse(readFileSync(dataFile, 'utf8'));
  const withGuided = data.filter((e) => e.guided);
  assert.ok(withGuided.filter((e) => newIds.includes(e.id)).length >= 10);
  assert.ok(withGuided.filter((e) => !newIds.includes(e.id) && e.level === 3).length >= 8);
  const correctIdx = new Set();
  for (const e of withGuided) {
    assert.deepEqual(guidedProblems(e.guided), [], e.id);
    e.guided.forEach((s) => correctIdx.add(s.correct));
  }
  assert.ok(correctIdx.size >= 2, 'the correct option position varies');
});

// Data-vs-app contract: the app (js/app.js validExercise) only accepts inputs or choice, and
// answerSets exercises are rendered by the answer-sets module (one row of labelled fields per
// solution). Every exercise must therefore be renderable through one of the three forms.
for (const file of ['math', 'physics']) {
  test(`data/${file}.json: every exercise has renderable answer fields`, () => {
    const dataPath = path.join(path.dirname(dataFile), `${file}.json`);
    const data = JSON.parse(readFileSync(dataPath, 'utf8'));
    for (const e of data) {
      const hasInputs = Array.isArray(e.inputs) && e.inputs.length > 0 && e.inputs.every((i) => typeof i.label === 'string' && i.label && i.answer !== undefined);
      const hasChoice = !!(e.choice && Array.isArray(e.choice.options) && e.choice.options.length >= 2 && e.choice.options[e.choice.correct] !== undefined);
      const a = e.answerSets;
      const hasSets = !!(a && Array.isArray(a.labels) && a.labels.length > 0 && Array.isArray(a.sets) && a.count === a.sets.length &&
        a.sets.every((s) => Array.isArray(s) && s.length === a.labels.length && s.every((x) => Number.isFinite(Number(x)))));
      assert.equal([hasInputs, hasChoice, hasSets].filter(Boolean).length, 1, `${e.id}: exactly one renderable answer form`);
      assert.ok(typeof e.id === 'string' && typeof e.topic === 'string', e.id);
    }
  });
}

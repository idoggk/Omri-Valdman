import test from 'node:test';
import assert from 'node:assert/strict';
import { runChain, verifyItem, verifyAll } from '../tools/verify-steps.mjs';
import { parseLine, prep } from '../tools/lib/expr.mjs';

const item = (eq, lines) => ({ id: 'fx', eq, steps: ['a', 'b', 'c', 'd', 'e', 'f'], lines });
const bad = (chain, eq = ['x=0']) => runChain(chain, item(eq, [chain]));

test('expr: log notations, ln, unions and statements', () => {
  assert.equal(prep('log_(1/2)(x)+lg(x)'), 'log(1/2;x)+log(10;x)');
  assert.equal(parseLine('log_2(64)').value({}), 6);
  assert.ok(Math.abs(parseLine('ln(x)').value({ x: Math.E }) - 1) < 1e-12);
  assert.equal(parseLine('log_x(49)').value({ x: 7 }), 2);
  const s = parseLine('x in (-inf,-1) U [4-sqrt(10),2) or x = 5');
  assert.deepEqual([-5, -1, 0.5, 1, 5].map((x) => s.truth({ x })), [true, false, false, true, true]);
  assert.equal(parseLine('x>0 and x!=1').truth({ x: 1 }), false);
  assert.equal(parseLine('1<=x<=3').truth({ x: 3 }), true);
  assert.throws(() => parseLine('x = 1 +'));
  assert.throws(() => parseLine('x = 2 $ 3'));
});

test('a correct chain passes, including an inequality with a pole and a closed end', () => {
  const r = bad({ step: 0, f: ['(x+1)/(x-2)>=3', '(7-2*x)/(x-2)>=0', 'x in (2,7/2]'] }, ['(x+1)/(x-2)>=3']);
  assert.deepEqual(r, { structural: [], failures: [] });
});

test('negative fixture: the old wrong text of mh-rat-8 (inequality directions) is caught', () => {
  // old step 2 of mh-rat-8: "(x + 4 − 3x − 3)/D ≤ 0, כלומר (1 − 2x)/D ≤ 0, כלומר (2x − 1)/D ≥ 0"
  const chain = { step: 2, f: ['3/(x-2)<=(x+4)/(x^2-x-2)', '(x+4-3*x-3)/((x-2)*(x+1))<=0', '(1-2*x)/((x-2)*(x+1))<=0', '(2*x-1)/((x-2)*(x+1))>=0'] };
  const r = bad(chain);
  assert.equal(r.failures[0].index, 0);
  assert.match(r.failures[0].message, /different solution sets/);
  // the corrected text (as stored now) passes
  const fixed = { step: 2, f: ['3/(x-2)<=(x+4)/(x^2-x-2)', '(x+4-3*(x+1))/((x-2)*(x+1))>=0', '(1-2*x)/((x-2)*(x+1))>=0', '(2*x-1)/((x-2)*(x+1))<=0'] };
  assert.deepEqual(bad(fixed).failures, []);
});

test('negative fixture: dropped case (dividing by x - 3 loses x = 3)', () => {
  const r = bad({ step: 1, f: ['(x-3)*(2*x+1)=(x-3)*(x+5)', '2*x+1=x+5', 'x=4'] }, ['(x-3)*(2*x+1)=(x-3)*(x+5)']);
  assert.equal(r.failures[0].index, 0);
  assert.match(r.failures[0].message, /"x=3"|"x":3/);
});

test('negative fixture: illegal division by a possibly-zero expression', () => {
  assert.equal(bad({ step: 0, f: ['x^2=3*x', 'x=3'] }).failures[0].index, 0);
  // multiplying an inequality by x - 2, which can be negative
  assert.equal(bad({ step: 0, f: ['(x+1)/(x-2)>=3', 'x+1>=3*(x-2)'] }).failures[0].index, 0);
});

test('negative fixture: sign flip when dividing an inequality by a negative number', () => {
  assert.equal(bad({ step: 0, f: ['-5*x>=-15', 'x>=3'] }).failures[0].index, 0);
  assert.deepEqual(bad({ step: 0, f: ['-5*x>=-15', 'x<=3'] }).failures, []);
});

test('negative fixture: open versus closed end and a wrong union', () => {
  assert.equal(bad({ step: 0, f: ['(x-1)/(x+2)>=0', 'x in (-inf,-2) U (1,inf)'] }).failures[0].index, 0);
  assert.deepEqual(bad({ step: 0, f: ['(x-1)/(x+2)>=0', 'x in (-inf,-2) U [1,inf)'] }).failures, []);
});

test('squaring: equiv is refused, implies needs an explicit root check line', () => {
  const sq = ['sqrt(10-3*x)=2*x-2', '10-3*x=(2*x-2)^2'];
  assert.equal(bad({ step: 0, f: sq }).failures[0].index, 0); // x = -3/4 satisfies only the squared equation
  const noCheck = bad({ step: 0, f: [...sq, 'x=2 or x=-3/4'], r: ['implies', 'equiv'] });
  assert.ok(noCheck.structural.some((m) => /root check/.test(m)));
  const ok = bad({ step: 0, f: [...sq, 'x=2 or x=-3/4', 'x=2'], r: ['implies', 'equiv', { t: 'domain-restrict', c: '2*x-2>=0' }] });
  assert.deepEqual(ok, { structural: [], failures: [] });
  // a wrong restriction condition is caught too
  const wrongCond = bad({ step: 0, f: [...sq, 'x=2 or x=-3/4', 'x=2'], r: ['implies', 'equiv', { t: 'domain-restrict', c: 'x<0' }] });
  assert.equal(wrongCond.failures[0].index, 2);
});

test('an implies step must really be a consequence', () => {
  assert.equal(bad({ step: 0, f: ['x^2=4', 'x=2', 'x=2'], r: ['implies', { t: 'domain-restrict', c: 'true' }] }).failures[0].index, 0);
});

test('wrong chains (planted errors) must be detected, at the declared pair', () => {
  const chain = { step: 0, wrong: true, wrongAt: 0, f: ['-5*x>=-15', 'x>=3'] };
  assert.deepEqual(verifyItem(item(['x=0'], [chain])), []);
  const missed = { step: 0, wrong: true, f: ['-5*x>=-15', 'x<=3'] };
  assert.match(verifyItem(item(['x=0'], [missed]))[0], /planted error was not detected/);
  assert.match(verifyItem(item(['x=0'], [{ ...chain, wrongAt: 1, f: ['-5*x>=-15', 'x>=3', 'x>=3'] }]))[0], /expected 1/);
});

test('numeric expression chains compare values; substitution defs work', () => {
  assert.deepEqual(bad({ step: 0, f: ['log_6(4)+log_6(9)', 'log_6(4*9)', 'log_6(36)', '2'] }).failures, []);
  assert.equal(bad({ step: 0, f: ['log_2(96)-log_2(3)', 'log_2(96*3)', '5'] }).failures[0].index, 0);
  const sub = { step: 0, f: ['4^x-3*2^x-4=0', 't^2-3*t-4=0', 't=4 or t=-1', 't=4'], r: ['equiv', 'equiv', { t: 'domain-restrict', c: 't>0' }], defs: { t: '2^x' } };
  assert.deepEqual(bad(sub).failures, []);
});

test('structural errors: unparsable lines, unknown relation, step out of range', () => {
  assert.match(bad({ step: 0, f: ['x=1', 'x=2$'] }).structural[0], /cannot be parsed/);
  assert.match(bad({ step: 0, f: ['x=1', 'x=1'], r: ['same'] }).structural[0], /unknown relation/);
  assert.match(verifyItem(item(['x=1'], [{ step: 99, f: ['x=1', 'x=1'] }]))[0], /outside/);
  assert.match(bad({ step: 0, f: ['x=1', '1'] }).structural[0], /mixes/);
});

test('real data: every stored chain is verified, and coverage stays at 100+ items', () => {
  const { errors, withLines, skipped, byFile } = verifyAll();
  assert.deepEqual(errors, []);
  assert.ok(withLines.length >= 100, `only ${withLines.length} items have lines`);
  assert.ok(skipped.every((s) => s.reason && s.reason.length > 5), 'every skipped item carries a reason');
  for (const f of ['data/mathhard-rational.json', 'data/mathhard-exponent.json', 'data/mathhard-radical.json']) assert.equal(byFile[f].covered, byFile[f].total, f);
});

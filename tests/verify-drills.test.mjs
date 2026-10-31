import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateDrills, evalExpr, COUNTS } from '../tools/verify-drills.mjs';

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'drills.json');
const load = () => JSON.parse(readFileSync(file, 'utf8'));
const bad = (mut) => { const d = load(); mut(d); return validateDrills(d); };
const has = (errs, re) => assert.ok(errs.some((e) => re.test(e)), `expected /${re}/ in:\n${errs.join('\n')}`);

test('real drills.json passes', () => {
  assert.deepEqual(validateDrills(load()), []);
});

test('counts, topics and per-trap tracking fields', () => {
  const d = load();
  assert.equal(d.traps.length, COUNTS.traps);
  assert.equal(d.sanity.length, COUNTS.sanity);
  assert.equal(d.cards.length, COUNTS.cards);
  assert.equal(new Set(d.traps.map((t) => t.trapId)).size, 30);
  assert.equal(d.traps.filter((t) => t.topic.startsWith('math')).length, 15);
  for (const x of [...d.traps, ...d.sanity, ...d.cards]) assert.ok(x.tags.length > 0, x.id);
});

test('evalExpr computes and rejects unsafe input', () => {
  assert.equal(evalExpr('Math.sqrt(2*h/g)', { h: 45, g: 10 }), 3);
  assert.throws(() => evalExpr('process.exit(1)'));
  assert.throws(() => evalExpr('Math.random()'));
  assert.throws(() => evalExpr('x+1', {}));
  assert.throws(() => evalExpr('1/0'));
});

test('injection: wrong card count', () => has(bad((d) => d.cards.pop()), /expected 25 cards/));
test('injection: duplicate id', () => has(bad((d) => { d.traps[1].id = d.traps[0].id; }), /duplicate id/));
test('injection: duplicate trapId', () => has(bad((d) => { d.traps[1].trapId = d.traps[0].trapId; }), /duplicate trapId/));
test('injection: duplicate options', () => has(bad((d) => { d.traps[0].options[1] = d.traps[0].options[0]; }), /options must be unique/));
test('injection: correct index out of range / not single', () => {
  has(bad((d) => { d.traps[0].correct = 9; }), /single valid option index/);
  has(bad((d) => { d.traps[0].correct = [0, 1]; }), /single valid option index/);
});
test('injection: too few options', () => has(bad((d) => { d.traps[0].options = d.traps[0].options.slice(0, 2); }), /3-4/));
test('injection: answer leaked in question', () => has(bad((d) => {
  const t = d.traps[4];
  t.question += ' ' + t.options[t.correct];
}), /answer leaked/));
test('injection: no Hebrew', () => {
  has(bad((d) => { d.traps[0].question = 'divide by zero?'; }), /question must contain Hebrew/);
  has(bad((d) => { d.cards[0].back = 'v = v0 - g t'; }), /Hebrew/);
});
test('injection: missing tags / bad topic / bad kind', () => {
  has(bad((d) => { delete d.sanity[0].tags; }), /tags/);
  has(bad((d) => { d.sanity[0].topic = 'chem'; }), /bad topic/);
  has(bad((d) => { d.cards[0].kind = 'trap'; }), /kind must be "card"/);
});
test('injection: wrong number in expression claim', () => has(bad((d) => { d.traps[0 + 14 + 1].verify[0].equals = 3; }), /computes 2.*false/));
test('injection: wrong system kind or solution', () => {
  has(bad((d) => { d.traps[7].verify[0].kind = 'none'; }), /declared kind "none"/);
  has(bad((d) => { d.traps[6].verify[0].solution = ['2', '4']; }), /solution\[1\]/);
});
test('injection: unsafe or unknown expression', () => {
  has(bad((d) => { d.traps[0].verify[0].expr = 'process.exit(1)'; }), /unknown identifier|illegal|not allowed/);
  has(bad((d) => { d.traps[0].verify[0].vars = {}; }), /unknown identifier "x"/);
});
test('injection: sanity item without numeric verify', () => has(bad((d) => { delete d.sanity[3].verify; }), /need numeric verify/));
test('injection: card trapId that matches nothing', () => has(bad((d) => { d.cards[0].trapId = 'no-such-trap'; }), /matches no trap/));
test('injection: unbalanced math/physics split', () => has(bad((d) => { d.traps[0].topic = 'phys-vertical'; }), /split 15 math/));

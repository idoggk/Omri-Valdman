import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEquation, equationFamily, itemEquations, loadEquationItems, equationProblems } from '../tools/equations.mjs';
import { loadTransfer, equationDuplicates } from '../tools/verify-transfer.mjs';

test('normalisation ignores spaces, unicode minus, superscripts and tags', () => {
  assert.equal(normalizeEquation('√(x + 7) = x − 5'), normalizeEquation('√(x+7)=x-5'));
  assert.equal(normalizeEquation('x² + 1 = 5'), normalizeEquation('x<sup>2</sup> + 1 = 5').replace('^(2)', '^2'));
  assert.equal(normalizeEquation('2·x ≥ 4'), '2x>=4');
});

test('family masks numbers, relation and constant signs but keeps coefficients', () => {
  assert.equal(equationFamily('√(x + 7) = x + 1'), equationFamily('√(x + 10) > x − 2'));
  assert.notEqual(equationFamily('√(x + 7) = x + 1'), equationFamily('√(2x + 13) > x + 5'));
});

test('items yield their eq[], {{..}} and ltr spans', () => {
  assert.deepEqual(itemEquations({ eq: ['x² − 4 = 0'] }), ['x^2-4=0']);
  assert.deepEqual(itemEquations({ statement: 'פתרו {{√(x + 7) = x − 5}} וגם <span dir="ltr">2^x = 8</span>' }), ['√(x+7)=x-5', '2^x=8']);
});

test('real data: no duplicate equations and no reserved question shares a family with practice items', () => {
  assert.deepEqual(equationDuplicates(loadTransfer()), []);
});

test('the check fires on an exact duplicate and on a same-family transfer question', () => {
  const items = loadTransfer();
  // a transfer question that copies a practice equation of the same family (rc-m-03: sqrt(x + 7) = x + 1)
  const planted = items.map((q) => (q.id === 'tr-m-12' ? { ...q, eq: ['√(x + 7) > x + 1'] } : q));
  assert.ok(equationDuplicates(planted).some((m) => /tr-m-12/.test(m) && /family/.test(m)));
  // two practice items with the same equation (the old wr-m-3 / math-rad-002 pair)
  const rows = loadEquationItems('data').filter((r) => r.file !== 'transfer.json');
  const wr = rows.find((r) => r.id === 'wr-m-3');
  const rad = rows.find((r) => r.id === 'math-rad-002');
  assert.ok(wr && rad);
  assert.notDeepEqual(wr.equations, rad.equations);
  const dup = rows.map((r) => (r.id === 'wr-m-3' ? { ...r, equations: rad.equations } : r));
  assert.ok(equationProblems(dup, new Set()).some((m) => /duplicate equation/.test(m) && /wr-m-3/.test(m)));
});

test('audit repairs: writing tasks and tr-m-12 are new equations', () => {
  const rows = loadEquationItems('data');
  const get = (id) => rows.find((r) => r.id === id).equations.join(' ');
  assert.notEqual(get('wr-m-3'), get('math-rad-002'));
  assert.notEqual(get('wr-m-4'), get('math-pow-002'));
  assert.notEqual(get('mh-par-8'), get('mh-par-7'));
  assert.notEqual(equationFamily(get('tr-m-12')), equationFamily(get('rc-m-03')));
});

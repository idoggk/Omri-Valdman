// Independent check of the counterexample challenge (js/counter-data.js, 20 false claims).
// For every task: the declared witness is accepted; a grid search finds counterexamples (the claim really is false);
// values where the claim holds are rejected as "holds" (unless the claim never holds, flagged alwaysFalse, where the grid must agree);
// values outside the domain that would otherwise look like counterexamples are rejected as "domain";
// unreadable input is rejected. Also: 20 tasks, unique ids, Hebrew texts, a witness for every variable.
// Usage: node tools/verify-counter.mjs
import { TASKS, checkCounterexample } from '../js/counter.js';

const HEB = /[֐-׿]/;
const GRID = [-10, -5, -3, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 3, 4, 5, 9, 10, 40, 60, 90];

function* points(vars) {
  const idx = vars.map(() => 0);
  for (;;) {
    yield Object.fromEntries(vars.map((v, i) => [v.id, GRID[idx[i]]]));
    let k = 0;
    while (k < idx.length && ++idx[k] === GRID.length) { idx[k] = 0; k++; }
    if (k === idx.length) return;
  }
}
const typed = (v) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, String(x)]));

export function verifyTask(t, errs) {
  const err = (m) => errs.push(`${t.id}: ${m}`);
  const c = { counter: 0, holds: 0, outside: 0 };
  if (![t.title, t.claim, t.domainText, t.why].every((s) => typeof s === 'string' && HEB.test(s))) err('title, claim, domainText and why must be Hebrew text');
  if (typeof t.correct !== 'string' || !t.correct.trim()) err('correct statement required');
  if (!t.eq || !Array.isArray(t.vars) || !t.vars.length || t.vars.length > 4) { err('eq and 1-4 vars required'); return c; }
  if (typeof t.domain !== 'function' || typeof t.holds !== 'function') { err('domain and holds must be functions'); return c; }
  if (!t.vars.every((v) => Number.isFinite(t.witness && t.witness[v.id]))) { err('witness must give every variable a number'); return c; }
  const w = checkCounterexample(t, typed(t.witness));
  if (!w.ok) err(`the witness is not accepted (${w.reason})`);
  let firstHolds = null, firstOutside = null;
  for (const p of points(t.vars)) {
    const inDom = t.domain(p);
    const holds = inDom && t.holds(p);
    if (inDom && !holds) c.counter++;
    else if (inDom && holds) { c.holds++; firstHolds = firstHolds || p; }
    else if (!t.holds(p)) { c.outside++; firstOutside = firstOutside || p; }
  }
  if (!c.counter) err('the grid search found no counterexample: the claim may be true');
  if (t.alwaysFalse ? c.holds > 0 : c.holds === 0) err(t.alwaysFalse ? 'flagged alwaysFalse but the claim holds at some grid point' : 'the claim never holds on the grid: the holds predicate is probably wrong');
  if (firstHolds) { const r = checkCounterexample(t, typed(firstHolds)); if (r.ok || r.reason !== 'holds') err(`values where the claim holds were not rejected as holds (${JSON.stringify(firstHolds)})`); }
  if (firstOutside) { const r = checkCounterexample(t, typed(firstOutside)); if (r.ok || r.reason !== 'domain') err(`out-of-domain values were not rejected (${JSON.stringify(firstOutside)})`); }
  const bad = checkCounterexample(t, { ...typed(t.witness), [t.vars[0].id]: 'abc' });
  if (bad.ok || bad.reason !== 'input') err('non-numeric input must be rejected as input');
  const empty = checkCounterexample(t, {});
  if (empty.ok || empty.reason !== 'input') err('empty input must be rejected as input');
  return c;
}

export function verifyAll(tasks = TASKS) {
  const errs = [];
  if (tasks.length !== 20) errs.push(`expected 20 tasks, found ${tasks.length}`);
  const ids = new Set(tasks.map((t) => t.id));
  if (ids.size !== tasks.length) errs.push('duplicate task ids');
  const total = { counter: 0, holds: 0, outside: 0, withOutside: 0 };
  for (const t of tasks) {
    const c = verifyTask(t, errs);
    total.counter += c.counter; total.holds += c.holds; total.outside += c.outside;
    if (c.outside) total.withOutside++;
  }
  if (total.withOutside < 10) errs.push(`only ${total.withOutside} tasks have out-of-domain values to test (expected at least 10)`);
  return { errs, total, tasks: tasks.length };
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('verify-counter.mjs')) {
  const r = verifyAll();
  if (r.errs.length) { console.error(r.errs.join('\n')); process.exit(1); }
  console.log(`verify-counter: ${r.tasks} claims OK (${r.total.counter} counterexamples, ${r.total.holds} holding points rejected, ${r.total.outside} out-of-domain points rejected, ${r.total.withOutside} tasks with a domain gap)`);
}

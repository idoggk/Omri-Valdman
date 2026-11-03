// Independent verifier for js/units-data.js (30 questions on units and dimensional analysis).
//   1. engine self-check: every unit symbol of the table is rebuilt from its definition (N = kg·m/s², J = N·m, W = J/s, Pa = N/m²,
//      prefixes, minutes, hours, litres) and must match the engine's dimension vector and SI scale;
//   2. every question's answer is recomputed from the dimension engine without answerOf (own code path per type) and compared to
//      answerOf AND to a hand-written key (EXPECTED below), so an engine bug cannot silently change an answer;
//   3. choice questions have exactly one option of the target dimension and all options have different dimensions;
//   4. shape: sequential ids un-01..un-30, Hebrew prompt and explanation, the explanation states the answer, categories known.
// Usage: node tools/verify-units.mjs
import { pathToFileURL } from 'node:url';
import {
  QUESTIONS, UNITS, parseUnit, dimEq, dimMul, dimDiv, evalDim, formulaConsistent, QUANTITIES, quantityDim, answerOf, fmtUnit, fmtNum, CATS, DimError,
} from '../js/units.js';

const V = (kg, m, s) => [kg, m, s];
/** Definitions written independently of the engine's table. */
const DEFS = {
  kg: [V(1, 0, 0), 1], g: [V(1, 0, 0), 1e-3], t: [V(1, 0, 0), 1e3], m: [V(0, 1, 0), 1], cm: [V(0, 1, 0), 1e-2], mm: [V(0, 1, 0), 1e-3], km: [V(0, 1, 0), 1e3],
  s: [V(0, 0, 1), 1], min: [V(0, 0, 1), 60], h: [V(0, 0, 1), 3600],
  N: [V(1, 1, -2), 1], kN: [V(1, 1, -2), 1e3], J: [V(1, 2, -2), 1], kJ: [V(1, 2, -2), 1e3], W: [V(1, 2, -3), 1], kW: [V(1, 2, -3), 1e3],
  Pa: [V(1, -1, -2), 1], kPa: [V(1, -1, -2), 1e3], MPa: [V(1, -1, -2), 1e6], Hz: [V(0, 0, -1), 1], L: [V(0, 3, 0), 1e-3],
};
const EXPECTED = {
  'un-01': 'kg*m/s^2', 'un-02': 'kg*m^2/s^2', 'un-03': 'kg*m^2/s^3', 'un-04': 'kg/(m*s^2)', 'un-05': 'kg/m^3', 'un-06': 'kg/s^2', 'un-07': 'N*s',
  'un-08': 'energy', 'un-09': 'pressure',
  'un-10': 20, 'un-11': 18, 'un-12': 0.025, 'un-13': 7800, 'un-14': 25000, 'un-15': 15, 'un-16': 30, 'un-17': 90, 'un-18': 4.8,
  'un-19': false, 'un-20': true, 'un-21': false, 'un-22': true, 'un-23': true, 'un-24': false,
  'un-25': 'vector', 'un-26': 'scalar', 'un-27': 'vector',
  'un-28': 'm/s^2', 'un-29': 'm', 'un-30': 'J',
};
const HEB = /[֐-׿]/;
const near = (x, y) => Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));

export function verifyUnits(questions = QUESTIONS) {
  const errs = [];
  const err = (id, m) => errs.push(`${id}: ${m}`);
  // 1 engine
  for (const [sym, [dim, scale]] of Object.entries(DEFS)) {
    if (!UNITS[sym]) { err('engine', `missing unit ${sym}`); continue; }
    if (!dimEq(UNITS[sym].dim, dim) || !near(UNITS[sym].scale, scale)) err('engine', `unit ${sym} differs from its definition`);
  }
  for (const sym of Object.keys(UNITS)) if (!DEFS[sym]) err('engine', `unit ${sym} has no independent definition`);
  const eqUnits = (a, b, k = 1) => { const x = parseUnit(a); const y = parseUnit(b); return dimEq(x.dim, y.dim) && near(x.scale, y.scale * k); };
  if (!eqUnits('N', 'kg*m/s^2') || !eqUnits('J', 'N*m') || !eqUnits('W', 'J/s') || !eqUnits('Pa', 'N/m^2') || !eqUnits('kN', 'N', 1000) || !eqUnits('km/h', 'm/s', 1 / 3.6)) err('engine', 'basic unit identities fail');
  if (!eqUnits('cm^2', 'm^2', 1e-4) || !near(parseUnit('g/cm^3').scale, 1000) || !near(parseUnit('mm^2').scale, 1e-6)) err('engine', 'area/density scales fail');
  // 4 shape
  const ids = questions.map((q) => q.id);
  if (questions.length !== 30) err('set', `expected 30 questions, found ${questions.length}`);
  ids.forEach((id, i) => { if (id !== `un-${String(i + 1).padStart(2, '0')}`) err(id, 'ids must run un-01..un-30 in order'); });
  const cats = new Set(CATS.map((c) => c.id));
  for (const q of questions) {
    if (!HEB.test(q.prompt) || !HEB.test(q.why)) err(q.id, 'prompt and explanation must be in Hebrew');
    if (!cats.has(q.cat)) err(q.id, `unknown category ${q.cat}`);
    if (/9\.8|9\.81/.test(q.prompt + q.why)) err(q.id, 'g must be 10');
    // 2 recompute without answerOf
    let mine;
    try {
      if (q.type === 'unit' || q.type === 'graph' || q.type === 'qty') {
        let target;
        if (q.type === 'unit') target = q.target.derive ? parseUnit(q.target.derive).dim : parseUnit(QUANTITIES[q.target.quantity].unit).dim;
        else if (q.type === 'graph') { const y = parseUnit(q.y).dim; const x = parseUnit(q.x).dim; target = q.ask === 'slope' ? dimDiv(y, x) : dimMul(y, x); }
        else target = parseUnit(q.unit).dim;
        const dims = q.options.map((o) => (q.type === 'qty' ? quantityDim(o) : parseUnit(o).dim));
        const hits = dims.map((d, i) => (dimEq(d, target) ? i : -1)).filter((i) => i >= 0);
        if (hits.length !== 1) err(q.id, `${hits.length} options match the target dimension`);
        for (let i = 0; i < dims.length; i++) for (let j = i + 1; j < dims.length; j++) if (dimEq(dims[i], dims[j])) err(q.id, `options ${i} and ${j} have the same dimension`);
        if (q.options.length !== 4) err(q.id, 'four options expected');
        mine = q.options[hits[0]];
        if (q.type === 'qty') { const key = EXPECTED[q.id]; if (mine !== key) err(q.id, `answer ${mine} != key ${key}`); }
        else if (!dimEq(parseUnit(mine).dim, parseUnit(EXPECTED[q.id]).dim)) err(q.id, `answer ${mine} != key ${EXPECTED[q.id]}`);
        const shown = q.type === 'qty' ? null : fmtUnit(mine);
        if (shown && !q.why.includes(shown) && !q.why.includes(fmtUnit(EXPECTED[q.id]))) err(q.id, `explanation does not state ${shown}`);
      } else if (q.type === 'conv' || q.type === 'calc') {
        let value;
        if (q.type === 'conv') {
          const a = parseUnit(q.from); const b = parseUnit(q.to);
          if (!dimEq(a.dim, b.dim)) err(q.id, 'conversion between different dimensions');
          value = q.value * a.scale / b.scale;
        } else {
          let dim = [0, 0, 0]; let si = 1;
          for (const t of q.terms) { const u = parseUnit(t.u); dim = dimMul(dim, u.dim); si *= t.v * u.scale; }
          const r = parseUnit(q.result);
          if (!dimEq(dim, r.dim)) err(q.id, 'result unit has a different dimension than the product');
          value = si / r.scale;
        }
        mine = value;
        if (!near(value, EXPECTED[q.id])) err(q.id, `value ${value} != key ${EXPECTED[q.id]}`);
        if (!q.why.includes(fmtNum(value))) err(q.id, `explanation does not state ${fmtNum(value)}`);
      } else if (q.type === 'dim') {
        let ok;
        try { ok = dimEq(evalDim(q.lhs, q.symbols), evalDim(q.rhs, q.symbols)); } catch (e) { if (e instanceof DimError) ok = false; else throw e; }
        mine = ok;
        if (ok !== EXPECTED[q.id]) err(q.id, `consistency ${ok} != key ${EXPECTED[q.id]}`);
        if (!q.shown || !HEB.test(q.prompt)) err(q.id, 'missing formula text');
      } else if (q.type === 'kind') {
        mine = QUANTITIES[q.quantity].kind;
        if (mine !== EXPECTED[q.id]) err(q.id, `kind ${mine} != key ${EXPECTED[q.id]}`);
        if (!q.why.includes(mine === 'vector' ? 'וקטור' : 'סקלר')) err(q.id, 'explanation does not state the kind');
      } else err(q.id, `unknown type ${q.type}`);
    } catch (e) { err(q.id, `exception: ${e.message}`); }
    // engine path agrees with the independent recomputation
    try {
      const a = answerOf(q);
      if (a.kind === 'num' && !near(a.value, mine)) err(q.id, `answerOf ${a.value} != recomputed ${mine}`);
      if (a.kind === 'choice' && q.type !== 'dim' && q.type !== 'kind' && a.index < 0) err(q.id, 'answerOf finds no correct option');
      if (q.type === 'dim' && (a.index === 0) !== mine) err(q.id, 'answerOf disagrees on formula consistency');
      if (q.type === 'dim' && formulaConsistent(q.lhs, q.rhs, q.symbols) !== mine) err(q.id, 'formulaConsistent disagrees');
    } catch (e) { err(q.id, `answerOf exception: ${e.message}`); }
  }
  // mix of categories: every category present, at least 2 true and 2 false in the formula questions
  for (const c of CATS) if (!questions.some((q) => q.cat === c.id)) err('set', `category ${c.id} has no question`);
  const dimQs = questions.filter((q) => q.type === 'dim');
  if (dimQs.filter((q) => EXPECTED[q.id]).length < 2 || dimQs.filter((q) => !EXPECTED[q.id]).length < 2) err('set', 'formula questions need both consistent and inconsistent examples');
  return { errs, count: questions.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { errs, count } = verifyUnits();
  console.log(`units questions: ${count}`);
  if (errs.length) { console.error(`${errs.length} problem(s):`); errs.forEach((e) => console.error(' -', e)); process.exit(1); }
  console.log('OK');
}

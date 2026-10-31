// Verifies data/findmistake.json ("find the mistake" exercises).
// Every item shows a worked solution with ONE flawed step. The verifier recomputes the true answer
// independently (exact rational solver from verify-math.mjs for math, the physics models from
// verify-physics.mjs plus small derived expressions for physics) and proves:
//   - every step before firstWrong is consistent with the true solution,
//   - the step at firstWrong really contradicts it,
//   - correctedStep is consistent with it,
//   - the flawed chain ends in a result different from correctFinal, and correctFinal is the true answer.
// Usage: node tools/verify-findmistake.mjs [path-to-json]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseEquation, solveFinite, parseFrac, inIdealDeg1 } from './verify-math.mjs';
import { models, G } from './verify-physics.mjs';

const HEB = /[֐-׿]/;
const DECIMAL2 = /^-?\d+(\.\d{1,2})?$/;
const COMPLEX = /sqrt\(\s*-|(?<![A-Za-z])i(?![A-Za-z])|imaginary|complex|מרוכב|דמיוני/i;
const ERROR_TYPES = new Set([
  'sign', 'division-by-zero', 'lost-root', 'extraneous', 'arithmetic', 'wrong-formula',
  'wrong-axis', 'units', 'gravity-sign', 'mixed-components', 'wrong-reference', 'total-time',
]);
const MATH_TOPICS = { 'math-3': 3, 'math-4': 4 };
const PHYS_TOPICS = new Set(['vertical', 'horizontal']);
const HTML_TAGS = new Set(['span', 'br', 'sup', 'sub', 'b', 'i', 'em', 'strong', 'bdi']);
const TOL = 0.005;

const plain = (s) => String(s).replace(/<[^>]*>/g, ' ');
const numberAppears = (text, value) =>
  new RegExp(`(?<![\\d.])${String(value).replace(/[.\-]/g, '\\$&')}(?!\\d)`).test(text);

// Same rules as the site's HTML allowlist: only a few inline tags, only dir="ltr|rtl|auto".
function htmlProblems(s) {
  const out = [];
  for (const m of s.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g)) {
    const name = m[2].toLowerCase();
    if (!HTML_TAGS.has(name)) out.push(`tag <${name}> not allowed`);
    const attrs = m[3].trim();
    if (attrs && !/^dir\s*=\s*"(ltr|rtl|auto)"$/.test(attrs)) out.push(`attribute "${attrs}" not allowed`);
  }
  if (/<(?![/a-zA-Z])/.test(s)) out.push('stray "<"');
  return out;
}

// ------------------------------------------------------------------ math
const frac = (x) => parseFrac(String(x));
const evalZero = (poly, sol) => poly.partial(sol).constValue().isZero();
const fracEq = (a, b) => a.equals(b);
const tupleEq = (a, b) => a.length === b.length && a.every((x, i) => fracEq(x, b[i]));
const sameSet = (A, B) =>
  A.length === B.length && A.every((a) => B.some((b) => tupleEq(a, b))) && B.every((b) => A.some((a) => tupleEq(a, b)));
const cmpFrac = (a, b) => { const l = a.n * b.d; const r = b.n * a.d; return l < r ? -1 : l > r ? 1 : 0; };
const cmpTuple = (a, b) => { for (let i = 0; i < a.length; i++) { const c = cmpFrac(a[i], b[i]); if (c) return c; } return 0; };
const isShortDecimal = (f) => (100n * f.n) % f.d === 0n;
const fracText = (f) => {
  const s = f.toString();
  if (!s.includes('/')) return s;
  const v = Number(f.n) / Number(f.d);
  return String(+v.toFixed(2));
};

export function mathTruth(verify) {
  const vars = verify.vars;
  const polys = verify.equations.map((e) => parseEquation(e, vars));
  // hand-derived consequences that help the solver certify completeness; each must be an exact
  // combination of the equations, so they can never change the solution set
  const implied = (verify.implied || []).map((e) => parseEquation(e, vars));
  for (const [j, p] of implied.entries()) {
    if (!inIdealDeg1(p, polys, vars.length)) throw new Error(`verify.implied[${j}] is not a combination of the equations`);
  }
  const { solutions, incomplete } = solveFinite([...polys, ...implied], vars.length);
  return { vars, polys, solutions: solutions.sort(cmpTuple), incomplete };
}

// Returns null for a text step, otherwise true when the claim agrees with the true solution(s).
function mathClaimHolds(check, truth, errs) {
  const { vars, solutions } = truth;
  if (check.type === 'text') return null;
  if (check.type === 'holds') {
    const polys = (check.eqs || []).map((e) => parseEquation(e, vars));
    if (!polys.length) { errs.push('holds check without equations'); return null; }
    return solutions.every((s) => polys.every((p) => evalZero(p, s)));
  }
  if (check.type === 'sols') {
    const claimed = (check.sols || []).map((t) => t.map(frac));
    if (!claimed.length || claimed.some((t) => t.length !== vars.length)) { errs.push(`sols check needs tuples of ${vars.length} numbers`); return null; }
    return sameSet(claimed, solutions);
  }
  if (check.type === 'cands') {
    const idx = (check.vars || []).map((v) => vars.indexOf(v));
    if (!idx.length || idx.some((i) => i < 0)) { errs.push('cands check has unknown variables'); return null; }
    const claimed = (check.sets || []).map((t) => t.map(frac));
    const proj = [];
    for (const s of solutions) {
      const p = idx.map((i) => s[i]);
      if (!proj.some((q) => tupleEq(p, q))) proj.push(p);
    }
    return sameSet(claimed, proj);
  }
  errs.push(`unknown check type "${check.type}"`);
  return null;
}

function claimedSolutions(check) {
  return check.type === 'sols' ? check.sols.map((t) => t.map(frac)) : null;
}

function checkMath(ex, err) {
  const v = ex.verify;
  const n = MATH_TOPICS[ex.topic];
  if (!Array.isArray(v.vars) || v.vars.length !== n || v.vars.some((x) => !/^[A-Za-z]$/.test(x))) return err(`verify.vars must be ${n} single letters`);
  if (!Array.isArray(v.equations) || v.equations.length < n) return err(`verify.equations needs at least ${n} equations`);
  let truth;
  try { truth = mathTruth(v); } catch (e) { return err(`verify.equations invalid: ${e.message}`); }
  if (truth.incomplete) return err(`true solution set cannot be certified: ${truth.incomplete}`);
  if (!truth.solutions.length) return err('system has no solution');
  if (truth.solutions.length > 2) return err('at most two solutions are supported');
  for (const s of truth.solutions) for (const c of s) if (!isShortDecimal(c)) err(`true solution ${c.toString()} is not an integer / at most 2 decimals`);

  const statementEq = (plain(ex.statement).match(/=/g) || []).length;
  if (statementEq < n) err(`statement must contain at least ${n} equations`);

  // correctFinal = the true solutions, flattened in sorted order
  const expected = truth.solutions.flatMap((s) => s.map(fracText));
  const given = (ex.correctFinal || []).map((a) => String(a.answer));
  if (expected.length !== given.length || expected.some((e, i) => e !== given[i])) {
    err(`correctFinal [${given.join(', ')}] does not match the true solution [${expected.join(', ')}]`);
  }

  const errs = [];
  const results = ex.steps.map((s) => mathClaimHolds(s.check, truth, errs));
  errs.forEach((m) => err(m));
  checkStepPattern(ex, results, err);

  // the flawed chain must end in something that is not the true set and that breaks the system
  const last = ex.steps[ex.steps.length - 1].check;
  if (last.type !== 'sols') err('the last step must be a "sols" check (the flawed final result)');
  else {
    const flawed = claimedSolutions(last);
    if (sameSet(flawed, truth.solutions)) err('the flawed final result equals the true solution');
    // wrong either because it breaks an equation, or because it is only part of the solution set (lost root)
    const breaks = flawed.some((s) => truth.polys.some((p) => !evalZero(p, s)));
    const partial = flawed.every((s) => truth.solutions.some((t) => tupleEq(s, t)));
    if (!breaks && !partial) err('the flawed final result is neither a violation of the system nor an incomplete answer');
  }

  const cres = mathClaimHolds(ex.verify.corrected || { type: 'text' }, truth, errs);
  if (cres === null) err('verify.corrected must be a real check');
  else if (!cres) err('verify.corrected contradicts the true solution');
}

// ------------------------------------------------------------------ physics
const evalExpr = (expr, ctx) => {
  if (typeof expr !== 'string' || !/^[\w\s+\-*/().]+$/.test(expr)) throw new Error(`bad expression "${expr}"`);
  const keys = Object.keys(ctx);
  return new Function(...keys, `"use strict"; return (${expr});`)(...keys.map((k) => ctx[k]));
};

export function physTruth(verify) {
  const params = verify.params || {};
  const ctx = { g: G, sqrt: Math.sqrt, abs: Math.abs, ...params };
  for (const k of Object.keys(ctx)) if (!/^[A-Za-z_]\w*$/.test(k)) throw new Error(`bad name "${k}"`);
  if (verify.model) {
    const fn = models[verify.model];
    if (!fn) throw new Error(`unknown model "${verify.model}"`);
    const out = fn(params);
    const names = verify.names || [];
    if (names.length > out.length) throw new Error('more names than model outputs');
    names.forEach((nm, i) => {
      if (nm in ctx) throw new Error(`name "${nm}" is used twice`);
      ctx[nm] = out[i];
    });
  }
  for (const [nm, expr] of Object.entries(verify.derived || {})) {
    if (nm in ctx) throw new Error(`name "${nm}" is used twice`);
    ctx[nm] = evalExpr(expr, ctx);
  }
  return ctx;
}

// null for text, otherwise whether the claimed value agrees with the true one.
function physClaimHolds(check, ctx, err, where) {
  if (check.type === 'text') return null;
  if (check.type !== 'quantity') { err(`${where}: unknown check type "${check.type}"`); return null; }
  if (!(check.name in ctx) || ['g', 'sqrt', 'abs'].includes(check.name)) { err(`${where}: unknown quantity "${check.name}"`); return null; }
  if (typeof check.value !== 'number') { err(`${where}: value must be a number`); return null; }
  if (check.via !== undefined) {
    try {
      const got = evalExpr(check.via, ctx);
      if (Math.abs(got - check.value) > 0.01) err(`${where}: via "${check.via}" gives ${got}, not ${check.value}`);
    } catch (e) { err(`${where}: ${e.message}`); }
  }
  return Math.abs(ctx[check.name] - check.value) <= TOL;
}

function checkPhys(ex, err) {
  const v = ex.verify;
  let ctx;
  try { ctx = physTruth(v); } catch (e) { return err(`verify invalid: ${e.message}`); }
  if (!Array.isArray(v.final) || !v.final.length) return err('verify.final must list the answer quantities');
  if (v.final.some((nm) => typeof ctx[nm] !== 'number')) return err('verify.final names an unknown quantity');
  const given = (ex.correctFinal || []).map((a) => String(a.answer));
  if (given.length !== v.final.length) return err('correctFinal must have one answer per verify.final entry');
  v.final.forEach((nm, i) => {
    const t = ctx[nm];
    if (Math.abs(t - Math.round(t * 100) / 100) > 1e-9) err(`true value of ${nm} (${t}) has more than 2 decimals`);
    if (!DECIMAL2.test(given[i]) || Math.abs(Number(given[i]) - t) > 1e-9) err(`correctFinal ${i + 1} is ${given[i]}, true value of ${nm} is ${t}`);
  });

  const results = ex.steps.map((s, i) => {
    const r = physClaimHolds(s.check, ctx, err, `step ${i + 1}`);
    if (r !== null && s.check.type === 'quantity' && !numberAppears(plain(s.text), s.check.value)) {
      err(`step ${i + 1}: the value ${s.check.value} does not appear in the step text`);
    }
    return r;
  });
  checkStepPattern(ex, results, err);

  const flawed = ex.steps.slice(ex.firstWrong).some((s) =>
    s.check.type === 'quantity' && v.final.includes(s.check.name) && Math.abs(ctx[s.check.name] - s.check.value) > TOL);
  if (!flawed) err('no step from firstWrong on gives a final quantity that differs from the true answer');

  const cc = v.corrected || { type: 'text' };
  const cres = physClaimHolds(cc, ctx, err, 'corrected');
  if (cres === null) err('verify.corrected must be a real check');
  else if (!cres) err('verify.corrected contradicts the true value');
  else if (!numberAppears(plain(ex.correctedStep), cc.value)) err(`correctedStep does not contain the value ${cc.value}`);
}

// ------------------------------------------------------------------ shared
function checkStepPattern(ex, results, err) {
  const fw = ex.firstWrong;
  let realBefore = 0;
  results.forEach((r, i) => {
    if (i < fw) {
      if (r === false) err(`step ${i + 1} is before firstWrong but contradicts the true solution`);
      if (r === true) realBefore++;
    }
  });
  if (!realBefore) err('at least one step before firstWrong needs a real (non-text) check');
  if (results[fw] === null) err('the step at firstWrong must have a real check');
  else if (results[fw] === true) err(`the step at firstWrong (${fw + 1}) is actually consistent with the true solution`);
}

export function validate(data, opts = {}) {
  const want = { 'math-3': 7, 'math-4': 8, vertical: 8, horizontal: 7, ...(opts.expected || {}) };
  const errors = [];
  if (!Array.isArray(data)) return ['top level must be an array'];
  const seen = new Set();
  const counts = {};
  for (const [idx, ex] of data.entries()) {
    const id = ex && ex.id ? ex.id : `#${idx}`;
    const err = (m) => errors.push(`${id}: ${m}`);
    if (!ex || typeof ex !== 'object') { err('not an object'); continue; }
    if (seen.has(ex.id)) err('duplicate id');
    seen.add(ex.id);
    const isMath = ex.topic in MATH_TOPICS;
    if (!isMath && !PHYS_TOPICS.has(ex.topic)) { err(`bad topic ${ex.topic}`); continue; }
    counts[ex.topic] = (counts[ex.topic] || 0) + 1;
    if (!new RegExp(`^fm-${isMath ? 'm' : 'p'}-\\d{3}$`).test(ex.id)) err(`id must look like fm-${isMath ? 'm' : 'p'}-001`);
    if (![2, 3].includes(ex.level)) err('level must be 2 or 3');
    if (!ERROR_TYPES.has(ex.errorType)) err(`bad errorType ${ex.errorType}`);

    let textOk = true;
    const texts = [['title', ex.title], ['statement', ex.statement], ['whyWrong', ex.whyWrong], ['correctedStep', ex.correctedStep]];
    if (Array.isArray(ex.steps)) ex.steps.forEach((s, i) => texts.push([`step ${i + 1}`, s && s.text]));
    for (const [label, t] of texts) {
      if (typeof t !== 'string' || !t.trim()) { err(`${label} empty`); textOk = false; continue; }
      if (!HEB.test(t)) err(`${label} has no Hebrew`);
      if (COMPLEX.test(plain(t))) err(`${label}: complex/imaginary text`);
      for (const p of htmlProblems(t)) err(`${label}: ${p}`);
    }
    if (!Array.isArray(ex.steps) || ex.steps.length < 4 || ex.steps.length > 8) { err('steps must have 4-8 entries'); continue; }
    if (ex.steps.some((s) => !s || typeof s.check !== 'object' || s.check === null)) { err('every step needs a check object'); continue; }
    if (!Number.isInteger(ex.firstWrong) || ex.firstWrong < 1 || ex.firstWrong >= ex.steps.length) { err('firstWrong must be an index >= 1 inside steps'); continue; }
    if (!Array.isArray(ex.correctFinal) || !ex.correctFinal.length) { err('correctFinal missing'); continue; }
    for (const a of ex.correctFinal) {
      if (!a || typeof a.label !== 'string' || !a.label.trim() ||!DECIMAL2.test(String(a.answer))) err('correctFinal entries need label and an integer/<=2-decimal answer');
    }
    if (!ex.verify || typeof ex.verify !== 'object') { err('verify missing'); continue; }
    if (!textOk) continue;
    try {
      if (isMath) checkMath(ex, err);
      else checkPhys(ex, err);
    } catch (e) { err(`verifier crashed: ${e.message}`); }
  }
  for (const [t, c] of Object.entries(want)) if ((counts[t] || 0) !== c) errors.push(`topic ${t}: expected ${c} items, found ${counts[t] || 0}`);
  return errors;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const file = process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'findmistake.json');
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`FAIL: cannot read/parse ${file}: ${e.message}`);
    process.exit(1);
  }
  const errors = validate(data);
  if (errors.length) {
    console.error(`FAIL: ${errors.length} problem(s)`);
    for (const e of errors) console.error(' - ' + e);
    process.exit(1);
  }
  console.log(`OK: ${data.length} find-the-mistake items verified`);
}

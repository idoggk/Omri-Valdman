// Independent check of data/reverse.json ("reverse problems": from the result back to the unknown input).
// Nothing stored as an answer is trusted:
//  math:    the printed equations are compiled and evaluated at the given solution point(s); each equation is
//           affine in the unknowns, so the unknowns are solved by Gaussian elimination. The solved values must be
//           unique and equal the stored answers (inverse), and substituting the stored answers back must make every
//           equation hold at every point (forward).
//  physics: the answers are recomputed from the stored parameters by a closed-form inverse (g = 10), and a forward
//           model built from the ANSWERS must reproduce the given data (and internal consistency residuals).
//  both:    >= 12 math and >= 12 physics, Hebrew text, 2 hints, steps, answers real with <= 2 decimals, the given
//           numbers appear in the statement.
// Run: node tools/verify-reverse.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const MIN_EACH = 12;
const G = 10;
const S37 = 0.6, C37 = 0.8;
const hasHebrew = (s) => typeof s === 'string' && /[א-ת]/.test(s);
const dec2 = (n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-9;
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e * Math.max(1, Math.abs(a), Math.abs(b));

function compileSide(src, names) {
  const js = src
    .replace(/[−–]/g, '-').replace(/[·×]/g, '*').replace(/÷/g, '/')
    .replace(/([A-Za-z])²/g, '($1*$1)')
    .replace(/(\d)\s*(?=[A-Za-z(])/g, '$1*');
  if (!/^[\w\s+\-*/().]*$/.test(js)) throw new Error(`unsupported characters in "${src}"`);
  return new Function(...names, `"use strict"; return (${js});`);
}
/** "lhs = rhs" -> (values by name) => lhs - rhs */
function compileEq(src, names) {
  const parts = src.split('=');
  if (parts.length !== 2) throw new Error(`"${src}" is not an equation`);
  const l = compileSide(parts[0], names), r = compileSide(parts[1], names);
  return (obj) => { const v = names.map((n) => obj[n]); return l(...v) - r(...v); };
}

/** Solves the square/overdetermined affine system rows [c1..cn | rhs]; returns solution or an error string. */
function gauss(rows, n) {
  const m = rows.map((r) => r.slice());
  let rank = 0;
  const piv = [];
  for (let col = 0; col < n && rank < m.length; col++) {
    let best = rank;
    for (let i = rank + 1; i < m.length; i++) if (Math.abs(m[i][col]) > Math.abs(m[best][col])) best = i;
    if (Math.abs(m[best][col]) < 1e-9) continue;
    [m[rank], m[best]] = [m[best], m[rank]];
    for (let i = 0; i < m.length; i++) {
      if (i === rank) continue;
      const f = m[i][col] / m[rank][col];
      for (let j = col; j <= n; j++) m[i][j] -= f * m[rank][j];
    }
    piv.push(col);
    rank++;
  }
  for (let i = rank; i < m.length; i++) if (Math.abs(m[i][n]) > 1e-7) return 'the equations are inconsistent';
  if (rank < n) return 'the unknowns are not uniquely determined';
  return piv.map((c, i) => m[i][n] / m[i][c]);
}

function checkMath(it, err) {
  const names = [...it.vars, ...it.unknowns];
  if (!Array.isArray(it.points) || !it.points.length) return err('points missing');
  let eqs;
  try { eqs = it.equations.map((q) => compileEq(q, names)); } catch (e) { return err(e.message); }
  const rows = [];
  for (const p of it.points) {
    for (const v of it.vars) if (typeof p[v] !== 'number' && it.points.length === 1) err(`point lacks ${v}`);
    for (const f of eqs) {
      const at = (u) => f({ ...Object.fromEntries(it.vars.map((v) => [v, p[v]])), ...Object.fromEntries(it.unknowns.map((n, i) => [n, u[i]])) });
      const zero = it.unknowns.map(() => 0);
      const c0 = at(zero);
      const coef = it.unknowns.map((_, i) => at(zero.map((_z, j) => (i === j ? 1 : 0))) - c0);
      const probe = it.unknowns.map((_, i) => 0.37 + i * 1.3);
      const lin = c0 + coef.reduce((s, c, i) => s + c * probe[i], 0);
      if (!near(lin, at(probe), 1e-7)) err(`equation "${f === eqs[0] ? it.equations[0] : ''}" is not linear in the unknowns`);
      rows.push([...coef, -c0]);
    }
  }
  const sol = gauss(rows, it.unknowns.length);
  if (typeof sol === 'string') return err(sol);
  it.unknowns.forEach((n, i) => {
    const ans = it.answers.find((x) => x.name === n);
    if (!ans) return err(`no answer for ${n}`);
    if (Math.abs(ans.value - sol[i]) > 1e-7) err(`answer ${n} = ${ans.value} but the equations give ${sol[i]}`);
    if (!dec2(sol[i])) err(`solved ${n} = ${sol[i]} has more than 2 decimals`);
  });
  // forward: stored answers plugged back must satisfy every equation at every point
  const vals = Object.fromEntries(it.answers.map((x) => [x.name, x.value]));
  for (const p of it.points) for (const [k, q] of it.equations.entries()) {
    const r = eqs[k]({ ...p, ...vals });
    if (Math.abs(r) > 1e-9) err(`forward check fails: "${q}" at ${JSON.stringify(p)} leaves residual ${r}`);
  }
  for (const p of it.points) for (const v of it.vars) {
    if (it.points.length === 1 || p[v] !== undefined) {
      const s = String(p[v]);
      if (!norm(it.statement).includes(s.replace('-', ''))) err(`statement does not mention ${v} = ${s}`);
    }
  }
}

const norm = (s) => String(s).replace(/[−–]/g, '-');

// Closed-form inverse of each physics kind (from the given data to the answers), g = 10.
const INVERSE = {
  hor_T_R: (p) => ({ v0: p.R / p.T, h: 0.5 * G * p.T ** 2 }),
  hor_v_h: (p) => ({ v0: Math.sqrt(p.v ** 2 - 2 * G * p.h), T: Math.sqrt(2 * p.h / G) }),
  up_H: (p) => ({ v0: Math.sqrt(2 * G * p.H), T: (2 * Math.sqrt(2 * G * p.H)) / G }),
  hor_R_v0: (p) => ({ T: p.R / p.v0, h: 0.5 * G * (p.R / p.v0) ** 2 }),
  ang37_R: (p) => { const v0 = Math.sqrt((p.R * G) / (2 * S37 * C37)); return { v0, H: (v0 * S37) ** 2 / (2 * G) }; },
  down_v_h: (p) => { const v0 = Math.sqrt(p.v ** 2 - 2 * G * p.h); return { v0, t: (p.v - v0) / G }; },
  up_h0_T: (p) => { const v0 = (0.5 * G * p.T ** 2 - p.h0) / p.T; return { v0, vl: Math.abs(v0 - G * p.T) }; },
  hor_h_tan: (p) => { const T = Math.sqrt(2 * p.h / G); const v0 = (G * T) / p.tan; return { v0, R: v0 * T }; },
  up_y_t: (p) => { const v0 = (p.y + 0.5 * G * p.t ** 2) / p.t; return { v0, H: v0 ** 2 / (2 * G) }; },
  up_v_y: (p) => { const v0 = Math.sqrt(p.u ** 2 + 2 * G * p.y); return { v0, t: (v0 - p.u) / G }; },
  hor_v_T: (p) => ({ v0: Math.sqrt(p.v ** 2 - (G * p.T) ** 2), h: 0.5 * G * p.T ** 2 }),
  ang37_t: (p) => { const v0 = (G * p.t) / S37; return { v0, R: (2 * v0 ** 2 * S37 * C37) / G }; },
};

// Forward model built from the ANSWERS: returns the data the scenario would produce (to compare with the given
// parameters) plus residuals that must be zero (the answers must agree with each other).
const FORWARD = {
  hor_T_R: (a) => { const T = Math.sqrt(2 * a.h / G); return { given: { T, R: a.v0 * T }, zero: [] }; },
  hor_v_h: (a, p) => ({ given: { v: Math.hypot(a.v0, G * a.T), h: p.h }, zero: [a.T - Math.sqrt(2 * p.h / G)] }),
  up_H: (a) => ({ given: { H: a.v0 ** 2 / (2 * G) }, zero: [a.v0 * a.T - 0.5 * G * a.T ** 2] }),
  hor_R_v0: (a, p) => ({ given: { R: p.v0 * a.T, v0: p.v0 }, zero: [a.h - 0.5 * G * a.T ** 2] }),
  ang37_R: (a) => ({ given: { R: (2 * a.v0 ** 2 * S37 * C37) / G }, zero: [a.H - (a.v0 * S37) ** 2 / (2 * G)] }),
  down_v_h: (a, p) => ({ given: { v: a.v0 + G * a.t, h: p.h }, zero: [a.v0 * a.t + 0.5 * G * a.t ** 2 - p.h] }),
  up_h0_T: (a, p) => ({ given: { h0: p.h0, T: p.T }, zero: [p.h0 + a.v0 * p.T - 0.5 * G * p.T ** 2, a.vl - Math.abs(a.v0 - G * p.T)] }),
  hor_h_tan: (a, p) => { const T = Math.sqrt(2 * p.h / G); return { given: { h: p.h, tan: (G * T) / a.v0 }, zero: [a.R - a.v0 * T] }; },
  up_y_t: (a, p) => ({ given: { t: p.t, y: a.v0 * p.t - 0.5 * G * p.t ** 2 }, zero: [a.H - a.v0 ** 2 / (2 * G)] }),
  up_v_y: (a, p) => ({ given: { y: p.y, u: Math.sqrt(a.v0 ** 2 - 2 * G * p.y) }, zero: [a.v0 - G * a.t - Math.sqrt(a.v0 ** 2 - 2 * G * p.y)] }),
  hor_v_T: (a, p) => ({ given: { T: p.T, v: Math.hypot(a.v0, G * p.T) }, zero: [a.h - 0.5 * G * p.T ** 2] }),
  ang37_t: (a) => ({ given: { t: (a.v0 * S37) / G }, zero: [a.R - (a.v0 * C37) * (2 * a.v0 * S37) / G] }),
};

function checkPhys(it, err) {
  const inv = INVERSE[it.pkind], fwd = FORWARD[it.pkind];
  if (!inv || !fwd) return err(`unknown physics kind ${it.pkind}`);
  const p = it.params;
  if (!p || typeof p !== 'object' || !Object.keys(p).length) return err('params missing');
  const want = inv(p);
  const got = Object.fromEntries(it.answers.map((x) => [x.name, x.value]));
  for (const [k, v] of Object.entries(want)) {
    if (!(k in got)) { err(`no answer for ${k}`); continue; }
    if (!near(got[k], v, 1e-9)) err(`answer ${k} = ${got[k]} but recomputation gives ${v}`);
    if (!dec2(v) || v <= 0) err(`recomputed ${k} = ${v} is not a positive number with <= 2 decimals`);
  }
  if (it.answers.length !== Object.keys(want).length) err('unexpected number of answers');
  if (Object.keys(want).every((k) => k in got)) {
    const f = fwd(got, p);
    for (const [k, v] of Object.entries(f.given)) if (!near(v, p[k], 1e-9)) err(`forward check: ${k} reproduces ${v}, given ${p[k]}`);
    f.zero.forEach((r, i) => { if (Math.abs(r) > 1e-9) err(`forward consistency residual #${i} = ${r}`); });
  }
  for (const [k, v] of Object.entries(p)) {
    if (!norm(it.statement).includes(String(v))) err(`statement does not mention ${k} = ${v}`);
  }
  if (!/g\s*=\s*10/.test(it.statement)) err('statement must state g = 10');
}

export function validateReverse(data) {
  const errors = [];
  const items = data && Array.isArray(data.items) ? data.items : null;
  if (!items) return ['items missing'];
  const ids = new Set();
  let math = 0, phys = 0;
  for (const it of items) {
    const err = (m) => errors.push(`${it.id}: ${m}`);
    if (!it.id || ids.has(it.id)) err('missing or duplicate id');
    ids.add(it.id);
    if (!it.topic) err('topic missing');
    if (![1, 2, 3].includes(it.level)) err('level must be 1-3');
    if (!hasHebrew(it.statement)) err('statement must be Hebrew');
    if (!Array.isArray(it.hints) || it.hints.length !== 2 || !it.hints.every(hasHebrew)) err('exactly 2 Hebrew hints required');
    if (!Array.isArray(it.steps) || it.steps.length < 2 || !it.steps.every(hasHebrew)) err('at least 2 Hebrew solution steps required');
    if (!Array.isArray(it.answers) || !it.answers.length) { err('answers missing'); continue; }
    for (const x of it.answers) {
      if (!x.name || !hasHebrew(x.label) && !/^[A-Za-z]$/.test(x.label || '')) err('answer needs a label');
      if (!dec2(x.value)) err(`answer ${x.name} must be finite with <= 2 decimals`);
      if (!(x.tolerance > 0 && x.tolerance <= 0.01)) err(`answer ${x.name} tolerance must be in (0, 0.01]`);
    }
    if (it.kind === 'math') { math++; checkMath(it, err); } else if (it.kind === 'phys') { phys++; checkPhys(it, err); } else err('kind must be math or phys');
  }
  if (math < MIN_EACH) errors.push(`need at least ${MIN_EACH} math items, have ${math}`);
  if (phys < MIN_EACH) errors.push(`need at least ${MIN_EACH} physics items, have ${phys}`);
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const data = JSON.parse(readFileSync(new URL('../data/reverse.json', import.meta.url), 'utf8'));
  const errors = validateReverse(data);
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log(`reverse: ${data.items.length} items verified (inverse + forward)`);
}

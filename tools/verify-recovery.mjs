// Independent verifier for data/recovery-hard.json (the 8 very hard questions of #/recovery).
// It never trusts the stored derivation: every answer is recomputed from the situation in the statement by brute force
// (dense scans, sign changes, time stepping), then compared with the answer the app grades against (js/mathhard.js canonSpec).
// It also checks that the 8 questions appear in no other pool: no other data file or script contains their ids, statements or equations.
//   node tools/verify-recovery.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { canonSpec, inUnion } from '../js/mathhard.js';
import { validHard } from '../js/recovery.js';
import { scanRoots } from './verify-mathhard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const G = 10;
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

/* ---------- independent recomputation, one function per question ---------- */
const CHECKS = {
  'rh-01'(spec, errs) {
    const f = (x) => Math.sqrt(x + 7 - 4 * Math.sqrt(x + 3)) + Math.sqrt(x + 4 - 2 * Math.sqrt(x + 3)) - 1;
    const parts = spec.parts;
    let bad = 0;
    for (let i = 0; i <= 260000; i++) {
      const x = -3 + i * 0.00005;
      if (parts.some((p) => Math.abs(x - p.lo) < 1e-3 || Math.abs(x - p.hi) < 1e-3)) continue; // endpoints belong to either side numerically
      const v = f(x);
      if ((Math.abs(v) < 1e-7) !== inUnion(parts, x)) bad++;
    }
    if (bad) errs.push(`rh-01: ${bad} sample points disagree with the stored interval`);
  },
  'rh-02'(spec, errs) {
    const roots = scanRoots((x) => Math.abs(x - 1) + Math.abs(x - 3) - (x * x - 4 * x + 5), -20, 20, 400000);
    sameSet(roots, spec.vals, 'rh-02', errs);
  },
  'rh-03'(spec, errs) {
    const roots = scanRoots((x) => Math.log(x) / Math.log(3) * Math.log(x) - Math.log(9) - Math.log(x), 0.0005, 5000, 600000);
    sameSet(roots, spec.vals, 'rh-03', errs);
  },
  'rh-04'(spec, errs) {
    // circle centre (r, r) touches both axes; externally tangent to the circle of radius 6 at (6, 6); smaller than 6
    const roots = scanRoots((r) => Math.hypot(6 - r, 6 - r) - (6 + r), 0.001, 5.999, 200000);
    if (roots.length !== 1) errs.push(`rh-04: expected one root below 6, got ${roots.length}`);
    else if (!near(roots[0], spec.vals[0], 1e-6)) errs.push(`rh-04: scan ${roots[0]} vs stored ${spec.vals[0]}`);
  },
  'rh-05'(spec, errs) {
    // meeting height equals B's apex height; scan the throw speed
    const F = (v) => { const t = v / G; return (45 - 0.5 * G * t * t) - (v * t - 0.5 * G * t * t); };
    const roots = scanRoots(F, 0.01, 60, 200000);
    if (roots.length !== 1) errs.push(`rh-05: expected one root, got ${roots.length}`);
    else {
      if (!near(roots[0], spec.vals[0], 1e-6)) errs.push(`rh-05: scan ${roots[0]} vs stored ${spec.vals[0]}`);
      const t = roots[0] / G;
      if (45 - 0.5 * G * t * t <= 0) errs.push('rh-05: stone A would already be on the ground');
    }
  },
  'rh-06'(spec, errs) {
    const roots = scanRoots((t) => 0.5 * G * t * t - 15 * t, 0.01, 30, 200000); // drop = horizontal distance on a 45 degree slope
    if (roots.length !== 1) errs.push(`rh-06: expected one landing time, got ${roots.length}`);
    else if (!near(Math.hypot(15 * roots[0], 0.5 * G * roots[0] * roots[0]), spec.vals[0], 1e-6)) errs.push('rh-06: slope distance differs');
  },
  'rh-07'(spec, errs) {
    // step the two cars; A accelerates 2 m/s^2 up to 30 m/s
    const dt = 1e-4;
    let t = 0, va = 0, xa = 0;
    let found = null;
    while (t < 100) {
      va = Math.min(30, va + 2 * dt);
      xa += va * dt; t += dt;
      if (xa >= 50 + 20 * t) { found = t; break; }
    }
    if (found === null || !near(found, spec.vals[0], 1e-3)) errs.push(`rh-07: simulation ${found} vs stored ${spec.vals[0]}`);
    // the no-cap formula must NOT agree, otherwise the question has no trap
    if (near(10 + Math.sqrt(150), spec.vals[0], 1e-3)) errs.push('rh-07: the uncapped answer equals the stored one');
  },
  'rh-08'(spec, errs) {
    // Atwood: solve the 2x2 force system numerically, run 2 s, then free flight of the light mass
    const m1 = 3, m2 = 5;
    // unknowns a, T:  m1*a - T = -m1*g  and  m2*a + T = m2*g  (Cramer)
    const det = m1 * 1 + m2 * 1;
    const a = ((-m1 * G) * 1 + (m2 * G) * 1) / det;
    let t = 0, v = 0, y = 0;
    const dt = 1e-5;
    while (t < 2 - 1e-12) { v += a * dt; y += v * dt; t += dt; }
    let top = y;
    while (v > 0) { v -= G * dt; y += v * dt; if (y > top) top = y; }
    if (!near(top, spec.vals[0], 2e-3)) errs.push(`rh-08: simulation ${top} vs stored ${spec.vals[0]}`);
  },
};

function sameSet(found, want, id, errs) {
  if (found.length !== want.length || !found.every((r, i) => near(r, want[i], 1e-6))) errs.push(`${id}: scan ${JSON.stringify(found)} vs stored ${JSON.stringify(want)}`);
}

const strip = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

export function verifyRecovery(root = ROOT) {
  const errs = [];
  const data = JSON.parse(readFileSync(path.join(root, 'data/recovery-hard.json'), 'utf8'));
  if (data.length !== 8) errs.push(`expected 8 questions, got ${data.length}`);
  const ids = new Set();
  for (const q of data) {
    if (ids.has(q.id)) errs.push(`duplicate id ${q.id}`);
    ids.add(q.id);
    if (!validHard(q)) { errs.push(`${q.id}: failed validHard`); continue; }
    if (!/^rh-0[1-8]$/.test(q.id)) errs.push(`${q.id}: ids must be rh-01..rh-08`);
    let spec;
    try { spec = canonSpec(q.answer); } catch (e) { errs.push(`${q.id}: ${e.message}`); continue; }
    if (!CHECKS[q.id]) errs.push(`${q.id}: no independent check`); else CHECKS[q.id](spec, errs);
  }
  // the 4 math + 4 physics split the pool is built around
  if (data.filter((q) => q.subject === 'math').length !== 4 || data.filter((q) => q.subject === 'physics').length !== 4) errs.push('expected 4 math + 4 physics');
  // no other pool contains them
  const others = [];
  for (const f of readdirSync(path.join(root, 'data'))) if (f.endsWith('.json') && f !== 'recovery-hard.json') others.push([`data/${f}`, readFileSync(path.join(root, 'data', f), 'utf8')]);
  for (const f of readdirSync(path.join(root, 'js'))) if (f.endsWith('-data.js') || f === 'counter-data.js') others.push([`js/${f}`, readFileSync(path.join(root, 'js', f), 'utf8')]);
  for (const q of data) {
    const needles = [`"${q.id}"`, `'${q.id}'`, strip(q.ask).slice(0, 36), ...q.eq.map((e) => e.replace(/\s+/g, '')), strip(q.html).slice(0, 36)].filter((n) => n && n.length >= 8);
    for (const [name, text] of others) {
      const flat = text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ');
      const tight = text.replace(/\s+/g, '');
      for (const n of needles) if (flat.includes(n) || tight.includes(n)) errs.push(`${q.id}: "${n.slice(0, 30)}" also appears in ${name}`);
    }
  }
  return errs;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errs = verifyRecovery();
  if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
  console.log('recovery-hard.json: 8 questions verified independently, none appears in another pool');
}

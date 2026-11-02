// Independent numeric verifier for data/mathhard-*.json. It never trusts the stored answer or domain:
//  - the displayed statement ("eq" strings) is parsed by the same parser the app shows, and
//  - solutions are found by brute-force scanning (sign changes, domain edges, tangent minima),
//    inequalities / interval answers by dense sampling around every endpoint, parameter cases by counting real roots
//    for many values of the parameter (exact quadratic formula when the equation is a polynomial in x, scanning otherwise),
//    circle systems by scanning the first circle with an angle parameter.
// The stored answer, domain, listed extraneous roots and typical wrong answers are then compared with those results.
// Usage: node tools/verify-mathhard.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  parseRelation, holds, parseIntervals, normUnion, inUnion, canonSpec, sameCanon, evalExact, TIERS, FAMILIES, DATA_FILES, validExercise,
} from '../js/mathhard.js';

const HEB = /[֐-׿]/;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadAll() {
  return DATA_FILES.flatMap((f) => JSON.parse(readFileSync(path.join(ROOT, f), 'utf8')));
}

/* ---------- numeric helpers ---------- */
const fin = Number.isFinite;

/** Point of the defined side of a defined / undefined pair, found by bisection. */
function edge(isDef, d, u) {
  for (let i = 0; i < 70; i++) { const mid = (d + u) / 2; if (isDef(mid)) d = mid; else u = mid; }
  return d;
}
function bisect(g, a, b) {
  let ga = g(a);
  for (let i = 0; i < 100; i++) {
    const m = (a + b) / 2;
    const gm = g(m);
    if (gm === 0) return m;
    if ((ga < 0) === (gm < 0)) { a = m; ga = gm; } else b = m;
  }
  return (a + b) / 2;
}
function goldenMin(f, a, b) {
  const phi = (Math.sqrt(5) - 1) / 2;
  let c = b - phi * (b - a);
  let d = a + phi * (b - a);
  for (let i = 0; i < 120; i++) { if (f(c) < f(d)) b = d; else a = c; c = b - phi * (b - a); d = a + phi * (b - a); }
  return (a + b) / 2;
}

/** All real zeros of g on [lo, hi]: sign changes (poles rejected), zeros on a domain edge, and tangent minima of |g|. */
export function scanRoots(g, lo, hi, N = 400000) {
  const step = (hi - lo) / N;
  const roots = [];
  const add = (r) => { if (!roots.some((q) => Math.abs(q - r) < 1e-6)) roots.push(r); };
  const isDef = (x) => fin(g(x));
  let x1 = null; let v1 = NaN; let v0 = NaN; let x0 = null;
  for (let i = 0; i <= N; i++) {
    const x = lo + step * 0.123456789 + i * step;
    const v = g(x);
    if (x1 !== null) {
      const d1 = fin(v1);
      const d = fin(v);
      if (d1 && d) {
        if (v1 === 0) add(x1);
        else if ((v1 < 0 && v > 0) || (v1 > 0 && v < 0)) { const r = bisect(g, x1, x); if (Math.abs(g(r)) < 1e-6) add(r); }
        if (fin(v0) && Math.abs(v1) < Math.abs(v0) && Math.abs(v1) <= Math.abs(v) && Math.abs(v1) < 1) {
          const r = goldenMin((t) => Math.abs(g(t)), x0, x);
          if (Math.abs(g(r)) < 1e-9) add(r);
        }
      } else if (d1 !== d) {
        const b = d1 ? edge(isDef, x1, x) : edge(isDef, x, x1);
        if (Math.abs(g(b)) < 1e-6) add(b);
      }
    }
    x0 = x1; v0 = v1; x1 = x; v1 = v;
  }
  return roots.sort((a, b) => a - b);
}

/** Sample points: a dense offset grid, small integers / halves / thirds (poles!), and neighbourhoods of the given endpoints. */
function samples(lo, hi, n, ends, big) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push(lo + 0.0123456789 + (i * (hi - lo)) / n);
  for (let k = Math.ceil(lo * 6); k <= Math.floor(hi * 6); k++) out.push(k / 6);
  for (const e of ends) if (fin(e)) for (const d of [0, 1e-3, -1e-3, 1e-2, -1e-2, 0.1, -0.1]) out.push(e + d);
  out.push(...big);
  return out;
}
const endpoints = (parts) => parts.flatMap((p) => [p.lo, p.hi]).filter(fin);

/* ---------- circles ---------- */
function circleOf(rel) {
  const g = (x, y) => rel.sides[0]({ x, y }) - rel.sides[1]({ x, y });
  const D = (g(1, 0) - g(-1, 0)) / 2;
  const E = (g(0, 1) - g(0, -1)) / 2;
  const F = (g(1, 0) + g(-1, 0)) / 2 - 1;
  const ok = [[2, 3], [-1.5, 0.5], [4, -2]].every(([x, y]) => Math.abs(g(x, y) - (x * x + y * y + D * x + E * y + F)) < 1e-9);
  const r2 = D * D / 4 + E * E / 4 - F;
  if (!ok || !(r2 > 0)) throw new Error('first equation is not a circle');
  return { cx: -D / 2, cy: -E / 2, r: Math.sqrt(r2) };
}

/** Distinct intersection points of the circle with the curve g2(x, y) = 0. */
function circleCurve(c, g2) {
  const F = (t) => g2(c.cx + c.r * Math.cos(t), c.cy + c.r * Math.sin(t));
  // start at an odd angle so a tangent point is not cut by the seam; the ends of the range are the same point (deduped below)
  const a0 = 0.71234;
  const roots = scanRoots(F, a0, a0 + 2 * Math.PI, 8000);
  const pts = roots.map((t) => [c.cx + c.r * Math.cos(t), c.cy + c.r * Math.sin(t)]);
  const out = [];
  for (const p of pts) if (!out.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-5)) out.push(p);
  return out;
}

/* ---------- polynomial / quadratic helpers for parameter equations ---------- */
function quadraticOf(g, m) {
  const c0 = g(0, m); const a = g(1, m); const b = g(-1, m);
  if (![c0, a, b].every(fin)) return null;
  const c2 = (a + b) / 2 - c0;
  const c1 = (a - b) / 2;
  const ok = [2, -2, 0.5, 3].every((x) => { const v = g(x, m); return fin(v) && Math.abs(v - (c0 + c1 * x + c2 * x * x)) <= 1e-9 * (1 + Math.abs(v)); });
  return ok ? { c2, c1, c0 } : null;
}
function quadRoots({ c2, c1, c0 }) {
  const scale = 1 + Math.abs(c1) + Math.abs(c2) + Math.abs(c0);
  if (Math.abs(c2) <= 1e-12 * scale) {
    if (Math.abs(c1) <= 1e-12 * scale) return Math.abs(c0) <= 1e-12 * scale ? Infinity : [];
    return [-c0 / c1];
  }
  const disc = c1 * c1 - 4 * c2 * c0;
  const tol = 1e-9 * (c1 * c1 + Math.abs(4 * c2 * c0) + 1);
  if (disc < -tol) return [];
  if (disc <= tol) return [-c1 / (2 * c2)];
  const s = Math.sqrt(disc);
  return [(-c1 - s) / (2 * c2), (-c1 + s) / (2 * c2)].sort((p, q) => p - q);
}
const PROPS = {
  none: (r) => r.length === 0,
  one: (r) => r.length === 1,
  two: (r) => r.length === 2,
  twoPos: (r) => r.length === 2 && r[0] > 0 && r[1] > 0,
};

/* ---------- per exercise ---------- */
function countCanon(a) { return a.vals ? a.vals.length : a.pts ? a.pts.length : a.parts.length; }

function checkSolve(e, want, err) {
  const rel = parseRelation(e.eq[0]);
  const v = (x) => ({ x });
  const R = (e.range || [-40, 40]);
  const big = e.family === 'exponent' ? [-150, 150] : [-1e5, -1e3, 1e3, 1e5];
  const defined = (x) => rel.sides.every((s) => fin(s(v(x))));
  // domain
  if (!e.domain || !HEB.test(e.domain.text || '')) err('solve exercise needs a Hebrew domain text');
  let dom;
  try { dom = normUnion(parseIntervals(e.domain.set)); } catch (x) { err(`bad domain set: ${x.message}`); return; }
  const dends = endpoints(dom);
  // e.polesNear: poles whose huge exponents overflow to Infinity close to the pole; those samples say nothing about the domain
  const overflow = (x) => (e.polesNear || []).some((p) => Math.abs(x - p) < 0.2 && x !== p);
  for (const x of samples(R[0], R[1], 60000, dends, big)) {
    if (overflow(x)) continue;
    if (defined(x) !== inUnion(dom, x)) { err(`domain wrong at x=${x}: defined=${defined(x)} claimed=${inUnion(dom, x)}`); break; }
  }
  const sat = (x) => holds(rel, v(x));
  const ineq = rel.ops.some((op) => op !== '=');
  if (want.kind === 'interval') {
    const ends = [...endpoints(want.parts), ...dends];
    for (const x of samples(R[0], R[1], 60000, ends, big)) {
      if (sat(x) !== inUnion(want.parts, x)) { err(`answer wrong at x=${x}: statement holds=${sat(x)} claimed=${inUnion(want.parts, x)}`); break; }
    }
    // a claimed solution must lie inside the domain
    for (const p of want.parts) if (p.lo === p.hi && !defined(p.lo)) err(`isolated point ${p.lo} is outside the domain`);
    return;
  }
  if (ineq || want.kind !== 'set') { err('this statement needs an interval answer'); return; }
  const g = (x) => rel.sides[0](v(x)) - rel.sides[1](v(x));
  const found = scanRoots(g, R[0], R[1], 400000);
  const claimed = want.vals;
  for (const f of found) if (!claimed.some((c) => Math.abs(c - f) < 1e-5)) err(`scan found an unlisted solution x≈${f}`);
  for (const c of claimed) {
    if (!found.some((f) => Math.abs(c - f) < 1e-5)) err(`claimed solution ${c} was not found by the scan`);
    if (!sat(c)) err(`claimed solution ${c} does not satisfy the statement`);
    if (!inUnion(dom, c)) err(`claimed solution ${c} is outside the claimed domain`);
  }
  // listed extraneous roots: satisfy the derived equation, but not the statement
  for (const t of e.trapRoots || []) {
    const x = evalExact(t);
    if (sat(x)) err(`trap root ${t} actually satisfies the statement`);
    if (claimed.some((c) => Math.abs(c - x) < 1e-6)) err(`trap root ${t} is listed as a solution`);
    if (e.derived) { const d = parseRelation(e.derived); if (!holds(d, v(x))) err(`trap root ${t} does not satisfy the derived equation "${e.derived}"`); }
  }
}

function checkParam(e, want, err) {
  const m = e.param;
  const R = e.range || [-12, 12];
  const prop = PROPS[e.prop];
  if (!prop) { err(`unknown prop ${e.prop}`); return; }
  let count;
  if (e.eq.length === 1) {
    const rel = parseRelation(e.eq[0]);
    const g = (x, p) => rel.sides[0]({ x, [m]: p }) - rel.sides[1]({ x, [m]: p });
    count = (p) => {
      const q = quadraticOf(g, p);
      const roots = q ? quadRoots(q) : scanRoots((x) => g(x, p), ...(e.xscan || [-40, 40, 24000]));
      return roots === Infinity ? [NaN, NaN, NaN] : roots;
    };
  } else {
    const c = circleOf(parseRelation(e.eq[0]));
    const rel2 = parseRelation(e.eq[1]);
    count = (p) => circleCurve(c, (x, y) => rel2.sides[0]({ x, y, [m]: p }) - rel2.sides[1]({ x, y, [m]: p })).map((pt) => pt[0]);
  }
  const holdsFor = (p) => prop(count(p));
  const member = want.kind === 'set' ? (p) => want.vals.some((v) => Math.abs(v - p) < 1e-9) : (p) => inUnion(want.parts, p);
  const ends = want.kind === 'set' ? want.vals : endpoints(want.parts);
  const pts = [];
  for (let i = 0; i <= 240; i++) pts.push(R[0] + 0.0123456789 + (i * (R[1] - R[0])) / 240);
  for (let k = Math.ceil(R[0] * 4); k <= Math.floor(R[1] * 4); k++) pts.push(k / 4);
  for (const x of ends) for (const d of [0, 1e-3, -1e-3, 1e-2, -1e-2, 0.1, -0.1, 0.5, -0.5]) pts.push(x + d);
  for (const p of pts) {
    if (holdsFor(p) !== member(p)) { err(`parameter case wrong at ${m}=${p}: property "${e.prop}" is ${holdsFor(p)}, claimed ${member(p)}`); break; }
  }
}

function checkSystem(e, want, err) {
  const c = circleOf(parseRelation(e.eq[0]));
  const rel2 = parseRelation(e.eq[1]);
  const pts = circleCurve(c, (x, y) => rel2.sides[0]({ x, y }) - rel2.sides[1]({ x, y }));
  for (const p of pts) for (const rel of e.eq.map(parseRelation)) if (!holds(rel, { x: p[0], y: p[1] })) err(`found point (${p}) does not satisfy a statement`);
  let got;
  if (e.derive === 'chord') {
    if (pts.length !== 2) { err(`chord needs exactly 2 intersection points, scan found ${pts.length}`); return; }
    got = { kind: 'number', vals: [Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1])] };
  } else got = { kind: 'points', pts: pts.map((p) => [p[0], p[1]]).sort((p, q) => p[0] - q[0] || p[1] - q[1]) };
  if (!sameCanon(got, want)) err(`scan result ${JSON.stringify(got.vals || got.pts)} differs from the stored answer`);
  if (want.kind === 'points') {
    for (const p of want.pts) for (const rel of e.eq.map(parseRelation)) if (!holds(rel, { x: p[0], y: p[1] })) err(`stored point (${p}) does not satisfy a statement`);
  }
}

export function validate(data = loadAll()) {
  const errors = [];
  const stats = { exercises: data.length, byFamily: {}, byTier: {}, traps: 0, hints: 0, wrongs: 0, solve: 0, param: 0, system: 0 };
  const ids = new Set();
  for (const e of data) {
    const err = (m) => errors.push(`${e.id}: ${m}`);
    if (!validExercise(e)) { err('missing or malformed field'); continue; }
    if (ids.has(e.id)) err('duplicate id');
    ids.add(e.id);
    stats.byFamily[e.family] = (stats.byFamily[e.family] || 0) + 1;
    stats.byTier[e.tier] = (stats.byTier[e.tier] || 0) + 1;
    if (!HEB.test(e.title) || !HEB.test(e.ask)) err('title and ask must be Hebrew');
    if (e.steps.length < 3 || !e.steps.every((s) => typeof s === 'string' && s.length > 5)) err('needs at least 3 worked steps');
    if (e.hints.some((h) => !HEB.test(h)) || e.hints[0] === e.hints[1]) err('two different Hebrew hints required');
    stats.hints += e.hints.length;
    if (e.trap) { stats.traps++; if (!e.trap.kind || !HEB.test(e.trap.text || '')) err('trap needs kind and Hebrew text'); }
    let want;
    try { want = canonSpec(e.answer); } catch (x) { err(`bad answer: ${x.message}`); continue; }
    try {
      if (e.kind === 'solve') { stats.solve++; checkSolve(e, want, err); }
      else if (e.kind === 'param') { stats.param++; if (!['set', 'interval'].includes(want.kind)) err('parameter answers are sets or intervals'); checkParam(e, want, err); }
      else if (e.kind === 'system') { stats.system++; if (!['points', 'number'].includes(want.kind)) err('system answers are points or a number'); checkSystem(e, want, err); }
      else err(`unknown kind ${e.kind}`);
    } catch (x) { err(`verifier crashed: ${x.message}`); }
    for (const w of e.wrongs || []) {
      stats.wrongs++;
      try {
        const c = canonSpec(w.answer);
        if (c.kind !== want.kind) err('a typical wrong answer must have the same kind as the answer');
        else if (sameCanon(c, want)) err(`typical wrong answer equals the right answer: ${JSON.stringify(w.answer)}`);
        if (!HEB.test(w.msg || '')) err('wrong-answer message must be Hebrew');
      } catch (x) { err(`bad wrong answer: ${x.message}`); }
    }
    void countCanon;
  }
  for (const f of FAMILIES) for (const t of TIERS) {
    if (!data.some((e) => e.family === f.id && e.tier === t.id)) errors.push(`family ${f.id} has no tier ${t.id} exercise`);
  }
  if (data.length < 40) errors.push(`expected at least 40 exercises, found ${data.length}`);
  return { errors, stats };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const t0 = Date.now();
  const { errors, stats } = validate();
  console.log(`mathhard: ${stats.exercises} exercises ${JSON.stringify(stats.byFamily)} tiers ${JSON.stringify(stats.byTier)}`);
  console.log(`  solve ${stats.solve}, param ${stats.param}, system ${stats.system}, traps ${stats.traps}, hints ${stats.hints}, typical wrong answers ${stats.wrongs} (${Date.now() - t0} ms)`);
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('OK: every statement, domain and answer verified numerically.');
}

// Independent verifier for data/transfer.json (the 24 reserved transfer-test questions). It never trusts a stored answer:
//  - math: the displayed statement (or the explicit "parse" form when the display uses symbols the app parser cannot read)
//    is evaluated numerically and solved by scanning: root counting for parameter families, sign-scan inequalities,
//    tangency by minimum distance, polar scan for the quadratic system, circle/circle intersection by angle scan;
//  - physics: every part is recomputed from the stem's numbers with a different method than the stored solution text
//    (position functions + root finding, golden/ternary maxima, exact-step simulation, staircase collision simulation).
// It also proves the questions are reserved: no reserved id or statement appears in any other data file or js module.
// Usage: node tools/verify-transfer.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseRelation, holds, parseIntervals, normUnion, inUnion, canonSpec, evalExact } from '../js/mathhard.js';
import { scanRoots } from './verify-mathhard.mjs';
import { validItem, ID_PREFIX } from '../js/transfer.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HEB = /[֐-׿]/;
const DEG = Math.PI / 180;
const norm = (s) => String(s).replace(/\s+/g, '').replace(/[−–]/g, '-').replace(/·/g, '*').toLowerCase();

export function loadTransfer() { return JSON.parse(readFileSync(path.join(ROOT, 'data/transfer.json'), 'utf8')); }

/* ---------- numeric helpers ---------- */
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * (1 + Math.abs(a) + Math.abs(b));
function ternaryMax(f, lo, hi) {
  for (let i = 0; i < 300; i++) { const a = lo + (hi - lo) / 3; const b = hi - (hi - lo) / 3; if (f(a) < f(b)) lo = a; else hi = b; }
  return (lo + hi) / 2;
}
const firstRoot = (g, lo, hi) => { const r = scanRoots(g, lo, hi, 20000); return r.length ? r[0] : NaN; };
const roots = (g, lo, hi, N = 60000) => scanRoots(g, lo, hi, N);
const slope = (f, t, h = 1e-5) => (f(t + h) - f(t - h)) / (2 * h);
const rel = (src) => parseRelation(src);
const side = (r, vars) => r.sides[0](vars) - r.sides[1](vars);

/* ---------- math solvers: each returns { kind, check(answerCanon) -> [errors] } ---------- */
const canonOf = (q) => canonSpec(q.answer);
const exprs = (q) => (q.parse || q.eq);

function checkSet(q, found, tag = 'solutions') {
  const want = canonOf(q).vals;
  const got = [...found].sort((a, b) => a - b);
  const errs = [];
  if (got.length !== want.length || !got.every((v, i) => near(v, want[i], 1e-6))) errs.push(`${tag}: scan found [${got.map((v) => v.toPrecision(8)).join(', ')}], stored [${want.map((v) => v.toPrecision(8)).join(', ')}]`);
  return errs;
}

/** Sampled agreement between "relation holds" and "x is in the stored union", incl. every endpoint and its neighbourhood. */
function checkInequality(q, holdsAt, lo = -40, hi = 40) {
  const union = canonOf(q).parts;
  const xs = [];
  for (let i = 0; i <= 40000; i++) xs.push(lo + 0.00123456 + (i * (hi - lo)) / 40000);
  for (let k = Math.ceil(lo * 4); k <= Math.floor(hi * 4); k++) xs.push(k / 4);
  for (const p of union) for (const e of [p.lo, p.hi]) if (Number.isFinite(e)) for (const d of [0, 1e-3, -1e-3, 0.05, -0.05]) xs.push(e + d);
  const errs = [];
  for (const x of xs) {
    const exact = union.some((p) => [p.lo, p.hi].some((e) => Number.isFinite(e) && near(e, x, 1e-12)));
    // exactly at a stored endpoint the closed / open flag is what the relation must confirm
    const inside = inUnion(union, x);
    const h = holdsAt(x);
    if (h !== inside && !(exact && false)) { errs.push(`x = ${x}: relation ${h ? 'holds' : 'fails'} but stored interval says ${inside ? 'inside' : 'outside'}`); if (errs.length > 3) break; }
  }
  return errs;
}

function circleOfRel(r) {
  const g = (x, y) => side(r, { x, y });
  const D = (g(1, 0) - g(-1, 0)) / 2;
  const E = (g(0, 1) - g(0, -1)) / 2;
  const F = (g(1, 0) + g(-1, 0)) / 2 - 1;
  const ok = [[2, 3], [-1.5, 0.5], [4, -2]].every(([x, y]) => Math.abs(g(x, y) - (x * x + y * y + D * x + E * y + F)) < 1e-9);
  const r2 = D * D / 4 + E * E / 4 - F;
  if (!ok || !(r2 > 0)) throw new Error('not a circle');
  return { cx: -D / 2, cy: -E / 2, r: Math.sqrt(r2), g };
}

export const MATH = {
  // sqrt(x + a) = x : number of real solutions as a function of a
  'tr-m-01'(q) {
    const r = rel(exprs(q)[0]);
    // |a| <= 40 keeps every root below x = 7: scanning [-45, 45] densely enough to separate roots 0.001 apart
    // a second, fine scan starts at the domain edge x = -a: a root can sit within 1e-4 of it
    const count = (a) => {
      const g = (x) => side(r, { x, a });
      const all = [...roots(g, -45, 45, 9000), ...roots(g, -a + 1e-9, -a + 0.5, 9000), ...roots(g, -a + 1e-13, -a + 1e-5, 3000)].filter((x) => holds(r, { x, a }));
      return all.filter((x, i) => all.findIndex((y) => Math.abs(x - y) < 1e-6) === i).length;
    };
    const union = canonOf(q).parts;
    const errs = [];
    const as = [-0.25, -0.2501, -0.2499, 0, 1e-4, -1e-4, -0.1, -1, -5, 0.3, 1, 2, 7.5, 40];
    for (let a = -3; a <= 3; a += 0.0437) as.push(a);
    for (const a of as) if ((count(a) === 1) !== inUnion(union, a)) { errs.push(`a = ${a}: scan finds ${count(a)} solution(s), stored interval says ${inUnion(union, a) ? 'one' : 'not one'}`); if (errs.length > 3) break; }
    return errs;
  },
  'tr-m-02'(q) {
    const r = rel(exprs(q)[0]);
    return checkSet(q, roots((x) => side(r, { x }), 1e-6, 80).filter((x) => holds(r, { x })));
  },
  'tr-m-03'(q) { const r = rel(exprs(q)[0]); return checkInequality(q, (x) => holds(r, { x })); },
  // line y = kx + 1 tangent to a circle: distance from the centre to the line equals the radius, found by minimising numerically
  'tr-m-04'(q) {
    const c = circleOfRel(rel(exprs(q)[0]));
    const dist = (k) => { // min over x of the distance from the centre to the point (x, kx + 1)
      const f = (x) => -Math.hypot(x - c.cx, k * x + 1 - c.cy);
      const x = ternaryMax(f, -2000, 2000);
      return -f(x) - c.r;
    };
    return checkSet(q, roots(dist, -60, 60, 2400), 'tangent slopes');
  },
  'tr-m-05'(q) {
    if (!/sin⁶x \+ cos⁶x = 7\/16/.test(q.eq[0]) || !/0° ≤ x < 180°/.test(q.ask)) return ['statement text changed: the degree solver assumes sin⁶x + cos⁶x = 7/16 on [0°, 180°)'];
    const g = (x) => Math.sin(x * DEG) ** 6 + Math.cos(x * DEG) ** 6 - 7 / 16;
    return checkSet(q, roots(g, 0.001, 179.999));
  },
  // x^2 + xy = c1, y^2 + xy = c2: polar scan, scale r solved from the first equation
  'tr-m-06'(q) {
    const [r1, r2] = q.eq.map(rel);
    const c1 = r1.sides[1]({}); const c2 = r2.sides[1]({});
    const A = (t) => r1.sides[0]({ x: Math.cos(t), y: Math.sin(t) });
    const B = (t) => r2.sides[0]({ x: Math.cos(t), y: Math.sin(t) });
    const F = (t) => c2 * A(t) - c1 * B(t); // r^2 A = c1 and r^2 B = c2 can both hold only if c2 A = c1 B
    const pts = [];
    for (const t of roots(F, 0.01234, 0.01234 + 2 * Math.PI)) {
      const a = A(t);
      if (!(a * c1 > 0)) continue;
      const rr = Math.sqrt(c1 / a);
      const p = [rr * Math.cos(t), rr * Math.sin(t)];
      if (holds(r1, { x: p[0], y: p[1] }) && holds(r2, { x: p[0], y: p[1] }) && !pts.some((o) => near(o[0], p[0]) && near(o[1], p[1]))) pts.push(p);
    }
    const want = canonOf(q).pts;
    const got = pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return got.length === want.length && got.every((p, i) => near(p[0], want[i][0]) && near(p[1], want[i][1])) ? []
      : [`system: scan found ${JSON.stringify(got)}, stored ${JSON.stringify(want)}`];
  },
  'tr-m-07'(q) { const r = rel(exprs(q)[0]); return checkSet(q, roots((x) => side(r, { x }), -60, 60).filter((x) => holds(r, { x }))); },
  'tr-m-08'(q) { const r = rel(exprs(q)[0]); return checkInequality(q, (x) => holds(r, { x }), -30, 30); },
  'tr-m-09'(q) { const r = rel(exprs(q)[0]); return checkInequality(q, (x) => holds(r, { x }), -30, 30); },
  // (a - 2)x^2 - 2a x + a + 3 = 0 has two distinct positive roots: exact quadratic per value of the parameter
  'tr-m-10'(q) {
    const r = rel(exprs(q)[0]);
    const g = (x, a) => side(r, { x, a });
    const two = (a) => {
      const c0 = g(0, a); const c2 = (g(1, a) + g(-1, a)) / 2 - c0; const c1 = (g(1, a) - g(-1, a)) / 2;
      if (Math.abs(c2) < 1e-12) return false; // linear: at most one root
      const d = c1 * c1 - 4 * c2 * c0;
      if (d <= 1e-12) return false;
      return (-c1 + Math.sqrt(d)) / (2 * c2) > 1e-12 && (-c1 - Math.sqrt(d)) / (2 * c2) > 1e-12;
    };
    const union = canonOf(q).parts;
    const as = [-3, 2, 6, -3.0001, -2.9999, 1.9999, 2.0001, 5.9999, 6.0001, 0, -50, 50];
    for (let a = -12; a <= 12; a += 0.0173) as.push(a);
    const errs = [];
    for (const a of as) if (two(a) !== inUnion(union, a)) { errs.push(`a = ${a}: exact count says ${two(a) ? 'two positive roots' : 'not two positive roots'}, stored interval disagrees`); if (errs.length > 3) break; }
    return errs;
  },
  // chord between two circles: intersection points by an angle scan of the first circle
  'tr-m-11'(q) {
    const c1 = circleOfRel(rel(exprs(q)[0]));
    const c2 = circleOfRel(rel(exprs(q)[1]));
    const F = (t) => c2.g(c1.cx + c1.r * Math.cos(t), c1.cy + c1.r * Math.sin(t));
    const ts = roots(F, 0.7123, 0.7123 + 2 * Math.PI);
    const pts = ts.map((t) => [c1.cx + c1.r * Math.cos(t), c1.cy + c1.r * Math.sin(t)]);
    if (pts.length !== 2) return [`expected 2 intersection points, scan found ${pts.length}`];
    const len = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
    const want = canonOf(q).vals[0];
    return near(len, want, 1e-8) ? [] : [`chord length: scan ${len}, stored ${want}`];
  },
  'tr-m-12'(q) { const r = rel(exprs(q)[0]); return checkInequality(q, (x) => holds(r, { x }), -30, 30); },
};

/* ---------- physics solvers: each returns the values of parts a, b, c, ... ---------- */
export const PHYS = {
  'tr-p-01'() {
    const car = (t) => 0.5 * 2 * t * t; const truck = (t) => 75 + 10 * t; const gap = (t) => truck(t) - car(t);
    const tMax = ternaryMax(gap, 0, 40);
    const tCatch = firstRoot(gap, 0.001, 100);
    return [tMax, gap(tMax), tCatch, slope(car, tCatch), car(tCatch)];
  },
  'tr-p-02'() {
    const v = 25; const R = (th) => { const vx = v * Math.cos(th); const vy = v * Math.sin(th); const T = firstRoot((t) => vy * t - 5 * t * t, 1e-6, 20); return vx * T - 60; };
    const t1 = firstRoot(R, 1 * DEG, 45 * DEG); const t2 = firstRoot(R, 45.0001 * DEG, 89 * DEG);
    const fly = (th) => firstRoot((t) => v * Math.sin(th) * t - 5 * t * t, 1e-6, 20);
    const hmax = (th) => { const y = (t) => v * Math.sin(th) * t - 5 * t * t; return y(ternaryMax(y, 0, 10)); };
    return [Math.sin(2 * t1), t1 / DEG, fly(t1), fly(t2), hmax(t1)];
  },
  'tr-p-03'() {
    const pts = [[0, 2], [4, 14], [10, 14], [14, 0]];
    const v = (t) => { for (let i = 0; i < pts.length - 1; i++) { const [t0, v0] = pts[i]; const [t1, v1] = pts[i + 1]; if (t >= t0 && t <= t1) return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0); } return NaN; };
    const area = (T) => { const n = 280000; let s = 0; for (let i = 0; i < n; i++) s += ((v((i * T) / n) + v(((i + 1) * T) / n)) / 2) * (T / n); return s; };
    const acc1 = (v(3) - v(1)) / 2;
    const t8 = firstRoot((t) => v(t) - 8, 0.0001, 3.9999);
    const dec = -(v(13.9) - v(11)) / 2.9;
    return [acc1, t8, area(14), dec, area(12)];
  },
  'tr-p-04'() {
    const H = 45; const tFall = firstRoot((t) => H - 5 * t * t, 0.001, 20);
    const boat = (t) => 36 + 4 * t; const v0 = boat(tFall) / tFall; // the stone's x(t) = v0 t must equal the boat's position at landing
    const vy = 10 * tFall;
    return [tFall, boat(tFall), v0, Math.hypot(v0, vy), Math.atan2(vy, v0) / DEG];
  },
  'tr-p-05'() {
    const yA = (t) => 30 * t - 5 * t * t; const yB = (t) => 60 - 5 * t * t;
    const tm = firstRoot((t) => yA(t) - yB(t), 0.001, 20);
    const tA = firstRoot(yA, 0.001, 20); const tB = firstRoot(yB, 0.001, 20);
    return [tm, yA(tm), slope(yA, tm), Math.abs(slope(yB, tm)), tA - tB];
  },
  'tr-p-06'() {
    const dt = 1e-5; const a = 6;
    const stop = (v0) => { let v = v0; let d = 0; let t = 0; while (v > 0) { const step = Math.min(dt, v / a); d += v * step - 0.5 * a * step * step; v -= a * step; t += step; } return { d, t }; };
    const reaction = (v0) => v0 * 0.8;
    const b = stop(30);
    // part d: speed at the obstacle (100 m away) when starting at 35 m/s
    let v = 35; let d = reaction(35);
    while (d < 100 && v > 0) { const step = dt; d += v * step - 0.5 * a * step * step; v -= a * step; }
    return [reaction(30), b.d, 100 - reaction(30) - b.d, v, 0.8 + b.t];
  },
  'tr-p-07'() {
    const y = (t) => 32 + 12 * t - 5 * t * t;
    const T = firstRoot(y, 0.001, 30);
    return [T, 16 * T, y(ternaryMax(y, 0, 10)), Math.abs(slope(y, T)), firstRoot((t) => y(t) - 32, 0.001, 30)];
  },
  'tr-p-08'() {
    const y1 = (t) => 5 * t * t;
    const T1 = firstRoot((t) => y1(t) - 125, 0.001, 30);
    const d = T1 - 1; // second stone lands at the same moment, one second later start
    let lo = 0; let hi = 100; // initial speed v: v d + 5 d^2 = 125
    for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (mid * d + 5 * d * d < 125) lo = mid; else hi = mid; }
    const v = (lo + hi) / 2;
    const y2 = (s) => v * s + 5 * s * s;
    return [T1, d, v, v + 10 * d, y1(3) - y2(2)];
  },
  'tr-p-09'() {
    const W = 80; const boat = 4; const cur = 3;
    const t = W / boat; const drift = cur * t;
    // heading phi upstream of the perpendicular so that the along-bank speed is zero: cur - boat sin(phi) = 0
    const phi = firstRoot((p) => cur - boat * Math.sin(p), 0.001, Math.PI / 2 - 0.001);
    return [t, drift, Math.hypot(boat, cur), Math.atan2(boat, cur) / DEG, W / (boat * Math.cos(phi))];
  },
  'tr-p-10'() {
    const y = (t) => 30 + 5 * t - 5 * t * t;
    const T = firstRoot(y, 0.001, 30);
    return [T, y(ternaryMax(y, 0, 5)), Math.abs(slope(y, T)), (30 + 5 * T) - 0, firstRoot((t) => y(t) - 30, 0.001, 30)];
  },
  // staircase: tread k lies at depth 0.8 k and spans 1.1 (k - 1) < x <= 1.1 k; the ball is stopped by the first tread it reaches
  'tr-p-11'() {
    const H = 0.8; const W = 1.1; const vx = 5; const dt = 1e-6;
    const depth = (x) => H * Math.ceil(x / W - 1e-12);
    let t = dt;
    while (5 * t * t < depth(vx * t)) t += dt;
    const x = vx * t;
    return [Math.ceil(x / W - 1e-12), t, x, 10 * t, Math.atan2(10 * t, vx) / DEG];
  },
  'tr-p-12'() {
    // exact constant-acceleration steps (velocity Verlet): burn 8 s at +5, then free flight
    const dt = 1e-5; let t = 0; let y = 0; let v = 0;
    const step = (acc) => { y += v * dt + 0.5 * acc * dt * dt; v += acc * dt; t += dt; };
    for (let i = 0; i < 800000; i++) step(5);
    const vCut = v; const yCut = y; let apex = y;
    while (y > 0) { step(-10); if (y > apex) apex = y; }
    return [vCut, yCut, apex, t, Math.abs(v)];
  },
};

/* ---------- reserved-ness ---------- */
function listFiles(dir, ext) {
  const out = [];
  for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (e.isDirectory()) { if (e.name !== 'vendor' && e.name !== 'node_modules') out.push(...listFiles(path.join(dir, e.name), ext)); } else if (ext.some((x) => e.name.endsWith(x))) out.push(path.join(dir, e.name));
  }
  return out;
}
const OWN_FILES = new Set(['data/transfer.json', 'js/transfer.js', 'js/transfer-ui.js']);

export function reservedLeaks(items) {
  const ids = items.map((q) => q.id);
  const errors = [];
  const files = ['index.html', 'sw.js', ...listFiles('data', ['.json']), ...listFiles('js', ['.js'])].map((f) => f.replace(/\\/g, '/'));
  const eqs = new Map();
  for (const q of items) for (const e of q.subject === 'math' ? q.eq : [q.stem]) eqs.set(norm(e), q.id);
  for (const f of files) {
    if (OWN_FILES.has(f)) continue;
    const text = readFileSync(path.join(ROOT, f), 'utf8');
    for (const id of ids) if (text.includes(id)) errors.push(`${f} mentions reserved id ${id}`);
    if (/tr-[mp]-\d/.test(text)) errors.push(`${f} contains a reserved-looking id`);
    // the same statement text anywhere else would make a question not "unseen"
    const flat = norm(text);
    for (const [e, id] of eqs) if (e.length > 14 && flat.includes(norm(JSON.stringify(e).slice(1, -1)))) errors.push(`${f} contains the statement of ${id}`);
  }
  return errors;
}

/* ---------- main validation ---------- */
export function validate(items = loadTransfer()) {
  const errors = [];
  const stats = { math: 0, physics: 0, parts: 0, scans: 0 };
  const err = (id, m) => errors.push(`${id}: ${m}`);
  const seen = new Set();
  for (const q of items) {
    if (seen.has(q.id)) err(q.id, 'duplicate id');
    seen.add(q.id);
    if (!validItem(q)) { err(q.id, 'fails validItem'); continue; }
    if (!q.id.startsWith(ID_PREFIX)) err(q.id, 'id must start with tr-');
    if (!HEB.test(q.title)) err(q.id, 'title must be Hebrew');
    if (q.budget < 240 || q.budget > 900) err(q.id, `suspicious budget ${q.budget}`);
    if (q.subject === 'math') {
      stats.math++;
      if (!HEB.test(q.ask)) err(q.id, 'ask must be Hebrew');
      if (q.steps.filter((s) => HEB.test(s)).length * 2 < q.steps.length) err(q.id, 'most steps must contain Hebrew explanation');
      try { canonOf(q); } catch (e) { err(q.id, `answer does not parse: ${e.message}`); continue; }
      const solver = MATH[q.id];
      if (!solver) { err(q.id, 'no independent solver'); continue; }
      try { stats.scans++; for (const m of solver(q)) err(q.id, m); } catch (e) { err(q.id, `solver failed: ${e.message}`); }
    } else {
      stats.physics++;
      if (!HEB.test(q.stem)) err(q.id, 'stem must be Hebrew');
      const solver = PHYS[q.id];
      if (!solver) { err(q.id, 'no independent solver'); continue; }
      let got;
      try { got = solver(); } catch (e) { err(q.id, `solver failed: ${e.message}`); continue; }
      if (got.length !== q.parts.length) { err(q.id, `solver gives ${got.length} values for ${q.parts.length} parts`); continue; }
      q.parts.forEach((p, i) => {
        stats.parts++;
        if (!HEB.test(p.ask) || !HEB.test(p.solution)) err(`${q.id}/${p.id}`, 'ask and solution must be Hebrew');
        if (!Number.isFinite(got[i]) || Math.abs(got[i] - p.answer) > 0.005 + 1e-9) err(`${q.id}/${p.id}`, `independent value ${got[i]} vs stored ${p.answer}`);
        if (Math.abs(p.answer * 100 - Math.round(p.answer * 100)) > 1e-9) err(`${q.id}/${p.id}`, 'stored answer must have at most two decimals');
      });
      if (q.diagram && !/^<svg[\s>]/.test(q.diagram)) err(q.id, 'diagram must be an <svg> string');
    }
  }
  if (stats.math !== 12) errors.push(`expected 12 math questions, found ${stats.math}`);
  if (stats.physics !== 12) errors.push(`expected 12 physics questions, found ${stats.physics}`);
  errors.push(...reservedLeaks(items));
  void parseIntervals; void normUnion; void evalExact;
  return { errors, stats };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const t0 = Date.now();
  const { errors, stats } = validate();
  console.log(`transfer: ${stats.math} math + ${stats.physics} physics questions, ${stats.parts} physics parts, ${stats.scans} math scans (${Date.now() - t0} ms)`);
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('OK: every answer and part verified independently; no reserved id or statement appears elsewhere.');
}

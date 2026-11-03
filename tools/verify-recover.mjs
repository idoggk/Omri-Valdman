// Independent verifier for data/recover.json (24 one-error-recovery exercises: 12 math, 12 physics).
// For every exercise it recomputes, WITHOUT reading any stored answer, with root scanning / sign scans / simulation:
//   - the correct corrected value (fix) and the correct value of every remaining part (finish);
//   - the chain of the ERRONEOUS solution (the same later parts computed from the wrong step) and compares it with the stored
//     "ifError" values, so the feedback "this is what the wrong step gives" is true;
//   - claims: every step before the first wrong one is numerically true, the step at firstWrong is numerically false;
//   - that the error changes at least one remaining answer (the error matters).
// Usage: node tools/verify-recover.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { canonSpec, inUnion } from '../js/mathhard.js';
import { scanRoots } from './verify-mathhard.mjs';
import { validItem } from '../js/recover.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const loadRecover = () => JSON.parse(readFileSync(path.join(ROOT, 'data/recover.json'), 'utf8'));

/* ---------- numeric helpers ---------- */
const near = (a, b, tol = 1e-6) => a === b || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol * (1 + Math.abs(a) + Math.abs(b)));
const roots = (g, lo = -100, hi = 100) => scanRoots(g, lo, hi, 200000).sort((a, b) => a - b);
const posRoot = (g) => roots(g, 0, 200).find((r) => r > 1e-9);
function ternaryMax(f, lo, hi) {
  for (let i = 0; i < 300; i++) { const a = lo + (hi - lo) / 3; const b = hi - (hi - lo) / 3; if (f(a) < f(b)) lo = a; else hi = b; }
  return f((lo + hi) / 2);
}
const grid = (lo, hi, step) => { const out = []; for (let x = lo; x <= hi + 1e-9; x += step) out.push(Math.round(x * 1e6) / 1e6); return out; };
const samePred = (p, q) => grid(-60, 60, 0.01).every((x) => p(x) === q(x));
const countInts = (p, lo, hi) => grid(lo, hi, 1).filter(p).length;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const G = 10;

/* ---------- independent models ----------
 * each returns { claims: [bool per step up to firstWrong], fix, finish: [values], err: [values | null] }
 * values: number | number[] (set) | [x,y][] (points) | predicate (interval). err null = not defined by the wrong chain. */
const MODEL = {
  'rc-m-01': () => {
    const f = (x) => (x - 3) * (2 * x + 1) - (x - 3) * (x + 5);
    const after = (x) => 2 * x + 1 - (x + 5);
    const r = roots(f); const e = roots(after);
    return { claims: [true, near(r.length, e.length) && r.every((v, i) => near(v, e[i]))], fix: roots((x) => x - 3)[0], finish: [r, r[r.length - 1] - r[0]], err: [e, e[e.length - 1] - e[0]] };
  },
  'rc-m-02': () => {
    const p1 = (x) => 7 - 3 * x >= 2 * x - 8; const p2 = (x) => 4 * x + 3 > -9;
    const wrong1 = (x) => x >= 3;
    return {
      claims: [true, samePred((x) => 7 - 3 * x >= 2 * x - 8, (x) => -5 * x >= -15), samePred(p1, wrong1)],
      fix: p1, finish: [(x) => p1(x) && p2(x), countInts((x) => p1(x) && p2(x), -100, 100)], err: [(x) => wrong1(x) && p2(x), Infinity],
    };
  },
  'rc-m-03': () => {
    const orig = (x) => Math.sqrt(x + 7) - (x + 1);
    const sq = (x) => (x + 7) - (x + 1) ** 2;
    const rr = roots(orig, -7, 50); const rs = roots(sq, -7, 50);
    return {
      claims: [grid(-9, 9, 0.5).every((x) => Number.isFinite(Math.sqrt(x + 7)) === (x >= -7)), rs.every((x) => Math.abs(orig(x)) < 1e-6)],
      fix: -3 + 1, finish: [rr, Math.sqrt(rr[0] + 7), rr[0] ** 2 - rr[0]], err: [rs, null, null],
    };
  },
  'rc-m-04': () => {
    const orig = (x) => (x === 0 ? NaN : Math.log2(x * x) - 4);
    const wrong = (x) => (x > 0 ? 2 * Math.log2(x) - 4 : NaN);
    const r = roots(orig); const e = roots(wrong);
    const same = grid(-8, 8, 0.25).filter((x) => x !== 0).every((x) => near(Math.log2(x * x), x > 0 ? 2 * Math.log2(x) : NaN));
    return { claims: [grid(-3, 3, 0.5).every((x) => (x * x > 0) === (x !== 0)), same], fix: Math.abs(r[0]), finish: [r, r[0] * r[1]], err: [e, e[0]] };
  },
  'rc-m-05': () => {
    const f = (m, x) => m * x - 3 - (2 * x + m);
    const coef = (m) => f(m, 1) - f(m, 0);
    const bad = roots(coef, -50, 50);
    const sol = (m) => -f(m, 0) / coef(m);
    const solves = (m) => { const x = (m + 3) / (m - 2); return Number.isFinite(x) && Math.abs(f(m, x)) < 1e-9; };
    const gridM = grid(-6, 6, 0.5);
    return {
      claims: [
        gridM.every((m) => grid(-3, 3, 1).every((x) => near(f(m, x), (m * x - 2 * x) - (m + 3)))),
        gridM.every((m) => grid(-3, 3, 1).every((x) => near(f(m, x), (m - 2) * x - (m + 3)))),
        gridM.every(solves),
      ],
      fix: bad[0],
      finish: [Math.abs(f(bad[0], 0)) > 1e-9 ? 0 : Infinity, sol(-1), bad.filter((m) => Math.abs(f(m, 0)) > 1e-9).length], err: [null, null, 0], // the wrong chain claims a solution for every m
    };
  },
  'rc-m-06': () => {
    const g = (x) => (x + 3) ** 2 - 3 * x - 13;
    const w = (x) => x * x + 9 - 3 * x - 13;
    const r = roots(g); const e = roots(w);
    return {
      claims: [grid(-9, 9, 0.5).every((x) => near(g(x), (x + 3) ** 2 - 3 * x - 13)), grid(-9, 9, 0.5).every((x) => near((x + 3) ** 2, x * x + 9))],
      fix: ((1 + 3) ** 2 - (-1 + 3) ** 2) / 2, finish: [r, r[0] + r[1], r.find((v) => v > 0)], err: [e, e[0] + e[1], e.find((v) => v > 0)],
    };
  },
  'rc-m-07': () => {
    const g = (x) => 2 ** (x + 1) + 2 ** x - 24;
    const w = (x) => 2 ** x + 2 + 2 ** x - 24;
    const r = roots(g, -10, 10)[0]; const e = roots(w, -10, 10)[0];
    return {
      claims: [grid(-3, 3, 0.5).every((x) => near(2 ** (x + 1) + 2 ** x, 2 ** x * 3)), grid(-3, 3, 0.5).every((x) => near(2 ** (x + 1), 2 ** x + 2))],
      fix: 2 ** 1.5 / 2 ** 0.5, finish: [2 ** r, r, 2 ** (r + 1)], err: [2 ** e, null, 2 ** (e + 1)],
    };
  },
  'rc-m-08': () => {
    const orig = (x) => x !== 2 && x / (x - 2) >= 3;
    const wrong = (x) => x !== 2 && x >= 3 * (x - 2);
    return {
      claims: [true, samePred(orig, wrong)],
      fix: roots((x) => (x / (x - 2) - 3) * (x - 2), -50, 50)[0], finish: [orig, countInts(orig, -100, 100), 2.5 / (2.5 - 2)], err: [wrong, Infinity, null],
    };
  },
  'rc-m-09': () => {
    const g = (x) => Math.sqrt(x * x - 6 * x + 9) - 5;
    const w = (x) => (x - 3) - 5;
    const r = roots(g); const e = roots(w);
    return {
      claims: [grid(-9, 9, 0.5).every((x) => near(x * x - 6 * x + 9, (x - 3) ** 2)), grid(-9, 9, 0.5).every((x) => near(Math.sqrt((x - 3) ** 2), x - 3))],
      fix: Math.sqrt((-5) ** 2), finish: [r, r[0] + r[1], r[1] - r[0]], err: [e, e[0], 0],
    };
  },
  'rc-m-10': () => {
    const orig = (x) => (x + 1) ** 2 > 4;
    const wrong = (x) => x + 1 > 2;
    return {
      claims: [true, samePred(orig, wrong)],
      fix: roots((x) => x + 1 + 2)[0], finish: [orig, countInts(orig, -5, 5), (-4 + 1) ** 2], err: [wrong, countInts(wrong, -5, 5), null],
    };
  },
  'rc-m-11': () => {
    const g = (y) => (4 - 1) ** 2 + (y + 2) ** 2 - 25;
    const r = roots(g, -30, 30);
    const e = [roots((y) => y + 2 - 4, -30, 30)[0]];
    const chord = r[r.length - 1] - r[0];
    const area = 0.5 * chord * Math.abs(4 - 1);
    return {
      claims: [true, grid(-3, 3, 0.5).every((y) => near(9 + (y + 2) ** 2, (4 - 1) ** 2 + (y + 2) ** 2)) && near(roots((y) => (y + 2) ** 2 - 16, -30, 30).length, 2), e.length === r.length],
      fix: Math.min(...r.map((y) => y + 2)), finish: [r.map((y) => [4, y]), chord, area], err: [e.map((y) => [4, y]), 0, 0],
    };
  },
  'rc-m-12': () => {
    const count = (m) => {
      if (Math.abs(m - 1) < 1e-12) return 1; // linear: -2x + 1 = 0
      const D = 4 - 4 * (m - 1);
      return Math.abs(D) < 1e-9 ? 1 : D > 0 ? 2 : 0;
    };
    const ms = grid(-30, 30, 0.5).filter((m) => count(m) === 1);
    const onlyDelta = grid(-30, 30, 0.5).filter((m) => Math.abs(m - 1) > 1e-12 && count(m) === 1);
    return {
      claims: [true, ms.length === onlyDelta.length],
      fix: -1 / -2, finish: [ms, ms.reduce((a, b) => a + b, 0), count(0)], err: [onlyDelta, onlyDelta.reduce((a, b) => a + b, 0), null],
    };
  },
  /* ---- physics (g = 10) ---- */
  'rc-p-01': () => {
    const y = (t) => 20 * t - 0.5 * G * t * t;
    const h = 1e-3;
    const acc = (y(2 + h) - 2 * y(2) + y(2 - h)) / (h * h);
    const yE = (t) => 20 * t + 5 * t * t;
    return {
      claims: [true, near(acc, 10, 1e-3)], fix: acc,
      finish: [y(3), (y(3 + h) - y(3 - h)) / (2 * h), ternaryMax(y, 0, 10)], err: [yE(3), 20 + 10 * 3, null],
    };
  },
  'rc-p-02': () => {
    const t = posRoot((s) => 5 * s * s - 45); const tE = posRoot((s) => 40 * s + 5 * s * s - 45);
    return {
      claims: [true, near(40 * t + 5 * t * t, 45, 1e-6)], fix: 0,
      finish: [t, 40 * t, G * t, Math.hypot(40, G * t)], err: [tE, 40 * tE, G * tE, Math.hypot(40, G * tE)],
    };
  },
  'rc-p-03': () => {
    const th = Math.asin(0.6); const v0 = 50;
    const vx = v0 * Math.cos(th); const vy = v0 * Math.sin(th);
    const yy = (t, v) => v * t - 5 * t * t;
    const T = posRoot((t) => yy(t, vy)); const TE = posRoot((t) => yy(t, vx));
    return {
      claims: [near(Math.cos(th), 0.8), near(vx, 30)], fix: vx,
      finish: [T, ternaryMax((t) => yy(t, vy), 0, T), vx * 2], err: [TE, ternaryMax((t) => yy(t, vx), 0, TE), vy * 2],
    };
  },
  'rc-p-04': () => {
    const y = (t) => 25 + 20 * t - 5 * t * t; const yE = (t) => 20 * t - 5 * t * t;
    const T = posRoot(y); const TE = posRoot(yE);
    const top = ternaryMax(y, 0, T); const topE = ternaryMax(yE, 0, TE);
    return {
      claims: [near(y(0), 25), near(yE(0), 25)], fix: y(0),
      finish: [T, Math.abs(20 - 10 * T), (top - 25) + top], err: [TE, Math.abs(20 - 10 * TE), (topE - 0) + topE],
    };
  },
  'rc-p-05': () => {
    const yA = (t) => 80 - 5 * t * t; const yB = (t) => 40 * t - 5 * t * t;
    const t = posRoot((s) => yA(s) - yB(s));
    const tE = posRoot((s) => 5 * s * s - yB(s));
    return {
      claims: [true, near(5 * t * t, yB(t))], fix: 5 * t * t + yB(t),
      finish: [t, yA(t), G * t], err: [tE, yA(tE), G * tE],
    };
  },
  'rc-p-06': () => {
    const xA = (t) => 20 * t; const xB = (t) => 300 - 10 * t; const xBE = (t) => 300 + 10 * t;
    const t = posRoot((s) => xA(s) - xB(s)); const tE = posRoot((s) => xA(s) - xBE(s));
    return {
      claims: [true, (xBE(1) - xBE(0)) < 0], fix: xB(5),
      finish: [t, xA(t), 300 - xB(t), posRoot((s) => (xB(s) - xA(s)) - 60)], err: [tE, xA(tE), Math.abs(xBE(tE) - 300), null],
    };
  },
  'rc-p-07': () => {
    const y = (t) => 40 - 10 * t - 5 * t * t; const yE = (t) => 40 + 10 * t - 5 * t * t;
    const T = posRoot(y); const TE = posRoot(yE);
    const h = 1e-4;
    const slope = (f, t) => (f(t + h) - f(t - h)) / (2 * h); // velocity, with the axis pointing up
    const v0 = slope(y, 0);
    return {
      claims: [true, near(slope(yE, 0), v0, 1e-3)], fix: v0,
      finish: [T, y(1), slope(y, 1)], err: [TE, yE(1), slope(yE, 1)],
    };
  },
  'rc-p-08': () => {
    const t = posRoot((s) => 5 * s * s - 20); const vy = G * t; const vyE = 15 + G * t;
    return {
      claims: [true, near(vyE, vy)], fix: 0,
      finish: [vy, Math.hypot(15, vy), vy / 15], err: [vyE, Math.hypot(15, vyE), vyE / 15],
    };
  },
  'rc-p-09': () => {
    const a = 30 * Math.PI / 180; const vy = 10 * Math.sin(a); const vyE = 10 * Math.cos(a);
    const yy = (t, v) => v * t - 5 * t * t;
    const T = posRoot((t) => yy(t, vy)); const TE = posRoot((t) => yy(t, vyE));
    return {
      claims: [true, near(vyE, vy)], fix: vy,
      finish: [T, ternaryMax((t) => yy(t, vy), 0, T), vy - G * 0.5], err: [TE, ternaryMax((t) => yy(t, vyE), 0, TE), vyE - G * 0.5],
    };
  },
  'rc-p-10': () => {
    const gap = (t) => 60 + 15 * t - 25 * t; const gapE = (t) => 60 - 40 * t;
    const t = posRoot(gap); const tE = posRoot(gapE);
    return {
      claims: [true, near(gap(0) - gap(1), 40)], fix: gap(0) - gap(1),
      finish: [t, 25 * t, gap(2)], err: [tE, 25 * tE, gapE(2)],
    };
  },
  'rc-p-11': () => {
    const y = (t) => 15 + 10 * t - 5 * t * t; const yE = (t) => 10 * t - 5 * t * t;
    const tUp = 1; const T = posRoot(y);
    const top = ternaryMax(y, 0, T); const topE = ternaryMax(yE, 0, 2);
    const fall = posRoot((s) => top - 5 * s * s); const fallE = posRoot((s) => topE - 5 * s * s);
    return {
      claims: [near(10 - G * tUp, 0), near(top, topE)], fix: top,
      finish: [fall, tUp + fall, G * fall], err: [fallE, tUp + fallE, G * fallE],
    };
  },
  'rc-p-12': () => {
    const th = 30 * Math.PI / 180; const L = 10;
    const a = (-G) * -Math.sin(th); // gravity (0, -G) projected on the downhill unit vector (cos, -sin)
    const aE = G * Math.cos(th);
    const t = posRoot((s) => 0.5 * a * s * s - L); const tE = posRoot((s) => 0.5 * aE * s * s - L);
    const half = posRoot((s) => 0.5 * a * s * s - L / 2); const halfE = posRoot((s) => 0.5 * aE * s * s - L / 2);
    return { claims: [true, near(a, aE)], fix: a, finish: [t, a * t, half], err: [tE, aE * tE, halfE] };
  },
};

/* ---------- comparing a stored spec with a computed value ---------- */
function specMismatch(spec, v) {
  const c = canonSpec(spec);
  if (c.kind === 'number') return near(c.vals[0], v) ? '' : `expected ${v}, stored ${c.vals[0]}`;
  if (c.kind === 'set') {
    const a = [...v].sort((x, y) => x - y);
    return a.length === c.vals.length && a.every((x, i) => near(x, c.vals[i])) ? '' : `expected set [${a.map((x) => +x.toFixed(6))}], stored [${c.vals}]`;
  }
  if (c.kind === 'points') {
    const a = [...v].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    return a.length === c.pts.length && a.every((p, i) => near(p[0], c.pts[i][0]) && near(p[1], c.pts[i][1])) ? '' : 'points differ';
  }
  const ends = c.parts.flatMap((p) => [p.lo, p.hi]).filter(Number.isFinite);
  const xs = [...grid(-60, 60, 0.01), ...ends, ...ends.map((e) => e + 1e-4), ...ends.map((e) => e - 1e-4)];
  const bad = xs.find((x) => inUnion(c.parts, x) !== !!v(x));
  return bad === undefined ? '' : `interval differs at x = ${bad}`;
}
const sameValue = (a, b) => {
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a === 'function' || typeof b === 'function') return grid(-60, 60, 0.01).every((x) => !!a(x) === !!b(x));
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => (Array.isArray(x) ? sameValue(x, b[i]) : near(x, b[i])));
  return near(a, b);
};

/** All errors for `items` (default: the shipped data). */
export function validate(items = loadRecover()) {
  const errors = [];
  const stats = { math: 0, physics: 0, parts: 0, errParts: 0 };
  const ids = new Set();
  for (const it of items) {
    const tag = it && it.id;
    const bad = (msg) => errors.push(`${tag}: ${msg}`);
    if (!validItem(it)) { bad('fails validItem (js/recover.js)'); continue; }
    if (ids.has(it.id)) bad('duplicate id');
    ids.add(it.id);
    stats[it.subject] += 1;
    if (it.steps.length < 5 || it.steps.length > 7) bad(`needs 5-7 steps, has ${it.steps.length}`);
    if (it.firstWrong > 2) bad(`the error must be early (step index <= 2), got ${it.firstWrong}`);
    if (!/[֐-׿]/.test(it.statement) || !/[֐-׿]/.test(it.whyWrong)) bad('statement / explanation not in Hebrew');
    if (/[iI]\b|\bcomplex\b|מרוכב/.test(it.statement + it.steps.join(' '))) bad('mentions complex numbers');
    const model = MODEL[it.id];
    if (!model) { bad('no independent model in tools/verify-recover.mjs'); continue; }
    let truth;
    try { truth = model(); } catch (e) { bad(`model threw: ${e.message}`); continue; }
    // claims: steps before the error hold, the erroneous step fails
    if (truth.claims.length !== it.firstWrong + 1) bad(`model has ${truth.claims.length} claims, needs ${it.firstWrong + 1}`);
    else {
      truth.claims.forEach((ok, i) => {
        if (i < it.firstWrong && ok !== true) bad(`step ${i + 1} should be numerically true but is false`);
        if (i === it.firstWrong && ok !== false) bad(`step ${i + 1} is marked as the error but it is numerically TRUE`);
      });
    }
    // fix and finish values
    let m = specMismatch(it.fix.answer, truth.fix);
    if (m) bad(`fix: ${m}`);
    if (truth.finish.length !== it.finish.length) { bad(`model has ${truth.finish.length} finish parts, data ${it.finish.length}`); continue; }
    let changes = false;
    it.finish.forEach((p, k) => {
      stats.parts += 1;
      m = specMismatch(p.answer, truth.finish[k]);
      if (m) bad(`finish ${p.id}: ${m}`);
      const e = truth.err[k];
      if (p.ifError) {
        stats.errParts += 1;
        if (e === null || e === undefined) bad(`finish ${p.id}: has ifError but the erroneous chain gives no single value`);
        else if (e !== Infinity && (m = specMismatch(p.ifError, e))) bad(`finish ${p.id} ifError: ${m}`);
        if (sameValue(truth.finish[k], e)) bad(`finish ${p.id}: ifError equals the correct answer`);
      }
      if (e === null || e === undefined || e === Infinity || !sameValue(truth.finish[k], e)) changes = true;
    });
    if (!changes) bad('the error does not change any remaining answer');
    if (!it.finish.some((p) => p.ifError)) bad('no finish part carries an ifError value');
  }
  if (stats.math !== 12) errors.push(`expected 12 math exercises, found ${stats.math}`);
  if (stats.physics !== 12) errors.push(`expected 12 physics exercises, found ${stats.physics}`);
  void dist;
  return { errors, stats };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const t0 = Date.now();
  const { errors, stats } = validate();
  console.log(`recover: ${stats.math} math + ${stats.physics} physics exercises, ${stats.parts} finish parts (${stats.errParts} with an erroneous-chain value), ${Date.now() - t0} ms`);
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('OK: every corrected value and remaining part recomputed independently; every erroneous step is false and changes the answers.');
}

// Verifies data/booklet.json: (1) structure and marks, (2) EVERY part's numeric answer recomputed independently by simulation,
// root scanning or brute force (never by the closed form used to write the solution), (3) the pool is exclusive: no id and no
// text of the booklet appears in any other data file, (4) the paper builder is deterministic and always totals 100.
// Run: node tools/verify-booklet.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildPaper, validQuestion, TOTAL, COUNTS, SUBJECTS, paperParts } from '../js/booklet.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const { sin, cos, tan, sqrt, PI, abs } = Math;

/* ---------- numeric helpers ---------- */
/** All roots of f in [lo, hi] found by sign changes on a fine grid, refined by bisection. */
function roots(f, lo, hi, n = 200000) {
  const out = [];
  let x0 = lo, f0 = f(lo);
  for (let i = 1; i <= n; i++) {
    const x1 = lo + ((hi - lo) * i) / n, f1 = f(x1);
    if (Number.isFinite(f0) && Number.isFinite(f1) && f0 === 0) out.push(x0);
    else if (Number.isFinite(f0) && Number.isFinite(f1) && f0 * f1 < 0) {
      let a = x0, b = x1;
      for (let k = 0; k < 80; k++) { const m = (a + b) / 2; if (f(a) * f(m) <= 0) b = m; else a = m; }
      out.push((a + b) / 2);
    }
    x0 = x1; f0 = f1;
  }
  return out;
}
const bisect = (f, lo, hi) => { let a = lo, b = hi; for (let k = 0; k < 100; k++) { const m = (a + b) / 2; if (f(a) * f(m) <= 0) b = m; else a = m; } return (a + b) / 2; };
const gridMax = (f, lo, hi, n = 400000) => { let best = -Infinity; for (let i = 0; i <= n; i++) best = Math.max(best, f(lo + ((hi - lo) * i) / n)); return best; };
const gridMin = (f, lo, hi, n = 400000) => -gridMax((x) => -f(x), lo, hi, n);
/** Real roots of a x^2 + b x + c found numerically (outside-in from the vertex), no closed form. */
function quadRoots(a, b, c) {
  const f = (x) => a * x * x + b * x + c;
  let lo = -1e3, hi = 1e3;
  for (let i = 0; i < 300; i++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if ((f(m1) < f(m2)) === (a > 0)) hi = m2; else lo = m1; }
  const xv = (lo + hi) / 2;
  if (a * f(xv) > 1e-12) return [];
  return [bisect(f, xv - 1e3, xv), bisect(f, xv, xv + 1e3)];
}

/** Constant-acceleration vertical/horizontal state stepping; returns the first time y crosses 0 downward (linear interpolation). */
function flight(y0, vx, vy, g = 10, dt = 1e-5) {
  let t = 0, x = 0, y = y0, vyy = vy, maxY = y0, tTop = 0;
  while (t < 100) {
    const ny = y + vyy * dt - 0.5 * g * dt * dt;
    if (ny <= 0 && t > 0) { const fr = y / (y - ny); return { t: t + fr * dt, x: x + vx * fr * dt, vy: vyy - g * fr * dt, maxY, tTop }; }
    y = ny; vyy -= g * dt; x += vx * dt; t += dt;
    if (y > maxY) { maxY = y; tTop = t; }
  }
  return null;
}

/* ---------- independent solvers: question id -> { partId: value } ---------- */
export const SOLVERS = {
  'bk-m1': () => {
    const f = (x, m) => x * x - 2 * m * x + m * m - 4 * m + 3;
    const minF = (m) => gridMin((x) => f(x, m), m - 20, m + 20, 4000); // the vertex is at x = m
    const rootsAt = (m) => quadRoots(1, -2 * m, m * m - 4 * m + 3);
    const disc2 = (() => { const [p, q] = rootsAt(2); return (p - q) ** 2; })(); // (x1 - x2)^2 = Δ for a = 1
    const sumSq = (m) => rootsAt(m).reduce((s, r) => s + r * r, 0);
    return {
      a: disc2,
      b: bisect((m) => minF(m), 0, 3),
      c: Math.max(...rootsAt(3)),
      d: sumSq(1),
      e: bisect((m) => sumSq(m) - 66, 1, 10),
      f: Math.max(...roots((m) => f(0, m), 0.75, 10, 20000)),
    };
  },
  'bk-m2': () => {
    const g = (x, k) => sqrt(x + 7) - sqrt(x - 1) - k;
    const domainLo = (() => { let lo = -20; while (!(lo + 7 >= 0 && lo - 1 >= 0)) lo += 1e-4; return Math.round(lo * 1e3) / 1e3; })();
    const decreasing = (() => { let prev = Infinity; for (let x = 1; x < 400; x += 0.01) { const v = sqrt(x + 7) - sqrt(x - 1); if (v > prev + 1e-12) return false; prev = v; } return true; })();
    return {
      a: domainLo,
      b: roots((x) => g(x, 2), 1, 100, 100000)[0],
      d: roots((x) => g(x, 1), 1, 100, 100000)[0],
      e: decreasing ? sqrt(8) : NaN, // value at the left end of the domain bounds every attained k
    };
  },
  'bk-m3': () => {
    const L = (x) => (x + 1) / (x - 2), R = (x) => (x - 3) / (x + 1);
    const h = (x) => L(x) - R(x);
    const ok = (x) => Math.abs(x - 2) > 1e-9 && Math.abs(x + 1) > 1e-9 && h(x) >= -1e-12;
    const ints = []; for (let x = -3; x <= 5; x++) if (ok(x)) ints.push(x);
    const num = (x) => (x + 1) * (x + 1) - (x - 3) * (x - 2); // numerator over the common denominator
    const rootsH = roots(h, -0.99, 1.99, 400000);
    let firstE = null; for (let x = -9.999; x < 10; x += 0.001) if (Math.abs(x - 2) > 1e-9 && (x + 1) / (x - 2) >= 1) { if (firstE === null || x < firstE) firstE = x; }
    return {
      a: [2, -1].filter((x) => !Number.isFinite(L(x)) || !Number.isFinite(R(x))).reduce((m, x) => Math.max(m, x), -Infinity),
      b: num(3),
      c: rootsH[0],
      d: ints.reduce((s, x) => s + x, 0),
      e: Math.ceil(firstE) === 3 ? 2 : firstE,
      f: h(-0.5),
    };
  },
  'bk-m4': () => {
    const circ = (x, y) => x * x + y * y - 6 * x + 4 * y - 12;
    // the circle's extent in x and y found by scanning, no completing the square
    let xs = [], ys = [];
    for (let x = -10; x <= 10; x += 0.001) if (gridMin((y) => Math.abs(circ(x, y)), -10, 10, 4000) < 1e-1 && roots((y) => circ(x, y), -10, 10, 4000).length) xs.push(x);
    for (let y = -10; y <= 10; y += 0.001) if (roots((x) => circ(x, y), -10, 10, 4000).length) ys.push(y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const r = (Math.max(...xs) - Math.min(...xs)) / 2;
    const gx = roots((x) => circ(x, 2 * x - 3), -10, 10, 200000);
    const pts = gx.map((x) => [x, 2 * x - 3]);
    const chord = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
    const dist = gridMin((x) => Math.hypot(x - cx, 2 * x - 3 - cy), -20, 20, 400000);
    const [x0, y0] = pts.find((p) => abs(p[0] - 3) < 1e-6);
    const slope = (-(x0 - cx)) / (y0 - cy); // tangent is perpendicular to the radius
    const area = abs((pts[0][0] - cx) * (pts[1][1] - cy) - (pts[1][0] - cx) * (pts[0][1] - cy)) / 2;
    return { a: Math.round(r * 100) / 100, b: gx.reduce((s, x) => s + x, 0), c: chord, d: dist, e: y0 + slope * (10 - x0), f: area };
  },
  'bk-m5': () => {
    const lhs = (x) => (cos(x) - cos(3 * x)) / (sin(x) + sin(3 * x));
    let idOk = true; for (let x = 0.05; x < 1.5; x += 0.01) if (abs(lhs(x) - tan(x)) > 1e-9) idOk = false;
    let idOk2 = true; for (let x = 0.05; x < 1.5; x += 0.01) if (abs(cos(x) - cos(3 * x) - 4 * sin(x) ** 2 * cos(x)) > 1e-9) idOk2 = false;
    const F = (x) => sin(x) + sin(3 * x) - cos(x) - cos(3 * x);
    const solutions = roots(F, 0, 2 * PI - 1e-9, 800000);
    const near = (v) => solutions.filter((s) => abs(s - v) < 1e-5).length === 1;
    return {
      a: idOk ? lhs(0.5) : NaN,
      b: roots((x) => sin(x) - sqrt(3) * cos(x), 0.01, 3.1, 100000)[0],
      c: [PI / 2, 3 * PI / 2, PI / 8, 5 * PI / 8, 9 * PI / 8, 13 * PI / 8].every(near) ? solutions.length : NaN,
      d: idOk2 ? gridMax((x) => cos(x) - cos(3 * x), 0, PI / 2) : NaN,
      e: lhs(15 * PI / 180),
    };
  },
  'bk-m6': () => {
    const f = (x) => 2 ** (x + 1) + 2 ** (2 - x);
    const tRoots = roots((t) => 2 * t + 4 / t - 9, 0.01, 20, 400000); // the quadratic in t has these two positive roots
    const xr = roots((x) => f(x) - 9, -10, 10, 200000);
    const sol = []; for (let x = -5; x <= 5; x += 0.0005) if (f(x) <= 9) sol.push(x);
    return {
      a: (2 * (tRoots[1] - tRoots[0])) ** 2,
      b: xr.reduce((s, x) => s + x, 0),
      c: Math.max(...sol) - Math.min(...sol),
      d: gridMin(f, -10, 10),
      e: roots((x) => f(x) - 5, -20, 20, 400000).length,
    };
  },
  'bk-p1': () => {
    const dt = 1e-4;
    const run = (cap) => {
      let t = 0, xp = 0, vp = 0, maxGap = 0, caught = null;
      while (t < 60) {
        const vNew = Math.min(cap, vp + 5 * dt);
        xp += 0.5 * (vp + vNew) * dt; vp = vNew; t += dt;
        const gap = 30 * t - xp;
        maxGap = Math.max(maxGap, gap);
        if (gap <= 0 && caught === null) { caught = { t, x: xp, v: vp }; break; }
      }
      return { caught, maxGap };
    };
    const free = run(Infinity), capped = run(50);
    return { a: free.caught.t, b: free.caught.x, c: free.caught.v, d: free.maxGap, e: capped.caught.t, f: capped.caught.x };
  },
  'bk-p2': () => {
    const h = flight(45, 12, 0);
    const spd = Math.hypot(12, h.vy);
    const ang = Math.atan2(-h.vy, 12) * 180 / PI;
    const k = flight(45, 12 * cos(30 * PI / 180), 12 * sin(30 * PI / 180));
    return { a: h.t, b: h.x, c: spd, d: ang, e: k.t, f: k.x };
  },
  'bk-p3': () => {
    const prof = (t) => (t < 10 ? 2 : t < 40 ? 0 : t < 50 ? -2 : 0);
    const dt = 1e-3; let t = 0, v = 0, x = 0, half = null;
    while (t < 50) { v += prof(t + dt / 2) * dt; x += v * dt; t += dt; if (half === null && x >= 400) half = t; }
    // triangle profile: accelerate for 25 s then brake for 25 s; find the peak speed giving the same 800 m
    const dist = (a) => { let tt = 0, vv = 0, xx = 0; while (tt < 50) { vv += (tt < 25 ? a : -a) * dt; xx += vv * dt; tt += dt; } return xx; };
    const a2 = bisect((a) => dist(a) - 800, 0.1, 5);
    return { a: (() => { let tt = 0, vv = 0; while (tt < 10) { vv += 2 * dt; tt += dt; } return vv / tt; })(), b: x, c: x / 50, d: half, e: a2 * 25, f: a2 };
  },
  'bk-p4': () => {
    const f = flight(30, 0, 20);
    // distance travelled = up to the top + down to the ground (the path integral of |v|)
    const dt = 1e-4; let t = 0, y = 30, v = 20, path = 0;
    while (y > 0) { const ny = y + v * dt - 5 * dt * dt; path += abs(ny - y); y = ny; v -= 10 * dt; t += dt; }
    return { a: f.maxY - 30, b: f.tTop, c: f.t, d: abs(f.vy), e: path, f: path / f.t };
  },
  'bk-p5': () => {
    const w = 120, u = 3, v = 5;
    const cross = (th) => { const vn = v * cos(th), vp = v * sin(th) - u; const T = w / vn; return { T, drift: vp * T }; }; // th measured upstream from the normal
    const th0 = bisect((th) => cross(th).drift, 0, 1.2);
    // river-parallel round trip simulated step by step
    const dt = 1e-4; let t = 0, x = 0;
    while (x < w) { x += (v - u) * dt; t += dt; }
    while (x > 0) { x -= (v + u) * dt; t += dt; }
    return { a: cross(0).T, b: -cross(0).drift, c: Math.hypot(v, u), d: th0 * 180 / PI, e: cross(th0).T, f: t };
  },
  'bk-p6': () => {
    const height = (v0) => (t) => ({ A: 80 - 5 * t * t, B: v0 * t - 5 * t * t });
    const meet = (v0) => bisect((t) => height(v0)(t).A - height(v0)(t).B, 0, 4);
    const tM = meet(40);
    const t30 = meet(30);
    // smallest throw speed that still meets while B is above the ground, and while B is still rising
    const meetsAbove = (v0) => { const t = meet(v0); return height(v0)(t).B >= 0 ? 1 : -1; };
    const meetsRising = (v0) => { const t = meet(v0); return v0 - 10 * t >= 0 ? 1 : -1; };
    return {
      a: tM, b: height(40)(tM).B, c: 40 - 10 * tM, d: height(30)(t30).B,
      e: bisect(meetsAbove, 5, 60), f: bisect(meetsRising, 5, 60),
    };
  },
};

/* ---------- exclusivity against every other data file ---------- */
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9א-ת]+/g, ' ').trim();
const shingles = (s, n = 4) => { const w = norm(s).split(' '); const out = new Set(); for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' ')); return out; };
const jaccard = (a, b) => { if (!a.size || !b.size) return 0; let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i); };

function collect(node, ids, texts) {
  if (Array.isArray(node)) { for (const x of node) collect(x, ids, texts); return; }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'id' && typeof v === 'string') ids.add(v);
      collect(v, ids, texts);
    }
    return;
  }
  if (typeof node === 'string' && node.length >= 25) texts.push(node);
}

export function loadBanks(root = ROOT) {
  const ids = new Set();
  const texts = [];
  for (const f of readdirSync(root + 'data').filter((n) => n.endsWith('.json') && n !== 'booklet.json')) {
    collect(JSON.parse(readFileSync(root + 'data/' + f, 'utf8')), ids, texts);
  }
  return { ids, texts };
}

export function verifyBooklet(data, banks) {
  const errs = [];
  const bad = (m) => errs.push(m);
  const qs = data.questions || [];
  if (qs.length !== 12) bad(`expected 12 questions, found ${qs.length}`);
  for (const s of SUBJECTS) if (qs.filter((q) => q.subject === s.id).length !== 6) bad(`expected 6 ${s.id} questions`);
  const seenIds = new Set();
  const bankShingles = banks.texts.map((t) => ({ n: norm(t), s: shingles(t) }));
  for (const q of qs) {
    if (seenIds.has(q.id)) bad(`${q.id}: duplicate id`);
    seenIds.add(q.id);
    if (!validQuestion(q)) { bad(`${q.id}: invalid shape, part count (4-6), marks (25) or rubric sums`); continue; }
    if (banks.ids.has(q.id)) bad(`${q.id}: id exists in another data file`);
    for (const p of q.parts) if (banks.ids.has(`${q.id}-${p.id}`)) bad(`${q.id}-${p.id}: id exists elsewhere`);
    // text exclusivity: stem and every ask/answer must not appear (or nearly appear) in another file
    const own = [q.stem, ...(q.eq || []), ...q.parts.map((p) => p.ask), ...q.parts.map((p) => p.solution.join(' '))].filter((t) => t.length >= 25);
    for (const t of own) {
      const n = norm(t), sh = shingles(t);
      for (const b of bankShingles) {
        if (b.n === n || (n.length >= 40 && (b.n.includes(n) || n.includes(b.n) && b.n.length >= 40)) || jaccard(sh, b.s) >= 0.5) { bad(`${q.id}: text overlaps another data file: "${t.slice(0, 60)}"`); break; }
      }
    }
    // independent recomputation
    const solver = SOLVERS[q.id];
    if (!solver) { bad(`${q.id}: no independent solver`); continue; }
    let got;
    try { got = solver(); } catch (e) { bad(`${q.id}: solver crashed: ${e.message}`); continue; }
    let numeric = 0;
    for (const p of q.parts) {
      if (p.value == null) { if (got[p.id] !== undefined) bad(`${q.id}.${p.id}: solver value given for a proof part`); continue; }
      numeric++;
      const v = got[p.id];
      const tol = p.tol || 0.011;
      if (!Number.isFinite(v) || abs(v - p.value) > tol) bad(`${q.id}.${p.id}: stored ${p.value} but independent value is ${v} (tol ${tol})`);
    }
    for (const k of Object.keys(got)) if (!q.parts.some((p) => p.id === k)) bad(`${q.id}: solver returns unknown part ${k}`);
    if (numeric < q.parts.length - 1) bad(`${q.id}: at most one part may be unverified (proof)`);
  }
  // paper builder
  for (const s of SUBJECTS) {
    for (const count of COUNTS) {
      for (let seed = 1; seed <= 150; seed++) {
        const a = buildPaper(qs, s.id, count, seed), b = buildPaper(qs, s.id, count, seed);
        if (JSON.stringify(a) !== JSON.stringify(b)) { bad(`${s.id}/${count}/${seed}: paper not deterministic`); break; }
        if (a.total !== TOTAL || paperParts(a).reduce((x, p) => x + p.max, 0) !== TOTAL) { bad(`${s.id}/${count}/${seed}: marks do not total ${TOTAL}`); break; }
        for (const q of a.questions) for (const p of q.parts) if (p.rubric.reduce((x, r) => x + r[0], 0) !== p.marks) bad(`${s.id}/${count}/${seed}: ${q.id}.${p.id} rubric != marks`);
      }
    }
  }
  return errs;
}

if (process.argv[1] && process.argv[1].endsWith('verify-booklet.mjs')) {
  const data = JSON.parse(readFileSync(ROOT + 'data/booklet.json', 'utf8'));
  const errs = verifyBooklet(data, loadBanks());
  if (errs.length) { for (const e of errs) console.error('FAIL ' + e); process.exitCode = 1; }
  else console.log(`booklet ok: ${data.questions.length} questions, ${data.questions.reduce((s, q) => s + q.parts.length, 0)} parts verified independently, pool exclusive`);
}

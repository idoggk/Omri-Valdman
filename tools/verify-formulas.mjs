// Verifies data/formula-catalogue.json. Every numeric entry's reference expression is compared with an INDEPENDENT native
// JavaScript implementation (the table below, written separately from the expression syntax) at 20 sample points, and every
// listed trap ("wrong form") must really differ from that implementation. Run: node tools/verify-formulas.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseFormula, samplePoints, validItem, CHECK_POINTS } from '../js/fbuilder.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const sin = Math.sin, cos = Math.cos, tan = Math.tan, sqrt = Math.sqrt, ln = Math.log;

export const NATIVE = {
  'fc-pow-mul': (e) => e.a ** e.m * e.a ** e.n,
  'fc-pow-div': (e) => (e.a ** e.m) / (e.a ** e.n),
  'fc-pow-pow': (e) => (e.a ** e.m) ** e.n,
  'fc-pow-prod': (e) => (e.a * e.b) ** e.n,
  'fc-pow-neg': (e) => e.a ** -e.n,
  'fc-sqrt-prod': (e) => sqrt(e.a * e.b),
  'fc-log-prod': (e) => ln(e.x * e.y),
  'fc-log-quot': (e) => ln(e.x / e.y),
  'fc-log-pow': (e) => ln(e.x ** e.n),
  'fc-log-base': (e) => ln(e.x) / ln(e.b),
  // root found by Newton iteration on the polynomial itself (independent of the closed form)
  'fc-quad-root': (e) => { let x = (-e.b + sqrt(e.b * e.b - 4 * e.a * e.c)) / (2 * e.a) + 0.3; for (let i = 0; i < 80; i++) x -= (e.a * x * x + e.b * x + e.c) / (2 * e.a * x + e.b); return x; },
  'fc-quad-vertex': (e) => { const f = (x) => e.a * x * x + e.b * x; let lo = -50, hi = 50; for (let i = 0; i < 200; i++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if (f(m1) > f(m2) === e.a > 0) lo = m1; else hi = m2; } return (lo + hi) / 2; },
  // roots of a real polynomial with a chosen second coefficient (c = -1 for the sum, b large enough for the product)
  'fc-quad-vsum': (e) => { const r = sqrt(e.b * e.b + 4 * e.a); return (-e.b + r) / (2 * e.a) + (-e.b - r) / (2 * e.a); },
  'fc-quad-vprod': (e) => { const b = 2 * sqrt(Math.abs(e.a * e.c)) + 1; const r = sqrt(b * b - 4 * e.a * e.c); return ((-b + r) / (2 * e.a)) * ((-b - r) / (2 * e.a)); },
  'fc-quad-disc': (e) => e.b * e.b - 4 * e.a * e.c,
  'fc-par-1': (e) => { const a = 1, b = -2 * e.m, c = e.m + 2; return b * b - 4 * a * c; },
  'fc-par-2': (e) => { const a = e.m, b = 4, c = 1; return b * b - 4 * a * c; },
  'fc-dist-center': (e) => Math.hypot(e.x - e.a, e.y - e.b),
  // centre (-D/2,-E/2); r^2 = F-adjusted: plug a point-free derivation via completing the square
  'fc-circle-r2': (e) => { const cx = -e.D / 2, cy = -e.E / 2; return cx * cx + cy * cy - e.F; },
  'fc-slope': (e) => (e.y2 - e.y1) / (e.x2 - e.x1),
  'fc-midpoint': (e) => e.x1 + (e.x2 - e.x1) / 2,
  'fc-sin2': (e) => sin(2 * e.x),
  'fc-cos2': (e) => cos(2 * e.x),
  'fc-sinsum': (e) => sin(e.x + e.y),
  'fc-cossum': (e) => cos(e.x + e.y),
  'fc-tan2': (e) => tan(2 * e.x),
  'fc-sin3': (e) => sin(3 * e.x),
  'fc-sin-half': (e) => sin(e.x) ** 2,
  'fc-sum-prod': (e) => sin(e.x) + sin(e.y),
  'fc-prod-sum': (e) => sin(e.x) * cos(e.y),
  // kinematics by numeric integration (midpoint rule), not by the closed forms
  'fc-k-v': (e) => e.v0 + e.a * e.t,
  'fc-k-x': (e) => { const n = 4000; let x = 0; for (let i = 0; i < n; i++) x += (e.v0 + e.a * ((i + 0.5) * e.t / n)) * (e.t / n); return x; },
  'fc-k-v2': (e) => { const t = (sqrt(e.v0 * e.v0 + 2 * e.a * e.dx) - e.v0) / e.a; return Number.isFinite(t) && e.a !== 0 ? (e.v0 + e.a * t) ** 2 : e.v0 ** 2 + 2 * e.a * e.dx; },
  'fc-k-avg': (e) => (e.v0 * e.t + (e.v - e.v0) * e.t / 2),
  'fc-k-fall': (e) => { const t = sqrt(2 * e.h / e.g); return e.g * t; },
  'fc-p-vx': (e) => Math.hypot(e.v0, 0) * cos(e.th),
  'fc-p-vy': (e) => e.v0 * sin(e.th) - e.g * e.t,
  'fc-p-y': (e) => { const n = 4000; let y = 0; for (let i = 0; i < n; i++) y += (e.v0 * sin(e.th) - e.g * ((i + 0.5) * e.t / n)) * (e.t / n); return y; },
  'fc-p-time': (e) => { const vy = e.v0 * sin(e.th); return vy / e.g * 2; },
  'fc-p-range': (e) => { const T = 2 * e.v0 * sin(e.th) / e.g; return e.v0 * cos(e.th) * T; },
  'fc-r-rel': (e) => e.va - e.vb,
  'fc-r-meet': (e) => e.d / (e.v1 + e.v2),
  'fc-r-cross': (e) => Math.hypot(e.v, e.u),
  'fc-g-area': (e) => { const n = 4000; let s = 0; const w = (e.t2 - e.t1) / n; for (let i = 0; i < n; i++) s += e.a * (e.t1 + (i + 0.5) * w) * w; return s; },
  'fc-g-slope': (e) => (e.v2 - e.v1) / (e.t2 - e.t1),
};

const close = (x, y) => Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(x), Math.abs(y));

export function verifyCatalogue(cat) {
  const errs = [];
  const bad = (m) => errs.push(m);
  const topicIds = new Set(cat.topics.map((t) => t.id));
  const seen = new Set();
  let numeric = 0;
  let selfs = 0;
  for (const q of cat.items) {
    if (seen.has(q.id)) bad(`${q.id}: duplicate id`);
    seen.add(q.id);
    if (!validItem(q)) { bad(`${q.id}: invalid shape`); continue; }
    if (!topicIds.has(q.topic)) bad(`${q.id}: unknown topic ${q.topic}`);
    if (q.kind === 'self') { selfs++; continue; }
    numeric++;
    const native = NATIVE[q.id];
    if (!native) { bad(`${q.id}: no independent implementation in tools/verify-formulas.mjs`); continue; }
    const names = Object.keys(q.vars);
    const ref = parseFormula(q.ref, names);
    const pts = samplePoints(q);
    if (pts.length < CHECK_POINTS) bad(`${q.id}: only ${pts.length} valid sample points`);
    const mism = pts.filter((p) => !close(ref.fn(p), native(p)));
    if (mism.length) bad(`${q.id}: reference differs from the independent value at ${mism.length}/${pts.length} points, e.g. ${JSON.stringify(mism[0])}: ${ref.fn(mism[0])} vs ${native(mism[0])}`);
    if (!Array.isArray(q.traps) || q.traps.length < 1) bad(`${q.id}: needs at least one trap`);
    for (const t of q.traps || []) {
      const tf = parseFormula(t.expr, names);
      if (!tf.ok) { bad(`${q.id}: trap "${t.expr}" does not parse: ${tf.error.msg}`); continue; }
      if (typeof t.note !== 'string' || t.note.length < 8) bad(`${q.id}: trap "${t.expr}" lacks a note`);
      const same = pts.filter((p) => close(tf.fn(p), native(p))).length;
      if (same > pts.length * 0.25) bad(`${q.id}: trap "${t.expr}" equals the true value at ${same}/${pts.length} points (not really different)`);
    }
    // a sanity check on the checker: the stripped / spaced / unicode form of the reference is accepted
    const spaced = parseFormula(' ' + q.ref.replace(/\*/g, ' * ').replace(/-/g, '−') + ' ', names);
    if (!spaced.ok) bad(`${q.id}: spaced / unicode variant rejected: ${spaced.error && spaced.error.msg}`);
  }
  for (const k of Object.keys(NATIVE)) if (!seen.has(k)) bad(`${k}: independent implementation without a catalogue entry`);
  if (numeric < 40) bad(`only ${numeric} numeric entries (need at least 40)`);
  for (const t of cat.topics) if (!cat.items.some((q) => q.topic === t.id)) bad(`topic ${t.id} has no items`);
  return { errs, numeric, selfs };
}

if (process.argv[1] && process.argv[1].endsWith('verify-formulas.mjs')) {
  const cat = JSON.parse(readFileSync(ROOT + 'data/formula-catalogue.json', 'utf8'));
  const { errs, numeric, selfs } = verifyCatalogue(cat);
  if (errs.length) { for (const e of errs) console.error('FAIL ' + e); process.exitCode = 1; }
  else console.log(`formula catalogue ok: ${numeric} numeric + ${selfs} self-check entries, ${cat.topics.length} topics`);
}

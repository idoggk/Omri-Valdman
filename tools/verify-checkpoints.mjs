// Independent check of data/checkpoints.json: every checkpoint and final answer is recomputed from the
// parameters stored in the item (solver type + params) and compared. Run: node tools/verify-checkpoints.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const G = 10;
const EPS = 1e-9;
export const MIN_ITEMS = 24;
const TOPICS = ['math-3', 'math-4', 'phys-vertical', 'phys-horizontal'];

function roots(B, C) { // x² + Bx + C = 0, real roots only
  const D = B * B - 4 * C;
  if (D < 0) throw new Error(`negative discriminant ${D}`);
  const s = Math.sqrt(D);
  return { D, lo: (-B - s) / 2, hi: (-B + s) / 2 };
}
const choose = (r, pick) => {
  if (pick !== 'larger' && pick !== 'smaller') throw new Error(`bad pick "${pick}"`);
  return pick === 'larger' ? r.hi : r.lo;
};

/** Solvers return a map key -> value for every quantity a checkpoint may ask about. */
export const SOLVERS = {
  // x + y = s ; z = m x + n ; x y + z = t ; optional w = k z − y
  sub({ s, m, n, t, k, pick }) {
    // y = s − x  =>  x(s − x) + m x + n = t  =>  x² − (s + m) x + (t − n) = 0
    const B = -(s + m), C = t - n;
    const r = roots(B, C);
    const x = choose(r, pick), y = s - x, z = m * x + n;
    return { B, C, D: r.D, x, y, z, ...(k === undefined ? {} : { w: k * z - y }) };
  },
  // x + y = S ; x² + y² = Q ; z = p x + q y ; x > y
  sumsq({ S, Q, p, q }) {
    const xy = (S * S - Q) / 2;
    const r = roots(-S, xy); // x and y are the roots of t² − S t + xy
    return { xy, D: r.D, x: r.hi, y: r.lo, z: p * r.hi + q * r.lo };
  },
  // y = a x + b ; y = x² + c ; z = k x + y
  linpar({ a, b, c, k, pick }) {
    const B = -a, C = c - b; // x² + c = a x + b
    const r = roots(B, C);
    const x = choose(r, pick), y = a * x + b;
    return { B, C, D: r.D, x, y, z: k * x + y };
  },
  // up with v0 from height h0
  'vert-up'({ v0, h0 }) {
    const tUp = v0 / G, H = h0 + v0 * v0 / (2 * G), tFall = Math.sqrt(2 * H / G);
    return { tUp, H, tFall, T: tUp + tFall, vLand: G * tFall };
  },
  // dropped from rest at height h
  drop({ h }) {
    const t = Math.sqrt(2 * h / G), before = G * (t - 1) ** 2 / 2;
    return { t, v: G * t, pre: before, last: h - before };
  },
  // horizontal launch at vx from height h
  horiz({ h, vx }) {
    const t = Math.sqrt(2 * h / G), vy = G * t;
    return { t, vy, speed: Math.hypot(vx, vy), range: vx * t };
  },
  // launch from the ground, speed v0, given sin and cos of the angle
  oblique({ v0, sin, cos }) {
    const vx = v0 * cos, vy = v0 * sin, T = 2 * vy / G;
    return { vx, vy, T, H: vy * vy / (2 * G), R: vx * T };
  },
};

const hasHebrew = (s) => typeof s === 'string' && /[א-ת]/.test(s);
const decimals = (n) => { const s = String(n); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; };
const numFmt = (n) => String(Math.abs(n));

export function validateCheckpoints(data) {
  const errs = [];
  const e = (id, msg) => errs.push(`${id}: ${msg}`);
  if (!data || !Array.isArray(data.items)) return ['items array missing'];
  if (data.items.length < MIN_ITEMS) errs.push(`expected at least ${MIN_ITEMS} items, got ${data.items.length}`);
  const math = data.items.filter((i) => i && String(i.topic).startsWith('math')).length;
  const phys = data.items.filter((i) => i && String(i.topic).startsWith('phys')).length;
  if (math < 12 || phys < 12) errs.push(`need at least 12 math and 12 physics items, got ${math}/${phys}`);
  const seen = new Set();
  for (const it of data.items) {
    const id = it && it.id ? it.id : '(no id)';
    if (!it || typeof it.id !== 'string' || !it.id) { e(id, 'missing id'); continue; }
    if (seen.has(id)) e(id, 'duplicate id');
    seen.add(id);
    if (!TOPICS.includes(it.topic)) e(id, `bad topic "${it.topic}"`);
    if (!hasHebrew(it.statement)) e(id, 'statement must contain Hebrew');
    if (it.equations !== undefined && !(Array.isArray(it.equations) && it.equations.every((x) => typeof x === 'string'))) e(id, 'equations must be strings');
    if (!Array.isArray(it.checkpoints) || it.checkpoints.length < 2 || it.checkpoints.length > 4) { e(id, 'needs 2-4 checkpoints'); continue; }
    if (!it.solver || !Object.hasOwn(SOLVERS, it.solver.type)) { e(id, `unknown solver "${it.solver && it.solver.type}"`); continue; }
    const params = it.solver.params || {};
    if (!Object.values(params).every((v) => typeof v === 'string' || Number.isFinite(v))) { e(id, 'params must be numbers or strings'); continue; }
    // every stated number must actually appear in the problem text (|1| is skipped: it is usually an omitted coefficient)
    const text = [it.statement, ...(it.equations || [])].join(' ');
    for (const [k, v] of Object.entries(params)) {
      if (typeof v === 'number' && Math.abs(v) !== 1 && Math.abs(v) !== 0 && !text.includes(numFmt(v))) e(id, `param ${k}=${v} does not appear in the statement`);
    }
    let vals;
    try { vals = SOLVERS[it.solver.type](params); } catch (err) { e(id, `solver failed: ${err.message}`); continue; }
    const all = [...it.checkpoints.map((c, i) => [`checkpoint ${i + 1}`, c]), ['final', it.final]];
    const labels = new Set();
    for (const [name, c] of all) {
      if (!c || typeof c !== 'object') { e(id, `${name} missing`); continue; }
      if (!hasHebrew(c.label)) e(id, `${name} label must contain Hebrew`);
      if (name !== 'final' || c.hint !== undefined) { if (!hasHebrew(c.hint)) e(id, `${name} hint must contain Hebrew`); }
      if (!Number.isFinite(c.answer)) { e(id, `${name} answer must be a finite number`); continue; }
      if (decimals(c.answer) > 2) e(id, `${name} answer ${c.answer} has more than 2 decimals`);
      if (!(c.tolerance > 0 && c.tolerance <= 0.05)) e(id, `${name} tolerance must be in (0, 0.05]`);
      if (typeof c.key !== 'string' || !Object.hasOwn(vals, c.key)) { e(id, `${name} key "${c.key}" is unknown for solver ${it.solver.type}`); continue; }
      const want = vals[c.key];
      if (!Number.isFinite(want)) { e(id, `${name} solver value for "${c.key}" is not finite`); continue; }
      if (decimals(Math.round(want * 1e9) / 1e9) > 2) e(id, `${name} true value ${want} is not a finite decimal of at most 2 places`);
      if (Math.abs(want - c.answer) > EPS * Math.max(1, Math.abs(want)) + 1e-7) e(id, `${name} "${c.key}": stored ${c.answer} but recomputed ${want}`);
      if (labels.has(c.key) && name !== 'final') e(id, `${name} repeats key "${c.key}"`);
      labels.add(c.key);
    }
    if (it.final && it.checkpoints.some((c) => c.key === it.final.key)) e(id, 'final answer repeats a checkpoint');
  }
  return errs;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'checkpoints.json');
  const errs = validateCheckpoints(JSON.parse(readFileSync(file, 'utf8')));
  if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
  console.log('checkpoints OK');
}

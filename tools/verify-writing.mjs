// Independent verifier for data/writing.json (16 guided partial-credit writing tasks: 8 physics, 8 math).
// For every task it
//   1. re-evaluates every fact of the model solution (value AND unit) with a small expression engine that tracks physical
//      dimensions, so "kg·m/s²" can never be written for a speed or added to a length;
//   2. checks that every number written in the model solution text, the statement and the rubric is either given in the
//      statement or is a variable / computed value / literal of a fact (a typo in the text cannot slip through);
//   3. recomputes the final answers by a DIFFERENT method (time stepping, brute-force search, root scanning) and compares;
//   4. checks the shape: the five stages in order, 5-6 rubric lines worth integer points that cover every stage, the final
//      units stated in the conclusion, g = 10 in physics tasks, no complex numbers.
// Usage: node tools/verify-writing.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { validTask, STAGES } from '../js/writing.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const loadWriting = () => JSON.parse(readFileSync(path.join(ROOT, 'data/writing.json'), 'utf8'));

/* ---------- dimensions ---------- */
export function parseDim(s) {
  const d = {};
  const add = (tok, sign) => {
    if (!tok) return;
    const m = /^([a-z]+)(?:\^(-?\d+))?$/.exec(tok);
    if (!m) throw new Error(`bad unit "${s}"`);
    d[m[1]] = (d[m[1]] || 0) + sign * (m[2] ? Number(m[2]) : 1);
  };
  const [num, ...den] = String(s).split('/');
  num.split('*').forEach((t) => add(t, 1));
  den.forEach((part) => part.split('*').forEach((t) => add(t, -1)));
  return clean(d);
}
const clean = (d) => Object.fromEntries(Object.entries(d).filter(([, e]) => Math.abs(e) > 1e-9));
const sameDim = (a, b) => { const k = new Set([...Object.keys(a), ...Object.keys(b)]); return [...k].every((x) => Math.abs((a[x] || 0) - (b[x] || 0)) < 1e-9); };
const dimKey = (d) => Object.keys(d).sort().map((k) => `${k}^${d[k]}`).join(' ');
const mulDim = (a, b, s = 1) => { const r = { ...a }; for (const [k, e] of Object.entries(b)) r[k] = (r[k] || 0) + s * e; return clean(r); };

/** Hebrew unit symbols the conclusion may use, by dimension. */
export const HEB_UNIT = new Map([
  ['m', 'מ'], ['s', 'ש'], ['m/s', 'מ/ש'], ['m/s^2', 'מ/ש²'], ['kg*m/s^2', 'N'], ['kg*m^2/s^2', 'J'], ['m^2', 'מ²'], ['nis', '₪'],
].map(([d, u]) => [dimKey(parseDim(d)), u]));

/* ---------- expression engine: numbers with dimensions ---------- */
export function evaluate(expr, env) {
  const toks = String(expr).match(/\d+(?:\.\d+)?|[a-zA-Z_][a-zA-Z_0-9]*|[-+*/^()]/g) || [];
  if (toks.join('') !== String(expr).replace(/\s+/g, '')) throw new Error(`cannot tokenize "${expr}"`);
  let i = 0;
  const peek = () => toks[i];
  const take = () => toks[i++];
  const q = (v, d = {}) => ({ v, d });
  function expression() {
    let a = term();
    while (peek() === '+' || peek() === '-') {
      const op = take(); const b = term();
      if (!sameDim(a.d, b.d)) throw new Error(`adding different units in "${expr}"`);
      a = q(op === '+' ? a.v + b.v : a.v - b.v, a.d);
    }
    return a;
  }
  function term() {
    let a = unary();
    while (peek() === '*' || peek() === '/') {
      const op = take(); const b = unary();
      a = op === '*' ? q(a.v * b.v, mulDim(a.d, b.d)) : q(a.v / b.v, mulDim(a.d, b.d, -1));
    }
    return a;
  }
  function unary() {
    if (peek() === '-') { take(); const a = unary(); return q(-a.v, a.d); }
    return power();
  }
  function power() {
    const base = atom();
    if (peek() !== '^') return base;
    take();
    const e = unary();
    if (Object.keys(e.d).length) throw new Error(`exponent with units in "${expr}"`);
    const d = {}; for (const [k, x] of Object.entries(base.d)) d[k] = x * e.v;
    return q(Math.pow(base.v, e.v), clean(d));
  }
  function atom() {
    const t = take();
    if (t === undefined) throw new Error(`unexpected end of "${expr}"`);
    if (t === '(') { const a = expression(); if (take() !== ')') throw new Error(`missing ) in "${expr}"`); return a; }
    if (/^\d/.test(t)) return q(Number(t));
    if (t === 'sqrt') {
      if (take() !== '(') throw new Error('sqrt needs (');
      const a = expression();
      if (take() !== ')') throw new Error('missing ) after sqrt');
      const d = {}; for (const [k, x] of Object.entries(a.d)) d[k] = x / 2;
      return q(Math.sqrt(a.v), clean(d));
    }
    if (!Object.hasOwn(env, t)) throw new Error(`unknown name "${t}" in "${expr}"`);
    return env[t];
  }
  const out = expression();
  if (i !== toks.length) throw new Error(`trailing input in "${expr}"`);
  return out;
}

/* ---------- numbers written in text ---------- */
const plain = (html) => String(html).replace(/\{\{|\}\}/g, '').replace(/−/g, '-').replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ');
export const numbersIn = (html) => (plain(html).match(/\d+(?:\.\d+)?/g) || []).map(Number);
const sameNum = (a, b) => Math.abs(a - b) <= 1e-9 * (1 + Math.abs(a) + Math.abs(b));

/* ---------- independent models: recompute the final answers by another method ---------- */
const G = 10;
function stepFall(h, v0 = 0, dt = 1e-5) { // fall straight down from rest by time stepping
  let y = 0, v = v0, t = 0;
  while (y < h) { v += G * dt; y += v * dt; t += dt; }
  return { t, v };
}
const scan = (f, lo, hi, step) => { const r = []; let prev = f(lo); for (let x = lo + step; x <= hi + 1e-12; x += step) { const c = f(x); if (prev === 0 || prev * c < 0) r.push(x - step / 2); prev = c; } return r; };
const rnd = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

const MODEL = {
  'wr-p-1': () => { const r = stepFall(80); return { t: r.t, v: r.v }; },
  'wr-p-2': () => {
    let y = 0, v = 30, t = 0, top = 0; const dt = 1e-5;
    while (y >= 0) { v -= G * dt; y += v * dt; t += dt; top = Math.max(top, y); }
    return { H: top, T: t };
  },
  'wr-p-3': () => { const r = stepFall(45); return { t: r.t, x: 8 * r.t, vy: r.v }; },
  'wr-p-4': () => { let v = 10, x = 0; const dt = 1e-5; for (let t = 0; t < 6; t += dt) { x += v * dt; v += 2 * dt; } return { v, x }; },
  'wr-p-5': () => {
    const fk = 0.5 * 4 * G; let v = 0; const dt = 1e-5; let a = 0;
    for (let t = 0; t < 4; t += dt) { a = (30 - fk) / 4; v += a * dt; }
    return { f: fk, a, v };
  },
  'wr-p-6': () => { // real angle, not the rounded 0.5
    const a = G * Math.sin(Math.PI / 6); let v = 0, x = 0; const dt = 1e-6;
    while (x < 10) { v += a * dt; x += v * dt; }
    return { a, v };
  },
  'wr-p-7': () => { const r = stepFall(20); return { v: r.v, Ek: 0.5 * 50 * r.v * r.v, Ep: 50 * G * 20 }; },
  'wr-p-8': () => {
    let best = null; // solve the sticking collision by searching v until momentum is conserved
    for (let v = 0; v <= 4; v += 1e-4) if (best === null || Math.abs(3 * 4 - 4 * v) < Math.abs(3 * 4 - 4 * best)) best = v;
    return { v: best, dE: 0.5 * 3 * 16 - 0.5 * 4 * best * best };
  },
  'wr-m-1': () => { const r = scan((x) => x * (18 - x) - 80, 0, 18, 1e-4); return { x1: Math.max(...r), x2: Math.min(...r) }; },
  'wr-m-2': () => { // brute force over whole shekels
    const sol = []; for (let a = 1; a <= 100; a++) for (let b = 1; b <= 100; b++) if (3 * a + 2 * b === 29 && 2 * a + 4 * b === 38) sol.push({ a, b });
    return sol.length === 1 ? sol[0] : { a: NaN, b: NaN };
  },
  'wr-m-3': () => { // roots of the ORIGINAL equation (not the squared one)
    const r = scan((x) => Math.sqrt(x + 7) - (x - 5), -7, 30, 1e-4);
    return { xa: r.length === 1 ? Math.round(r[0] * 1000) / 1000 : NaN, rootCount: r.length };
  },
  'wr-m-4': () => { const r = scan((x) => Math.pow(4, x + 1) - Math.pow(8, x - 1), -20, 20, 1e-3); return { sum: r.length === 1 ? Math.round(r[0] * 100) / 100 : NaN }; },
  'wr-m-5': () => { // sample the inequality and read off the boundaries
    const ok = (x) => (x - 1) / (x + 2) >= 0;
    const pts = []; let prev = ok(-50);
    for (let x = -49.999; x < 50; x += 0.001) { if (Math.abs(x + 2) < 1e-6) continue; const c = ok(x); if (c !== prev) pts.push(x); prev = c; }
    return { lo: Math.round(pts[0]), hi: Math.round(pts[1]), n: pts.length, atMinus2: ok(-2) ? 1 : 0, at1: ok(1) ? 1 : 0 };
  },
  'wr-m-6': () => { let cents = 48000; cents = Math.round(cents * 80 / 100); cents = Math.round(cents * 115 / 100); return { p2: cents / 100, chg: rnd(100 - (cents / 48000) * 100, 6) }; },
  'wr-m-7': () => {
    const sol = []; for (let a1 = -50; a1 <= 50; a1++) for (let d = -20; d <= 20; d++) if (a1 + 3 * d === 17 && a1 + 8 * d === 37) sol.push({ a1, d });
    if (sol.length !== 1) return { d: NaN, a1: NaN, S: NaN };
    let S = 0; for (let n = 0; n < 20; n++) S += sol[0].a1 + n * sol[0].d;
    return { d: sol[0].d, a1: sol[0].a1, S };
  },
  'wr-m-8': () => {
    const r = Math.hypot(3, 4); const xs = scan((x) => (x - 3) ** 2 + 16 - r * r, -10, 10, 1e-4);
    return { r, xa: Math.max(...xs), xb: Math.min(...xs) };
  },
};

/* ---------- validation ---------- */
export function validate(tasks) {
  const errors = [];
  const stats = { physics: 0, math: 0, facts: 0, numbers: 0, modelFacts: 0 };
  const seen = new Set();
  const err = (id, msg) => errors.push(`${id}: ${msg}`);
  if (!Array.isArray(tasks)) return { errors: ['data is not an array'], stats };
  for (const t of tasks) {
    const id = t && t.id;
    if (!validTask(t)) { err(id, 'fails validTask (shape)'); continue; }
    if (seen.has(id)) err(id, 'duplicate id'); seen.add(id);
    stats[t.subject]++;

    /* rubric */
    const total = t.rubric.reduce((s, r) => s + r.pts, 0);
    if (total < 5 || total > 9) err(id, `rubric total ${total} outside 5..9`);
    for (const s of STAGES) if (!t.rubric.some((r) => r.stage === s.id)) err(id, `rubric has no line for stage ${s.id}`);
    if (t.rubric.some((r) => r.ecf) === false) err(id, 'no rubric line marked ecf (carry-forward)');

    /* facts: value and unit */
    const env = {};
    for (const [k, v] of Object.entries(t.vars || {})) {
      try { env[k] = { v: v.v, d: parseDim(v.d) }; } catch (e) { err(id, `var ${k}: ${e.message}`); }
    }
    const lits = [];
    const finals = [];
    for (const m of t.model) {
      for (const f of m.facts || []) {
        stats.facts++;
        try {
          const r = evaluate(f.e, env);
          if (!sameNum(r.v, f.v)) err(id, `fact ${f.n} = ${f.e} evaluates to ${r.v}, stored ${f.v}`);
          const want = parseDim(f.d);
          if (!sameDim(r.d, want)) err(id, `fact ${f.n}: expression has unit [${dimKey(r.d)}], stored [${dimKey(want)}]`);
          env[f.n] = { v: f.v, d: want };
          lits.push(...numbersIn(f.e), Math.abs(f.v));
          if (f.final) finals.push({ ...f, stage: m.stage });
        } catch (e) { err(id, `fact ${f.n}: ${e.message}`); }
      }
    }
    lits.push(...Object.values(t.vars || {}).map((v) => Math.abs(v.v)), 0);

    /* numbers in text */
    const allowed = [...lits, ...numbersIn(t.statement)];
    const covered = (n) => allowed.some((a) => sameNum(a, n));
    for (const m of t.model) for (const n of numbersIn(m.text)) { stats.numbers++; if (!covered(n)) err(id, `model ${m.stage}: number ${n} is not given, not a variable and not a computed fact`); }
    for (const r of t.rubric) for (const n of numbersIn(r.label)) if (!covered(n)) err(id, `rubric ${r.id}: number ${n} is not a known value`);

    /* units of the final answers */
    const concl = plain(t.model[t.model.length - 1].text).replace(/\s+/g, ' ');
    if (!finals.length) err(id, 'no final fact');
    for (const f of finals) {
      if (f.stage !== 'calculation') err(id, `final fact ${f.n} is not in the calculation stage`);
      const heb = HEB_UNIT.get(dimKey(parseDim(f.d)));
      if (f.u !== (heb || '')) err(id, `final ${f.n}: unit label "${f.u}" does not match dimension [${f.d}] (expected "${heb || ''}")`);
      if (f.u && !concl.includes(`${f.v} ${f.u}`)) err(id, `conclusion does not state "${f.v} ${f.u}"`);
      if (!f.u && !concl.includes(String(f.v))) err(id, `conclusion does not state ${f.v}`);
    }

    /* physics constants, no complex numbers */
    if (t.subject === 'physics') {
      if (t.vars.g && (t.vars.g.v !== 10 || t.vars.g.d !== 'm/s^2')) err(id, 'g must be 10 m/s^2');
      if (t.vars.g && !plain(t.statement).includes('g = 10')) err(id, 'statement must say g = 10');
    }
    if (/מרוכב|\bi\b|√\(−/.test(plain(t.statement) + plain(t.model.map((m) => m.text).join(' ')))) err(id, 'complex numbers are not allowed');

    /* independent recomputation */
    const model = MODEL[id];
    if (!model) { err(id, 'no independent model in the verifier'); continue; }
    const want = model();
    const byName = new Map(t.model.flatMap((m) => m.facts || []).map((f) => [f.n, f]));
    for (const f of finals) if (!Object.hasOwn(want, f.n)) err(id, `final fact ${f.n} has no independent recomputation`);
    for (const [k, val] of Object.entries(want)) {
      const f = byName.get(k);
      stats.modelFacts++;
      if (f) {
        if (!Number.isFinite(val) || Math.abs(val - f.v) > 2e-3 * (1 + Math.abs(f.v))) err(id, `independent value of ${k} is ${val}, stored ${f.v}`);
      }
    }
    /* special checks that are not plain facts */
    if (id === 'wr-m-3') {
      if (want.rootCount !== 1) err(id, `the original equation should have exactly one root, found ${want.rootCount}`);
      const x2 = byName.get('xb');
      if (x2 && Math.abs(Math.sqrt(x2.v + 7) - (x2.v - 5)) < 1e-6) err(id, 'x = 2 is not extraneous');
    }
    if (id === 'wr-m-5') {
      const v = want;
      if (v.lo !== -2 || v.hi !== 1 || v.n !== 2) err(id, `solution set boundaries are ${JSON.stringify(v)}, expected x<-2 or x>=1`);
      if (v.atMinus2 !== 0 || v.at1 !== 1) err(id, '-2 must be excluded and 1 included');
    }
    if (id === 'wr-p-7' && Math.abs(want.Ek - want.Ep) > 1e-3 * want.Ep) err(id, 'energy is not conserved in the independent model');
  }
  if (stats.physics !== 8) errors.push(`expected 8 physics tasks, found ${stats.physics}`);
  if (stats.math !== 8) errors.push(`expected 8 math tasks, found ${stats.math}`);
  return { errors, stats };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { errors, stats } = validate(loadWriting());
  if (errors.length) { console.error(errors.join('\n')); console.error(`\n${errors.length} problem(s)`); process.exitCode = 1; }
  else console.log(`writing ok: ${stats.physics} physics + ${stats.math} math tasks, ${stats.facts} facts, ${stats.numbers} numbers in model text, ${stats.modelFacts} independent recomputations`);
}

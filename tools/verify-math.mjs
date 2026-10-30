// Verifies data/math.json: exact rational arithmetic (BigInt), no dependencies.
//  - kind unique/none/infinite: exact Gaussian elimination
//  - kind finite: polynomial systems (degree <= 2 typical) parsed from plain strings,
//    every claimed solution checked exactly, completeness checked by elimination + search.
// Usage: node tools/verify-math.mjs [path-to-json]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const abs = (a) => (a < 0n ? -a : a);
const gcd = (a, b) => {
  a = abs(a);
  b = abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
};
const isqrt = (n) => {
  if (n < 2n) return n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  while (x * x > n) x--;
  while ((x + 1n) * (x + 1n) <= n) x++;
  return x;
};

export class Frac {
  constructor(n, d = 1n) {
    if (d === 0n) throw new Error('zero denominator');
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcd(n, d) || 1n;
    this.n = n / g;
    this.d = d / g;
  }
  add(o) { return new Frac(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o) { return new Frac(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o) { return new Frac(this.n * o.n, this.d * o.d); }
  div(o) { return new Frac(this.n * o.d, this.d * o.n); }
  neg() { return new Frac(-this.n, this.d); }
  isZero() { return this.n === 0n; }
  equals(o) { return this.n === o.n && this.d === o.d; }
  toString() { return this.d === 1n ? `${this.n}` : `${this.n}/${this.d}`; }
}
const ZERO = new Frac(0n);
const ONE = new Frac(1n);

// Accepts integers, "p/q" strings and plain decimal strings ("2.5").
export function parseFrac(v) {
  if (v instanceof Frac) return v;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`bad number ${v}`);
    v = String(v);
  }
  if (typeof v !== 'string') throw new Error(`bad value ${JSON.stringify(v)}`);
  const s = v.trim();
  let m;
  if ((m = /^([+-]?\d+)\/(\d+)$/.exec(s))) return new Frac(BigInt(m[1]), BigInt(m[2]));
  if ((m = /^([+-]?)(\d+)\.(\d+)$/.exec(s))) {
    const sign = m[1] === '-' ? -1n : 1n;
    return new Frac(sign * BigInt(m[2] + m[3]), 10n ** BigInt(m[3].length));
  }
  if (/^[+-]?\d+$/.test(s)) return new Frac(BigInt(s));
  throw new Error(`cannot parse number "${v}"`);
}

const sqrtFrac = (f) => {
  if (f.n < 0n) return null;
  const a = isqrt(f.n);
  const b = isqrt(f.d);
  return a * a === f.n && b * b === f.d ? new Frac(a, b) : null;
};

// Reduced row echelon form of an augmented matrix (Frac[][]), n unknowns.
function rref(m, n) {
  m = m.map((r) => r.slice());
  let r = 0;
  const pivots = [];
  for (let c = 0; c < n && r < m.length; c++) {
    let p = r;
    while (p < m.length && m[p][c].isZero()) p++;
    if (p === m.length) continue;
    [m[r], m[p]] = [m[p], m[r]];
    const pv = m[r][c];
    m[r] = m[r].map((x) => x.div(pv));
    for (let i = 0; i < m.length; i++) {
      if (i === r || m[i][c].isZero()) continue;
      const f = m[i][c];
      m[i] = m[i].map((x, j) => x.sub(f.mul(m[r][j])));
    }
    pivots.push(c);
    r++;
  }
  let inconsistent = false;
  for (let i = r; i < m.length; i++) if (!m[i][n].isZero()) inconsistent = true;
  return { m, pivots, rank: r, inconsistent };
}

// rows: augmented matrix, each row has n coefficients then the right-hand side.
// Returns { kind: 'unique'|'none'|'infinite', solution: Frac[]|null, rank }.
export function solveSystem(rows, n = rows[0].length - 1) {
  const m = rows.map((r) => {
    if (r.length !== n + 1) throw new Error(`row has ${r.length} entries, expected ${n + 1}`);
    return r.map(parseFrac);
  });
  const { m: e, pivots, rank, inconsistent } = rref(m, n);
  if (inconsistent) return { kind: 'none', solution: null, rank };
  if (rank === n) return { kind: 'unique', solution: pivots.map((c, i) => e[i][n]), rank };
  return { kind: 'infinite', solution: null, rank };
}

// ---------------------------------------------------------------- polynomials
const keyOf = (e) => e.join(',');

export class Poly {
  constructor(nv, terms = new Map()) {
    this.nv = nv;
    this.terms = terms; // key -> { e: number[], c: Frac }
  }
  static constant(nv, c) {
    const p = new Poly(nv);
    if (!c.isZero()) {
      const e = new Array(nv).fill(0);
      p.terms.set(keyOf(e), { e, c });
    }
    return p;
  }
  static variable(nv, i) {
    const e = new Array(nv).fill(0);
    e[i] = 1;
    return new Poly(nv, new Map([[keyOf(e), { e, c: ONE }]]));
  }
  static #accumulate(map, e, c) {
    const k = keyOf(e);
    const cur = map.get(k);
    const s = cur ? cur.c.add(c) : c;
    if (s.isZero()) map.delete(k);
    else map.set(k, { e, c: s });
  }
  add(o) {
    const t = new Map(this.terms);
    for (const { e, c } of o.terms.values()) Poly.#accumulate(t, e, c);
    return new Poly(this.nv, t);
  }
  neg() { return this.scale(new Frac(-1n)); }
  sub(o) { return this.add(o.neg()); }
  scale(f) {
    const t = new Map();
    for (const [k, { e, c }] of this.terms) {
      const s = c.mul(f);
      if (!s.isZero()) t.set(k, { e, c: s });
    }
    return new Poly(this.nv, t);
  }
  mul(o) {
    const t = new Map();
    for (const a of this.terms.values()) {
      for (const b of o.terms.values()) Poly.#accumulate(t, a.e.map((x, i) => x + b.e[i]), a.c.mul(b.c));
    }
    return new Poly(this.nv, t);
  }
  pow(k) {
    let r = Poly.constant(this.nv, ONE);
    for (let i = 0; i < k; i++) r = r.mul(this);
    return r;
  }
  isZero() { return this.terms.size === 0; }
  isConst() { return [...this.terms.values()].every(({ e }) => e.every((x) => x === 0)); }
  constValue() {
    const t = this.terms.get(keyOf(new Array(this.nv).fill(0)));
    return t ? t.c : ZERO;
  }
  degree() {
    let d = 0;
    for (const { e } of this.terms.values()) d = Math.max(d, e.reduce((a, b) => a + b, 0));
    return d;
  }
  usedVars() {
    const s = new Set();
    for (const { e } of this.terms.values()) e.forEach((x, i) => { if (x > 0) s.add(i); });
    return s;
  }
  // Substitute known values (assign[i] a Frac, or null/undefined for "still unknown").
  partial(assign) {
    const t = new Map();
    for (const { e, c } of this.terms.values()) {
      let coef = c;
      const ne = e.slice();
      e.forEach((x, i) => {
        if (x > 0 && assign[i]) {
          for (let j = 0; j < x; j++) coef = coef.mul(assign[i]);
          ne[i] = 0;
        }
      });
      Poly.#accumulate(t, ne, coef);
    }
    return new Poly(this.nv, t);
  }
  // Replace variable i by the polynomial repl.
  subst(i, repl) {
    let out = new Poly(this.nv);
    for (const { e, c } of this.terms.values()) {
      const ne = e.slice();
      ne[i] = 0;
      const base = new Poly(this.nv, new Map([[keyOf(ne), { e: ne, c }]]));
      out = out.add(base.mul(repl.pow(e[i])));
    }
    return out;
  }
}

// ---------------------------------------------------------------- equation parser
// Grammar: numbers (3, 0.5), single-letter variables, + - * / ^ ( ), implicit
// multiplication ("2x", "3(x+y)", "xy"), "=" exactly once.  ^ takes a small integer.
function tokenize(s) {
  const toks = [];
  const re = /\s*(?:(\d+(?:\.\d+)?)|([A-Za-z])|([-+*/^()=]))/y;
  let pos = 0;
  while (pos < s.length) {
    if (/^\s*$/.test(s.slice(pos))) break;
    re.lastIndex = pos;
    const m = re.exec(s);
    if (!m) throw new Error(`unexpected character near "${s.slice(pos, pos + 6)}" in "${s}"`);
    pos = re.lastIndex;
    if (m[1] !== undefined) toks.push({ t: 'num', v: m[1] });
    else if (m[2] !== undefined) toks.push({ t: 'var', v: m[2] });
    else toks.push({ t: 'op', v: m[3] });
  }
  return toks;
}

export function parseEquation(str, vars) {
  const nv = vars.length;
  const toks = tokenize(str);
  let i = 0;
  const peek = () => toks[i];
  const isOp = (v) => toks[i] && toks[i].t === 'op' && toks[i].v === v;
  const fail = (msg) => { throw new Error(`${msg} in "${str}"`); };

  function atom() {
    const t = toks[i];
    if (!t) fail('unexpected end');
    if (t.t === 'num') { i++; return Poly.constant(nv, parseFrac(t.v)); }
    if (t.t === 'var') {
      const idx = vars.indexOf(t.v);
      if (idx < 0) fail(`unknown variable ${t.v}`);
      i++;
      return Poly.variable(nv, idx);
    }
    if (isOp('(')) {
      i++;
      const p = expr();
      if (!isOp(')')) fail('missing )');
      i++;
      return p;
    }
    return fail(`unexpected "${t.v}"`);
  }
  function power() {
    const base = atom();
    if (!isOp('^')) return base;
    i++;
    const t = toks[i];
    if (!t || t.t !== 'num' || !/^\d+$/.test(t.v) || Number(t.v) > 6) fail('exponent must be an integer 0..6');
    i++;
    return base.pow(Number(t.v));
  }
  function unary() {
    if (isOp('-')) { i++; return unary().neg(); }
    if (isOp('+')) { i++; return unary(); }
    return power();
  }
  function term() {
    let p = unary();
    for (;;) {
      const t = peek();
      if (isOp('*')) { i++; p = p.mul(unary()); }
      else if (isOp('/')) {
        i++;
        const d = unary();
        if (!d.isConst() || d.isZero()) fail('can only divide by a non-zero number');
        p = p.scale(ONE.div(d.constValue()));
      } else if (t && (t.t === 'var' || isOp('('))) p = p.mul(power());
      else return p;
    }
  }
  function expr() {
    let p = term();
    for (;;) {
      if (isOp('+')) { i++; p = p.add(term()); }
      else if (isOp('-')) { i++; p = p.sub(term()); }
      else return p;
    }
  }
  const lhs = expr();
  if (!isOp('=')) fail('expected "="');
  i++;
  const rhs = expr();
  if (i !== toks.length) fail('trailing input');
  return lhs.sub(rhs);
}

function polyToRow(p, nv) {
  const row = new Array(nv + 1).fill(ZERO);
  for (const { e, c } of p.terms.values()) {
    const deg = e.reduce((a, b) => a + b, 0);
    if (deg === 0) row[nv] = c.neg();
    else if (deg === 1) row[e.indexOf(1)] = c;
    else throw new Error('equation is not linear');
  }
  return row;
}

export function rowsFromEquations(equations, vars) {
  return equations.map((s) => polyToRow(parseEquation(s, vars), vars.length));
}

// ---------------------------------------------------------------- finite systems
const GRID = [];
for (let q = -60; q <= 60; q++) GRID.push(new Frac(BigInt(q), 4n)); // -15 .. 15 step 1/4

function rootsOf(p, v, notes) {
  const co = [ZERO, ZERO, ZERO];
  for (const { e, c } of p.terms.values()) {
    if (e[v] > 2) return GRID.filter((g) => p.partial(Object.assign(new Array(p.nv).fill(null), { [v]: g })).isZero());
    co[e[v]] = c;
  }
  const [c0, c1, c2] = co;
  if (c2.isZero()) return [c0.neg().div(c1)];
  const disc = c1.mul(c1).sub(new Frac(4n).mul(c2).mul(c0));
  if (disc.n < 0n) return [];
  const s = sqrtFrac(disc);
  if (!s) {
    notes.incomplete = 'a quadratic has irrational real roots (completeness cannot be certified)';
    return [];
  }
  const two = new Frac(2n).mul(c2);
  const r1 = c1.neg().add(s).div(two);
  const r2 = c1.neg().sub(s).div(two);
  return s.isZero() ? [r1] : [r1, r2];
}

// polys: Poly[] (each "= 0"). Returns { solutions: Frac[][], incomplete: string|null }.
export function solveFinite(polys, nv) {
  const notes = { incomplete: null };
  const lin = polys.filter((p) => p.degree() <= 1 && !p.isZero());
  let rest = polys.filter((p) => p.degree() > 1);
  if (polys.some((p) => p.isConst() && !p.isZero())) return { solutions: [], incomplete: null };
  const { m, pivots, inconsistent } = rref(lin.map((p) => polyToRow(p, nv)), nv);
  if (inconsistent) return { solutions: [], incomplete: null };
  const free = [...Array(nv).keys()].filter((c) => !pivots.includes(c));
  const expr = new Map();
  pivots.forEach((c, r) => {
    let p = Poly.constant(nv, m[r][nv]);
    for (const j of free) if (!m[r][j].isZero()) p = p.sub(Poly.variable(nv, j).scale(m[r][j]));
    expr.set(c, p);
  });
  for (const [c, p] of expr) rest = rest.map((q) => q.subst(c, p));

  const found = [];
  const assign = new Array(nv).fill(null);
  const rec = () => {
    const live = [];
    for (const p of rest) {
      const q = p.partial(assign);
      if (q.isZero()) continue;
      if (q.isConst()) return;
      live.push(q);
    }
    const open = free.filter((i) => !assign[i]);
    if (!live.length) {
      if (open.length) notes.incomplete = `variable(s) ${open.map((i) => i + 1).join(', ')} are not determined (infinitely many solutions)`;
      else found.push(assign.slice());
      return;
    }
    let best = null;
    for (const q of live) {
      const u = q.usedVars();
      if (u.size === 1 && (!best || q.degree() < best.q.degree())) best = { q, v: [...u][0] };
    }
    let target;
    let cands;
    if (best) {
      target = best.v;
      cands = rootsOf(best.q, target, notes);
    } else {
      const freq = new Map();
      for (const q of live) for (const v of q.usedVars()) freq.set(v, (freq.get(v) || 0) + 1);
      target = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
      cands = GRID;
    }
    for (const c of cands) {
      assign[target] = c;
      rec();
    }
    assign[target] = null;
  };
  rec();

  const solutions = found.map((a) => {
    const full = a.slice();
    for (const [c, p] of expr) full[c] = p.partial(a).constValue();
    return full;
  });
  return { solutions, incomplete: notes.incomplete };
}

const evalAll = (polys, sol) => polys.every((p) => p.partial(sol).constValue().isZero());
const key = (sol) => sol.map(String).join('|');
function sameSets(a, b) {
  const ka = a.map(key).sort();
  const kb = b.map(key).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
}

// ---------------------------------------------------------------- validation
const HEB = /[֐-׿]/;
const KIND_OPTION = { none: 'אין פתרון', unique: 'פתרון יחיד', infinite: 'אינסוף פתרונות' };
const DECIMAL2 = /^-?\d+(\.\d{1,2})?$/;
const defaultVars = (n) => ['x', 'y', 'z', 'w'].slice(0, n);

function numberAppears(text, value) {
  return new RegExp(`(?<![\\d.])${value}(?!\\d)`).test(text);
}

export function validate(data, opts = {}) {
  const expected = opts.expectedPerTopic ?? 20;
  const errors = [];
  const err = (id, msg) => errors.push(`${id}: ${msg}`);
  if (!Array.isArray(data)) return ['top level must be an array'];
  const seen = new Set();
  const counts = {};
  for (const [idx, ex] of data.entries()) {
    const id = ex && ex.id ? ex.id : `#${idx}`;
    if (!ex || typeof ex !== 'object') { err(id, 'not an object'); continue; }
    if (seen.has(ex.id)) err(id, 'duplicate id');
    seen.add(ex.id);
    if (ex.topic !== 'math-3' && ex.topic !== 'math-4') { err(id, `bad topic ${ex.topic}`); continue; }
    counts[ex.topic] = (counts[ex.topic] || 0) + 1;
    const n = ex.topic === 'math-3' ? 3 : 4;
    if (!new RegExp(`^${ex.topic}-\\d{3}$`).test(ex.id)) err(id, 'id must look like math-3-001');
    if (![1, 2, 3].includes(ex.level)) err(id, 'level must be 1, 2 or 3');
    for (const f of ['title', 'statement']) {
      if (typeof ex[f] !== 'string' || !ex[f].trim()) err(id, `${f} empty`);
      else if (!HEB.test(ex[f])) err(id, `${f} has no Hebrew`);
    }
    if (!Array.isArray(ex.tips) || ex.tips.length !== 3) err(id, 'tips must have exactly 3 entries');
    else ex.tips.forEach((t, i) => { if (typeof t !== 'string' || !HEB.test(t)) err(id, `tip ${i + 1} empty or not Hebrew`); });
    if (!Array.isArray(ex.solution) || ex.solution.length < 3) err(id, 'solution needs at least 3 steps');
    else ex.solution.forEach((t, i) => { if (typeof t !== 'string' || !HEB.test(t)) err(id, `solution step ${i + 1} empty or not Hebrew`); });

    const COMPLEX = /sqrt\(\s*-|(?<![A-Za-z])i(?![A-Za-z])|imaginary|complex|מרוכב|דמיוני/i;
    const strings = [ex.title, ex.statement, ...(ex.tips || []), ...(ex.solution || []), ...(ex.inputs || []).flatMap((x) => [x.label, x.answer])];
    for (const s of strings) if (typeof s === 'string' && COMPLEX.test(s.replace(/<[^>]*>/g, ' '))) err(id, `complex/imaginary text found: "${s.slice(0, 40)}"`);
    for (const inp of ex.inputs || []) {
      if (!DECIMAL2.test(String(inp.answer))) err(id, `answer "${inp.answer}" must be an integer or a decimal with at most 2 decimal places`);
    }
    // No word problems: the statement must be written as equations.
    const plain = typeof ex.statement === 'string' ? ex.statement.replace(/<[^>]*>/g, ' ') : '';
    if ((plain.match(/=/g) || []).length < n) err(id, `statement must contain at least ${n} equations ("=")`);

    const v = ex.verify;
    if (!v || typeof v !== 'object') { err(id, 'verify missing'); continue; }
    if (!['unique', 'none', 'infinite', 'finite'].includes(v.kind)) { err(id, `verify.kind invalid: ${v.kind}`); continue; }
    const finite = v.kind === 'finite';
    const vars = Array.isArray(v.vars) ? v.vars : defaultVars(n);
    if (vars.length !== n || vars.some((x) => typeof x !== 'string' || !/^[A-Za-z]$/.test(x))) { err(id, `verify.vars must be ${n} single letters`); continue; }

    let uniqueSol = null; // Frac[] when the exercise has exactly one solution
    let solList = null; // Frac[][] for finite
    let resKind = null;

    if (!finite) {
      let rows = null;
      let fromEq = null;
      try {
        if (Array.isArray(v.system)) {
          if (v.system.length !== n) err(id, `system must have ${n} equations`);
          rows = v.system;
        }
        if (Array.isArray(v.equations)) {
          if (v.equations.length !== n) err(id, `equations must have ${n} entries`);
          fromEq = rowsFromEquations(v.equations, vars);
        }
      } catch (e) { err(id, `verify invalid: ${e.message}`); continue; }
      if (!rows && !fromEq) { err(id, 'verify.system or verify.equations missing'); continue; }
      let res;
      try {
        res = solveSystem(rows || fromEq, n);
        if (rows && fromEq) {
          const r2 = solveSystem(fromEq, n);
          if (r2.kind !== res.kind || (res.solution && !sameSets([res.solution], [r2.solution]))) {
            err(id, `verify.equations and verify.system describe different systems (${r2.kind} vs ${res.kind})`);
          }
        }
      } catch (e) { err(id, `verify.system invalid: ${e.message}`); continue; }
      if (res.kind !== v.kind) err(id, `declared kind "${v.kind}" but the system is "${res.kind}"`);
      resKind = res.kind;
      if (res.kind === 'unique') uniqueSol = res.solution;
      for (const [j, a] of (v.also || []).entries()) {
        try {
          const r = solveSystem(a.system, n);
          if (r.kind !== a.kind) err(id, `also[${j}]: declared "${a.kind}" but system is "${r.kind}"`);
          if (a.solution && !(r.solution && sameSets([r.solution], [a.solution.map(parseFrac)]))) err(id, `also[${j}]: solution mismatch`);
        } catch (e) { err(id, `also[${j}] invalid: ${e.message}`); }
      }
    } else {
      if (!Array.isArray(v.equations) || !v.equations.length) { err(id, 'finite: verify.equations missing'); continue; }
      if (!Array.isArray(v.solutions) || !v.solutions.length) { err(id, 'finite: verify.solutions missing'); continue; }
      let polys;
      try {
        polys = v.equations.map((s) => parseEquation(s, vars));
        solList = v.solutions.map((s) => {
          if (!Array.isArray(s) || s.length !== n) throw new Error(`solution must have ${n} entries`);
          s.forEach((x) => { if (!DECIMAL2.test(String(x))) throw new Error(`solution value "${x}" must be an integer or a decimal with at most 2 decimal places`); });
          return s.map(parseFrac);
        });
      } catch (e) { err(id, `verify invalid: ${e.message}`); continue; }
      if (new Set(solList.map(key)).size !== solList.length) err(id, 'duplicate solutions listed');
      solList.forEach((s, j) => { if (!evalAll(polys, s)) err(id, `claimed solution #${j + 1} (${s.map(String).join(', ')}) does not satisfy all equations exactly`); });
      const { solutions: found, incomplete } = solveFinite(polys, n);
      if (incomplete) err(id, `completeness not certified: ${incomplete}`);
      else if (!sameSets(found, solList)) {
        const listed = new Set(solList.map(key));
        const have = new Set(found.map(key));
        for (const s of found) if (!listed.has(key(s))) err(id, `system has a solution that is not listed: (${s.map(String).join(', ')})`);
        for (const s of solList) if (!have.has(key(s))) err(id, `listed solution (${s.map(String).join(', ')}) was not found by the solver`);
      }
      resKind = 'finite';
      if (solList.length === 1) uniqueSol = solList[0];
    }

    const hasInputs = Array.isArray(ex.inputs) && ex.inputs.length > 0;
    const forms = [hasInputs, !!ex.choice, !!ex.answerSets].filter(Boolean).length;
    if (forms !== 1) err(id, 'exactly one of inputs / choice / answerSets is required');
    if (hasInputs) {
      ex.inputs.forEach((inp, i) => {
        if (!inp || typeof inp.label !== 'string' || !inp.label.trim()) err(id, `input ${i + 1} label empty`);
        if (typeof inp.unit !== 'string') err(id, `input ${i + 1} unit must be a string`);
        if (typeof inp.tolerance !== 'number' || !(inp.tolerance > 0)) err(id, `input ${i + 1} tolerance must be > 0`);
      });
      if (finite && solList && solList.length > 1) err(id, 'several solutions: use answerSets instead of inputs');
      if (uniqueSol) {
        if (ex.inputs.length !== n) err(id, `unique system needs ${n} inputs`);
        else ex.inputs.forEach((inp, i) => {
          try {
            if (!parseFrac(inp.answer).equals(uniqueSol[i])) err(id, `input ${i + 1} answer "${inp.answer}" but exact solution is ${uniqueSol[i]}`);
          } catch (e) { err(id, `input ${i + 1}: ${e.message}`); }
        });
      }
    }
    if (ex.choice) {
      const c = ex.choice;
      if (finite) err(id, 'choice cannot be used with finite systems');
      else if (!Array.isArray(c.options) || c.options.length < 2 || !Number.isInteger(c.correct) || !c.options[c.correct]) err(id, 'choice malformed');
      else if (c.options[c.correct] !== KIND_OPTION[resKind]) err(id, `choice marks "${c.options[c.correct]}" but system is "${resKind}"`);
    }
    if (ex.answerSets) {
      const a = ex.answerSets;
      if (!finite) err(id, 'answerSets only for finite systems');
      else if (!Array.isArray(a.labels) || a.labels.length !== n || a.labels.some((l) => typeof l !== 'string' || !l.trim())) err(id, `answerSets.labels must have ${n} entries`);
      else if (!Array.isArray(a.sets) || a.count !== a.sets.length) err(id, 'answerSets.count must equal sets.length');
      else if (!(typeof a.tolerance === 'number' && a.tolerance > 0)) err(id, 'answerSets.tolerance must be > 0');
      else if (a.sets.some((s) => !Array.isArray(s) || s.length !== n || s.some((x) => !DECIMAL2.test(String(x))))) err(id, 'answerSets.sets entries must be integers/decimals (<= 2 decimals)');
      else if (solList && !sameSets(a.sets.map((s) => s.map(parseFrac)), solList)) err(id, 'answerSets.sets differ from verify.solutions');
    }

    // Sanity: coefficients of a plain linear statement appear in the statement.
    const parenthesised = /[(/]|<sup>/.test(ex.statement || '');
    const hasParam = /(?<![A-Za-z])[kmt](?![A-Za-z])/.test(plain);
    if (!finite && Array.isArray(v.system) && !parenthesised && !hasParam) {
      for (const row of v.system) {
        for (const cell of row) {
          let f;
          try { f = parseFrac(cell); } catch { continue; }
          if (f.isZero()) continue;
          const nums = f.d === 1n ? [abs(f.n)] : [abs(f.n), f.d];
          for (const x of nums) {
            if (x !== 1n && !numberAppears(plain, x)) err(id, `number ${x} from verify.system does not appear in the statement`);
          }
        }
      }
    }
  }
  for (const t of ['math-3', 'math-4']) {
    if (counts[t] !== expected) errors.push(`${t}: expected ${expected} exercises, found ${counts[t] || 0}`);
  }
  return errors;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const file = process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'math.json');
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
  console.log(`OK: ${data.length} exercises verified`);
}

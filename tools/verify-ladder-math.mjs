// Independent verifier of the MATH ladder (data/ladder-math.json). It shares no code with the page and trusts no stored number:
// every inline item is re-solved here from the equation strings, with exact rational arithmetic (BigInt fractions, Gaussian
// elimination with pivoting), and compared with the stored answers of ALL parts. The solution is then plugged back into every
// ORIGINAL equation (both sides separately): residual exactly 0 for the rationals, <= 1e-9 in doubles for the decimal check.
// Rules checked as well: unique solution (non-singular), every answer an integer or a finite decimal with at most 2 decimals,
// statement shows exactly the stored equations, lettered parts = inputs = verify.parts, 3 tips that do not give the answer.
// A discriminant-based exact quadratic solver (solveQuadratic) is included for the later quadratic stages (M4-M6).
//
// Item contract (see data/ladder-math.json):
//   verify: { kind: 'system', vars: ['x','y'], eqs: ['2*x+3*y=7', ...], parts: [{ e: 'x' }, { e: 'x+y' }, { eq: 2, side: 'left' }] }
//         | { kind: 'eval', values: { x: '3', y: '-2' }, exprs: [...], parts: [{ e: '2*x-5*y+1' }, ...] }
//   Expression syntax: numbers (decimals ok), single-letter names, + - * / ^n, parentheses; the system must be linear.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------- exact fractions (BigInt)
const big = (x) => BigInt(x);
const gcdB = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; };
export function fr(n, d = 1n) {
  n = big(n); d = big(d);
  if (d === 0n) throw new Error('division by zero');
  if (d < 0n) { n = -n; d = -d; }
  const g = gcdB(n, d) || 1n;
  return { n: n / g, d: d / g };
}
export const F = {
  add: (a, b) => fr(a.n * b.d + b.n * a.d, a.d * b.d),
  sub: (a, b) => fr(a.n * b.d - b.n * a.d, a.d * b.d),
  mul: (a, b) => fr(a.n * b.n, a.d * b.d),
  div: (a, b) => { if (b.n === 0n) throw new Error('division by zero'); return fr(a.n * b.d, a.d * b.n); },
  neg: (a) => ({ n: -a.n, d: a.d }),
  isZero: (a) => a.n === 0n,
  eq: (a, b) => a.n === b.n && a.d === b.d,
  cmp: (a, b) => { const x = a.n * b.d, y = b.n * a.d; return x < y ? -1 : x > y ? 1 : 0; },
  abs: (a) => ({ n: a.n < 0n ? -a.n : a.n, d: a.d }),
  pow: (a, k) => { let r = fr(1n); for (let i = 0; i < k; i++) r = F.mul(r, a); return r; },
  num: (a) => Number(a.n) / Number(a.d),
};
/** "12", "-0.25", "3/4", "−2" -> fraction (exact). */
export function parseNum(s) {
  const t = String(s).trim().replace(/[−–]/g, '-').replace(/^\+/, '');
  let m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(t);
  if (m) {
    const frac = m[3] || '';
    return fr(BigInt((m[1] || '') + m[2] + frac), 10n ** BigInt(frac.length));
  }
  m = /^(-?\d+)\/(\d+)$/.exec(t);
  if (m) return fr(BigInt(m[1]), BigInt(m[2]));
  throw new Error(`not a number: ${s}`);
}
/** Number of decimal digits of a finite decimal fraction, or Infinity (repeating). */
export function decimals(a) {
  let d = a.d, k2 = 0, k5 = 0;
  while (d % 2n === 0n) { d /= 2n; k2++; }
  while (d % 5n === 0n) { d /= 5n; k5++; }
  return d === 1n ? Math.max(k2, k5) : Infinity;
}
/** Exact decimal string of a finite-decimal fraction ("2.5", "-3"), or null. */
export function toDecimal(a) {
  const k = decimals(a);
  if (!Number.isFinite(k)) return null;
  const scale = 10n ** BigInt(k);
  const v = (a.n * scale) / a.d;
  const neg = v < 0n;
  let s = (neg ? -v : v).toString().padStart(k + 1, '0');
  if (k) s = `${s.slice(0, -k)}.${s.slice(-k)}`;
  return (neg ? '-' : '') + s;
}

// ---------------------------------------------------------------- expression parser (AST)
function tokenize(src) {
  const out = [];
  const re = /\s*(?:(\d+(?:\.\d+)?)|([A-Za-z])|(.))/gy;
  let m;
  const s = String(src).replace(/[−–]/g, '-');
  while (re.lastIndex < s.length && (m = re.exec(s))) {
    if (m[1] !== undefined) out.push({ t: 'num', v: m[1] });
    else if (m[2] !== undefined) out.push({ t: 'var', v: m[2] });
    else if ('+-*/^()='.includes(m[3])) out.push({ t: m[3] });
    else throw new Error(`bad character "${m[3]}" in "${src}"`);
  }
  return out;
}
export function parseExpr(src) {
  const tk = tokenize(src);
  let i = 0;
  const peek = () => tk[i] && tk[i].t;
  const take = (t) => { if (peek() !== t) throw new Error(`expected ${t} in "${src}"`); return tk[i++]; };
  function expr() {
    let a = term();
    while (peek() === '+' || peek() === '-') { const op = tk[i++].t; a = { t: 'bin', op, a, b: term() }; }
    return a;
  }
  function term() {
    let a = unary();
    while (peek() === '*' || peek() === '/') { const op = tk[i++].t; a = { t: 'bin', op, a, b: unary() }; }
    return a;
  }
  function unary() {
    if (peek() === '-') { i++; return { t: 'neg', a: unary() }; }
    if (peek() === '+') { i++; return unary(); }
    return power();
  }
  function power() {
    const a = atom();
    if (peek() === '^') { i++; const e = take('num'); if (!/^\d+$/.test(e.v)) throw new Error('exponent must be a whole number'); return { t: 'pow', a, k: Number(e.v) }; }
    return a;
  }
  function atom() {
    const t = tk[i];
    if (!t) throw new Error(`unexpected end of "${src}"`);
    if (t.t === 'num') { i++; return { t: 'num', v: t.v }; }
    if (t.t === 'var') { i++; return { t: 'var', v: t.v }; }
    if (t.t === '(') { i++; const e = expr(); take(')'); return e; }
    throw new Error(`unexpected ${t.t} in "${src}"`);
  }
  const e = expr();
  if (i !== tk.length) throw new Error(`trailing input in "${src}"`);
  return e;
}
/** "L=R" -> { left, right } ASTs. */
export function parseEquation(src) {
  const parts = String(src).split('=');
  if (parts.length !== 2) throw new Error(`equation needs exactly one "=": ${src}`);
  return { left: parseExpr(parts[0]), right: parseExpr(parts[1]) };
}

// evaluation over a ring: exact fractions or doubles
const EXACT = {
  num: parseNum, add: F.add, sub: F.sub, mul: F.mul, div: F.div, neg: F.neg, pow: F.pow,
};
const FLOAT = {
  num: (s) => Number(s), add: (a, b) => a + b, sub: (a, b) => a - b, mul: (a, b) => a * b, div: (a, b) => a / b, neg: (a) => -a, pow: (a, k) => a ** k,
};
function evalAst(ast, env, R) {
  const go = (n) => {
    switch (n.t) {
      case 'num': return R.num(n.v);
      case 'var': if (!(n.v in env)) throw new Error(`unknown name ${n.v}`); return env[n.v];
      case 'neg': return R.neg(go(n.a));
      case 'pow': return R.pow(go(n.a), n.k);
      case 'bin': { const a = go(n.a), b = go(n.b); return R[{ '+': 'add', '-': 'sub', '*': 'mul', '/': 'div' }[n.op]](a, b); }
      default: throw new Error('bad node');
    }
  };
  return go(ast);
}
export const evalExact = (ast, env) => evalAst(ast, env, EXACT);
export const evalFloat = (ast, env) => evalAst(ast, env, FLOAT);

/** Linear form of an AST: { c, v: {name: fraction} }. Throws on products of two unknowns, powers of unknowns, division by an unknown. */
export function linearForm(ast) {
  const isConst = (l) => Object.values(l.v).every(F.isZero);
  const go = (n) => {
    switch (n.t) {
      case 'num': return { c: parseNum(n.v), v: {} };
      case 'var': return { c: fr(0n), v: { [n.v]: fr(1n) } };
      case 'neg': { const a = go(n.a); return { c: F.neg(a.c), v: Object.fromEntries(Object.entries(a.v).map(([k, x]) => [k, F.neg(x)])) }; }
      case 'pow': {
        const a = go(n.a);
        if (n.k === 1) return a;
        if (!isConst(a)) throw new Error('not linear: power of an unknown');
        return { c: F.pow(a.c, n.k), v: {} };
      }
      case 'bin': {
        const a = go(n.a), b = go(n.b);
        const sc = (l, k) => ({ c: F.mul(l.c, k), v: Object.fromEntries(Object.entries(l.v).map(([x, y]) => [x, F.mul(y, k)])) });
        if (n.op === '+' || n.op === '-') {
          const s = n.op === '+' ? F.add : F.sub;
          const v = { ...a.v };
          for (const [k, x] of Object.entries(b.v)) v[k] = s(v[k] || fr(0n), x);
          return { c: s(a.c, b.c), v };
        }
        if (n.op === '*') {
          if (isConst(a)) return sc(b, a.c);
          if (isConst(b)) return sc(a, b.c);
          throw new Error('not linear: product of unknowns');
        }
        if (!isConst(b)) throw new Error('not linear: division by an unknown');
        return sc(a, F.div(fr(1n), b.c));
      }
      default: throw new Error('bad node');
    }
  };
  return go(ast);
}
/** Equation -> row [coefficients per var] and rhs (exact). */
export function equationRow(src, vars) {
  const { left, right } = parseEquation(src);
  const l = linearForm(left), r = linearForm(right);
  for (const k of [...Object.keys(l.v), ...Object.keys(r.v)]) if (!vars.includes(k)) throw new Error(`unknown unknown ${k} in ${src}`);
  const co = vars.map((v) => F.sub(l.v[v] || fr(0n), r.v[v] || fr(0n)));
  return { co, rhs: F.sub(r.c, l.c) };
}

// ---------------------------------------------------------------- Gaussian elimination with pivoting
/** Solves A x = b exactly. Returns { status: 'unique', x } or { status: 'singular', rank }. */
export function solveLinear(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row.map((x) => ({ ...x })), { ...b[i] }]);
  let rank = 0;
  for (let col = 0; col < n && rank < n; col++) {
    let piv = -1;
    for (let r = rank; r < n; r++) if (!F.isZero(M[r][col]) && (piv < 0 || F.cmp(F.abs(M[r][col]), F.abs(M[piv][col])) > 0)) piv = r;
    if (piv < 0) continue;
    [M[rank], M[piv]] = [M[piv], M[rank]];
    for (let r = 0; r < n; r++) {
      if (r === rank || F.isZero(M[r][col])) continue;
      const k = F.div(M[r][col], M[rank][col]);
      for (let c = col; c <= n; c++) M[r][c] = F.sub(M[r][c], F.mul(k, M[rank][c]));
    }
    rank++;
  }
  if (rank < n) return { status: 'singular', rank };
  return { status: 'unique', x: M.map((row, i) => F.div(row[n], row[i])) };
}

// ---------------------------------------------------------------- discriminant solver (for the quadratic stages)
export function isqrt(n) {
  if (n < 0n) throw new Error('negative');
  if (n < 2n) return n;
  let x = n, y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + n / x) / 2n; }
  return x;
}
/** Exact square root of a fraction, or null when irrational. */
export function sqrtExact(a) {
  if (a.n < 0n) return null;
  const sn = isqrt(a.n), sd = isqrt(a.d);
  return sn * sn === a.n && sd * sd === a.d ? fr(sn, sd) : null;
}
/**
 * a x^2 + b x + c = 0 over the reals. { count: 0|1|2, roots: [fractions] (exact), irrational: true when D > 0 is not a perfect square }.
 * Roots are sorted ascending.
 */
export function solveQuadratic(a, b, c) {
  if (F.isZero(a)) {
    if (F.isZero(b)) return { count: F.isZero(c) ? Infinity : 0, roots: [], degenerate: true };
    return { count: 1, roots: [F.div(F.neg(c), b)], linear: true };
  }
  const D = F.sub(F.mul(b, b), F.mul(fr(4n), F.mul(a, c)));
  if (D.n < 0n) return { count: 0, roots: [], D };
  if (D.n === 0n) return { count: 1, roots: [F.div(F.neg(b), F.mul(fr(2n), a))], D };
  const s = sqrtExact(D);
  if (!s) return { count: 2, roots: [], irrational: true, D };
  const two = F.mul(fr(2n), a);
  const r = [F.div(F.sub(F.neg(b), s), two), F.div(F.add(F.neg(b), s), two)].sort(F.cmp);
  return { count: 2, roots: r, D };
}

// ---------------------------------------------------------------- item checks
const normMath = (s) => String(s).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/[−–]/g, '-').replace(/²/g, '^2').replace(/[\s*⁦⁧⁩]/g, '');
const HEB = /[א-ת]/;
const LETTERS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו'];
const ID_RE = /^lad-m([1-6])-(\d{2})$/;
const TOL = 0.01;

function partValue(part, env, eqs) {
  if (typeof part.e === 'string') return evalExact(parseExpr(part.e), env);
  if (Number.isInteger(part.eq) && (part.side === 'left' || part.side === 'right')) {
    if (!eqs || !eqs[part.eq - 1]) throw new Error(`part refers to equation ${part.eq}`);
    return evalExact(eqs[part.eq - 1][part.side], env);
  }
  throw new Error('part needs { e } or { eq, side }');
}
const partText = (part, item) => (typeof part.e === 'string' ? part.e : item.verify.eqs[part.eq - 1].split('=')[part.side === 'left' ? 0 : 1]);

/** Issues of one inline item (empty array = fine). */
export function checkItem(it) {
  const bad = [];
  const say = (m) => bad.push(`${it.id || '?'}: ${m}`);
  try {
    const m = ID_RE.exec(it.id || '');
    if (!m) say('bad id (lad-mS-NN)');
    for (const k of ['topic', 'title', 'statement']) if (typeof it[k] !== 'string' || !it[k]) say(`missing ${k}`);
    if (!HEB.test(it.title || '') || !HEB.test(it.statement || '')) say('title and statement must be Hebrew');
    if (!Number.isInteger(it.level) || it.level < 1 || it.level > 5) say('bad level');
    if (!Array.isArray(it.tips) || it.tips.length !== 3 || it.tips.some((t) => typeof t !== 'string' || !HEB.test(t))) say('tips must be exactly 3 Hebrew strings');
    if (!Array.isArray(it.solution) || it.solution.length < 3 || it.solution.some((t) => typeof t !== 'string' || !t)) say('solution needs at least 3 steps');
    const v = it.verify;
    if (!v || !Array.isArray(v.parts) || !Array.isArray(it.inputs)) { say('verify.parts and inputs are required'); return bad; }
    if (it.inputs.length < 3 || it.inputs.length > 5) say('3-5 lettered parts expected');
    if (v.parts.length !== it.inputs.length) say('verify.parts and inputs differ in length');
    const stmt = normMath(it.statement);
    const lettered = LETTERS.filter((l) => new RegExp(`(^|<br>|\\s)${l}\\.`).test(it.statement));
    if (lettered.length !== it.inputs.length) say(`statement has ${lettered.length} lettered parts, inputs ${it.inputs.length}`);
    if (/<script|onerror|javascript:/i.test(JSON.stringify(it))) say('unsafe markup');

    let env, eqs = null, vars = null;
    if (v.kind === 'system') {
      vars = v.vars;
      if (!Array.isArray(vars) || !vars.length || vars.length > 4 || vars.some((x) => !/^[a-z]$/.test(x))) { say('bad vars'); return bad; }
      if (!Array.isArray(v.eqs) || v.eqs.length !== vars.length) { say('need as many equations as unknowns'); return bad; }
      const rows = v.eqs.map((e) => equationRow(e, vars));
      eqs = v.eqs.map(parseEquation);
      v.eqs.forEach((e, k) => { if (!stmt.includes(normMath(e))) say(`statement does not show equation ${k + 1}: ${e}`); });
      const sol = solveLinear(rows.map((r) => r.co), rows.map((r) => r.rhs));
      if (sol.status !== 'unique') { say(`system is singular (rank ${sol.rank}), no unique solution`); return bad; }
      env = Object.fromEntries(vars.map((x, k) => [x, sol.x[k]]));
      sol.x.forEach((x, k) => { if (decimals(x) > 2) say(`solution ${vars[k]} = ${x.n}/${x.d} is not an integer or a decimal with at most 2 decimals`); });
      // plug into every ORIGINAL equation, both sides separately
      eqs.forEach((e, k) => {
        const l = evalExact(e.left, env), r = evalExact(e.right, env);
        if (!F.eq(l, r)) say(`equation ${k + 1}: residual is not 0 (${l.n}/${l.d} vs ${r.n}/${r.d})`);
        const fenv = Object.fromEntries(vars.map((x) => [x, F.num(env[x])]));
        const res = Math.abs(evalFloat(e.left, fenv) - evalFloat(e.right, fenv));
        if (!(res <= 1e-9)) say(`equation ${k + 1}: float residual ${res}`);
      });
    } else if (v.kind === 'eval') {
      if (!v.values || typeof v.values !== 'object') { say('eval items need values'); return bad; }
      env = {};
      for (const [k, x] of Object.entries(v.values)) {
        env[k] = parseNum(x);
        if (decimals(env[k]) > 2) say(`given value ${k} has more than 2 decimals`);
        if (!stmt.includes(normMath(`${k}=${x}`))) say(`statement does not give ${k} = ${x}`);
      }
    } else { say(`unknown verify.kind ${v.kind}`); return bad; }

    v.parts.forEach((p, k) => {
      const inp = it.inputs[k];
      if (!inp) return;
      const val = partValue(p, env, eqs);
      if (decimals(val) > 2) say(`part ${k + 1}: value is not an integer or a decimal with at most 2 decimals`);
      let stored;
      try { stored = parseNum(inp.answer); } catch (e) { say(`part ${k + 1}: answer "${inp.answer}" is not a number`); return; }
      if (!F.eq(stored, val)) say(`part ${k + 1}: stored answer ${inp.answer} differs from the exact value ${toDecimal(val) ?? `${val.n}/${val.d}`}`);
      if (typeof inp.answer !== 'string' || (toDecimal(stored) !== inp.answer)) say(`part ${k + 1}: answer must be the canonical decimal string "${toDecimal(stored)}"`);
      if (!(inp.tolerance > 0 && inp.tolerance <= TOL)) say(`part ${k + 1}: tolerance must be in (0, ${TOL}]`);
      if (inp.unit !== '') say(`part ${k + 1}: math answers have no unit`);
      if (!HEB.test(inp.label || '') && !/^[a-z]( [+\-−·] [a-z])*$/.test(inp.label || '')) say(`part ${k + 1}: bad label`);
      if (!stmt.includes(normMath(partText(p, it)))) say(`part ${k + 1}: the statement does not show ${partText(p, it)}`);
      // tips must not hand over the answer as "x = value"
      if (typeof p.e === 'string' && vars && vars.includes(p.e)) {
        const re = new RegExp(`${p.e}\\s*=\\s*[-−]?\\s*${inp.answer.replace('-', '').replace('.', '\\.')}(?![\\d.])`);
        if ((it.tips || []).some((t) => re.test(String(t).replace(/<[^>]*>/g, '')))) say(`a tip gives the answer to part ${k + 1}`);
        if (!normMath((it.solution || []).join(' ')).includes(normMath(`${p.e}=${inp.answer}`))) say(`solution never states ${p.e} = ${inp.answer}`);
      }
    });
  } catch (e) {
    say(`verification error: ${e.message}`);
  }
  return bad;
}

/** Inline items of the math ladder: [{ stage, it }]. */
export const inlineItems = (data) => data.stages.flatMap((s) => (s.items || []).filter((x) => !x.ref).map((it) => ({ stage: s.id, it })));

/** Whole-ladder checks. `math` = data/math.json (for the refs). Returns the list of issues. */
export function checkLadder(data, math = []) {
  const bad = [];
  const ids = data.stages.map((s) => s.id);
  if (JSON.stringify(ids) !== JSON.stringify(['M1', 'M2', 'M3', 'M4', 'M5', 'M6'])) bad.push(`stages must be M1..M6, got ${ids}`);
  const byId = new Map(math.map((e) => [e.id, e]));
  const seen = new Set();
  for (const s of data.stages) {
    if (!HEB.test(s.title || '') || !HEB.test(s.intro || '')) bad.push(`${s.id}: Hebrew title and intro required`);
    if (!s.items.length && !/בקרוב/.test(s.soon || '')) bad.push(`${s.id}: empty stage needs a "soon" note`);
    for (const it of s.items) {
      const id = it.ref || it.id;
      if (seen.has(id)) bad.push(`${s.id}: duplicate ${id}`);
      seen.add(id);
      if (it.ref) {
        const ex = byId.get(it.ref);
        if (!ex) bad.push(`${s.id}: unknown ref ${it.ref}`);
        else if (ex.level > 2) bad.push(`${s.id}: ref ${it.ref} is level ${ex.level}; the pool exercises of M1-M3 are level 1-2`);
        else if (ex.verify?.kind !== 'unique' || !Array.isArray(ex.inputs)) bad.push(`${s.id}: ref ${it.ref} is not a unique-solution exercise with inputs`);
      } else {
        const m = ID_RE.exec(it.id || '');
        if (m && `M${m[1]}` !== s.id) bad.push(`${it.id}: id does not match stage ${s.id}`);
        if (byId.has(it.id)) bad.push(`${it.id}: collides with data/math.json`);
        bad.push(...checkItem(it));
      }
    }
  }
  for (const s of data.stages.filter((x) => ['M1', 'M2', 'M3'].includes(x.id))) {
    const n = s.items.filter((x) => !x.ref).length;
    if (n < 8) bad.push(`${s.id}: needs at least 8 new inline items, has ${n}`);
  }
  return bad;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const read = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
  const data = read('ladder-math.json');
  const issues = checkLadder(data, read('math.json'));
  const n = inlineItems(data).length;
  if (issues.length) { console.error(issues.join('\n')); console.error(`verify-ladder-math: ${issues.length} problem(s)`); process.exit(1); }
  console.log(`verify-ladder-math: ${n} inline items re-solved exactly, ${data.stages.reduce((a, s) => a + s.items.filter((x) => x.ref).length, 0)} refs checked, all consistent`);
}

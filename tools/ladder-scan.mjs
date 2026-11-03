// Numeric scan checks for the math ladder stages M4-M6 (verify.kind "scan"). Independent of the page code: its own expression
// evaluator (trig in DEGREES), brute-force root scanning (sign changes, domain edges, tangent minima), interval claims checked by
// dense sampling around every endpoint, parameter cases checked by counting real roots for a grid of parameter values.
//
// verify = { kind: 'scan', domain: {exprs, conds, claim}, checks: [...], parts: ['r1', 'q1+q2', ...] }
// Checks run in order and bind names into one environment that the later checks and every part expression can use:
//   { type:'roots', name:'r', eq, var:'x', range:[lo,hi], env?, count?, stmt? }   binds r1..rk (ascending) and r_count
//   { type:'rejected', eq, squared, var, values:[..] }                              every value solves `squared` but not `eq`
//   { type:'set', name:'s', rels:[..], var, range, claim, stmt? }                  solution set claim "(-inf,-1)U[2,5]U{7}"; binds s1.. (finite ends)
//   { type:'intcount', name:'c', rels:[..], var, from, to }                          binds c = number of integers satisfying all rels
//   { type:'eval', name:'v', expr, env? }                                            binds v
//   { type:'param', eq, var, param, range, prange:[lo,hi], step?, rules:[{when,count}], stmt? }
// `stmt: true` means the statement text must show that equation / those relations (so the scan solves what the student reads).
// Part expressions are evaluated with multi-letter names (r1, q_count); the answers stored in the item must equal them.
const DEG = Math.PI / 180;
const FUNCS = {
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs,
  sin: (d) => Math.sin(d * DEG), cos: (d) => Math.cos(d * DEG), tan: (d) => Math.tan(d * DEG),
};
const fin = Number.isFinite;

function prep(src) {
  return String(src)
    .replace(/[−–]/g, '-').replace(/[·×⋅]/g, '*').replace(/²/g, '^2').replace(/³/g, '^3')
    .replace(/√\(/g, 'sqrt(').replace(/∛\(/g, 'cbrt(')
    .replace(/log_\(([^()]+)\)\(/g, 'log($1;').replace(/log_(\d+(?:\.\d+)?|[a-z])\(/g, 'log($1;')
    .replace(/\|([^|]+)\|/g, 'abs($1)');
}

/** Compiles an expression into (env) => number. multi: identifiers may be longer than one letter and there is no implicit product by name. */
export function compile(src, multi = false) {
  const s = prep(src);
  const re = multi ? /\s*(?:(\d+(?:\.\d+)?)|([a-z][a-z0-9_]*)|(.))/y : /\s*(?:(\d+(?:\.\d+)?)|((?:sqrt|cbrt|abs|sin|cos|tan|log)(?=\()|[a-z])|(.))/y;
  const tk = [];
  let m;
  while (re.lastIndex < s.length && (m = re.exec(s))) {
    if (m[1] !== undefined) tk.push({ t: 'num', v: Number(m[1]) });
    else if (m[2] !== undefined) tk.push({ t: 'name', v: m[2] });
    else if ('+-*/^();'.includes(m[3])) tk.push({ t: m[3] });
    else throw new Error(`bad character "${m[3]}" in "${src}"`);
  }
  let i = 0;
  const peek = () => tk[i] && tk[i].t;
  const take = (t) => { if (peek() !== t) throw new Error(`expected ${t} in "${src}"`); return tk[i++]; };
  const startsAtom = () => peek() === 'num' || peek() === 'name' || peek() === '(';
  function atom() {
    const t = tk[i++];
    if (!t) throw new Error(`unexpected end of "${src}"`);
    if (t.t === 'num') return () => t.v;
    if (t.t === '(') { const e = expr(); take(')'); return e; }
    if (t.t === 'name') {
      if (t.v === 'log') { take('('); const b = expr(); take(';'); const e = expr(); take(')'); return (env) => { const B = b(env), X = e(env); return B > 0 && B !== 1 && X > 0 ? Math.log(X) / Math.log(B) : NaN; }; }
      if (FUNCS[t.v]) { take('('); const e = expr(); take(')'); const f = FUNCS[t.v]; return (env) => f(e(env)); }
      return (env) => { if (!(t.v in env)) throw new Error(`unknown name ${t.v} in "${src}"`); return env[t.v]; };
    }
    throw new Error(`unexpected ${t.t} in "${src}"`);
  }
  function power() { const b = atom(); if (peek() === '^') { i++; const e = unary(); return (env) => Math.pow(b(env), e(env)); } return b; }
  function unary() { if (peek() === '-') { i++; const e = unary(); return (env) => -e(env); } if (peek() === '+') { i++; return unary(); } return power(); }
  function term() {
    let l = unary();
    for (;;) {
      if (peek() === '*' || peek() === '/') { const op = tk[i++].t; const r = unary(); const a = l; l = op === '*' ? (e) => a(e) * r(e) : (e) => a(e) / r(e); }
      else if (!multi && startsAtom()) { const r = power(); const a = l; l = (e) => a(e) * r(e); }
      else return l;
    }
  }
  function expr() {
    let l = term();
    while (peek() === '+' || peek() === '-') { const op = tk[i++].t; const r = term(); const a = l; l = op === '+' ? (e) => a(e) + r(e) : (e) => a(e) - r(e); }
    return l;
  }
  const f = expr();
  if (i !== tk.length) throw new Error(`trailing input in "${src}"`);
  return f;
}

/** "a = b", "a <= b <= c" (also ≤ ≥ and &lt; &gt;): { sides, ops }. */
export function parseRel(str) {
  const parts = String(str).replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/&lt;/g, '<').replace(/&gt;/g, '>').split(/(<=|>=|<|>|=)/);
  const sides = [], ops = [];
  parts.forEach((x, k) => { if (k % 2) ops.push(x); else sides.push(compile(x)); });
  if (!ops.length) throw new Error(`no relation in "${str}"`);
  return { sides, ops };
}
/** Relation chain at env; undefined / infinite sides make it false. */
export function holds(rel, env) {
  const v = rel.sides.map((f) => f(env));
  if (!v.every(fin)) return false;
  return rel.ops.every((op, k) => {
    const a = v[k], b = v[k + 1], tol = 1e-10 * (1 + Math.abs(a) + Math.abs(b));
    if (op === '=') return Math.abs(a - b) <= tol;
    if (op === '<=') return a <= b + tol;
    if (op === '>=') return a >= b - tol;
    if (op === '<') return a < b - tol;
    return a > b + tol;
  });
}

/* ---------- interval claims ---------- */
const endpoint = (s) => { const t = s.trim().replace(/[−–]/g, '-'); if (/^-?(inf|oo|∞)$/i.test(t)) return t.startsWith('-') ? -Infinity : Infinity; const v = Number(t); if (!fin(v)) throw new Error(`bad endpoint ${s}`); return v; };
/** "(-inf,-1)U[2,5]U{7}" -> [{ lo, hi, loC, hiC }] */
export function parseClaim(src) {
  return String(src).split('U').map((p) => {
    const t = p.trim();
    const pt = /^\{(.+)\}$/.exec(t);
    if (pt) { const a = endpoint(pt[1]); return { lo: a, hi: a, loC: true, hiC: true }; }
    const m = /^([(\[])(.+),(.+)([)\]])$/.exec(t);
    if (!m) throw new Error(`bad interval "${p}"`);
    const lo = endpoint(m[2]), hi = endpoint(m[3]);
    if (!(lo < hi)) throw new Error(`empty interval "${p}"`);
    return { lo, hi, loC: m[1] === '[', hiC: m[4] === ']' };
  });
}
const inClaim = (c, x) => c.some((p) => (x > p.lo || (p.loC && x === p.lo)) && (x < p.hi || (p.hiC && x === p.hi)));
const claimEnds = (c) => [...new Set(c.flatMap((p) => [p.lo, p.hi]).filter(fin))].sort((a, b) => a - b);

/** Mismatches between pred(x) and membership in the claim, over a dense grid, small integers/halves and every endpoint's neighbourhood. */
function compareSet(pred, claim, lo, hi) {
  const pts = [];
  const N = 60000;
  for (let k = 0; k <= N; k++) pts.push(lo + 0.00123456 + (k * (hi - lo)) / N);
  for (let k = Math.ceil(lo * 4); k <= Math.floor(hi * 4); k++) pts.push(k / 4);
  for (const e of claimEnds(claim)) for (const d of [0, 1e-4, -1e-4, 1e-3, -1e-3, 0.01, -0.01, 0.1, -0.1]) pts.push(e + d);
  const bad = [];
  for (const x of pts) if (pred(x) !== inClaim(claim, x)) { bad.push(x); if (bad.length >= 3) break; }
  return bad;
}

/* ---------- root scanning ---------- */
function bisect(f, a, b) {
  let fa = f(a);
  for (let k = 0; k < 100; k++) { const m = (a + b) / 2, fm = f(m); if (fm === 0) return m; if ((fa < 0) === (fm < 0)) { a = m; fa = fm; } else b = m; }
  return (a + b) / 2;
}
function edgeOf(def, d, u) { for (let k = 0; k < 80; k++) { const m = (d + u) / 2; if (def(m)) d = m; else u = m; } return d; }
/** Real zeros of f on [lo, hi]: sign changes (poles rejected), zeros on a domain edge, tangent touches. */
export function scanRoots(f, lo, hi, step = 0.002) {
  const out = [];
  const add = (r) => { if (!out.some((q) => Math.abs(q - r) < 1e-6)) out.push(r); };
  const def = (x) => fin(f(x));
  const N = Math.round((hi - lo) / step);
  let x0 = null, v0 = NaN, x1 = null, v1 = NaN;
  for (let k = 0; k <= N; k++) {
    const x = lo + 0.000731 + k * step;
    const v = f(x);
    if (x1 !== null) {
      const d1 = fin(v1), d = fin(v);
      if (d1 && d) {
        if (v1 === 0) add(x1);
        else if ((v1 < 0) !== (v < 0) && v !== 0) { const r = bisect(f, x1, x); if (Math.abs(f(r)) < 1e-6) add(r); }
        else if (fin(v0) && Math.abs(v1) < Math.abs(v0) && Math.abs(v1) <= Math.abs(v) && Math.abs(v1) < 1e-3 && (v0 < 0) === (v < 0)) {
          let a = x0, b = x;
          for (let j = 0; j < 120; j++) { const m1 = a + (b - a) / 3, m2 = b - (b - a) / 3; if (Math.abs(f(m1)) < Math.abs(f(m2))) b = m2; else a = m1; }
          const r = (a + b) / 2;
          if (Math.abs(f(r)) < 1e-9) add(r);
        }
      } else if (d1 !== d) {
        const e = d1 ? edgeOf(def, x1, x) : edgeOf(def, x, x1);
        if (Math.abs(f(e)) < 1e-6) add(e);
      }
    }
    x0 = x1; v0 = v1; x1 = x; v1 = v;
  }
  return out.sort((a, b) => a - b);
}

/** Display normalisation shared with the statement check: tags, spaces, products and sign glyphs removed. */
export const normShow = (s) => String(s).replace(/<sub>([^<]*)<\/sub>/g, '_$1').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/≤/g, '<=').replace(/≥/g, '>=')
  .replace(/[−–]/g, '-').replace(/²/g, '^2').replace(/³/g, '^3').replace(/[\s*·×⁦⁧⁩]/g, '');

const relsEnv = (env, bind) => ({ ...env, ...bind });
const num = (v, env, bind) => (typeof v === 'number' ? v : relsEnv(env, bind)[v]);

/**
 * Runs the checks of one item. Returns { env, errors } where env holds every binding. `statement` (item text) is used by stmt checks.
 */
export function runScan(verify, statement) {
  const errors = [];
  const bind = {};
  const stmt = normShow(statement);
  const needShown = (c, texts) => { if (c.stmt) for (const t of texts) if (!stmt.includes(normShow(t))) errors.push(`statement does not show "${t}"`); };
  const envFor = (c) => Object.fromEntries(Object.entries(c.env || {}).map(([k, v]) => [k, num(v, {}, bind)]));
  const fOf = (eq, varName, env) => { const r = parseRel(eq); return { r, f: (x) => r.sides[0]({ ...env, [varName]: x }) - r.sides[1]({ ...env, [varName]: x }) }; };

  if (verify.domain) {
    try {
      const d = verify.domain;
      const v = d.var || 'x';
      const exprs = (d.exprs || []).map((e) => compile(e));
      const conds = (d.conds || []).map(parseRel);
      const claim = parseClaim(d.claim);
      const pred = (x) => exprs.every((f) => fin(f({ ...(d.env || {}), [v]: x }))) && conds.every((r) => holds(r, { ...(d.env || {}), [v]: x }));
      const bad = compareSet(pred, claim, d.range ? d.range[0] : -40, d.range ? d.range[1] : 40);
      if (bad.length) errors.push(`domain claim ${d.claim} differs from the real domain at ${v} = ${bad.join(', ')}`);
      claimEnds(claim).forEach((e, j) => { bind[`d${j + 1}`] = e; });
      bind.d_count = claimEnds(claim).length;
    } catch (e) { errors.push(`domain: ${e.message}`); }
  } else errors.push('verify.domain is required');

  (verify.checks || []).forEach((c, k) => {
    try {
      const at = `check ${k + 1} (${c.type})`;
      const say = (m) => errors.push(`${at}: ${m}`);
      for (const t of c.show || []) if (!stmt.includes(normShow(t))) say(`statement does not show "${t}"`);
      if (c.type === 'roots') {
        const { f } = fOf(c.eq, c.var, envFor(c));
        needShown(c, [c.eq]);
        const [lo, hi] = c.range || [-60, 60];
        const roots = scanRoots(f, lo, hi);
        if (c.count !== undefined && roots.length !== c.count) say(`"${c.eq}" has ${roots.length} root(s) [${roots.map((x) => +x.toFixed(9)).join(', ')}], check says ${c.count}`);
        roots.forEach((r, j) => { bind[`${c.name}${j + 1}`] = r; });
        bind[`${c.name}_count`] = roots.length;
      } else if (c.type === 'rejected') {
        const o = fOf(c.eq, c.var, {}), s = fOf(c.squared, c.var, {});
        for (const v of c.values) {
          if (!(Math.abs(s.f(v)) < 1e-9)) say(`${v} does not solve the squared equation ${c.squared}`);
          if (fin(o.f(v)) && Math.abs(o.f(v)) < 1e-9) say(`${v} is a real solution of the original equation, it is not rejected`);
        }
      } else if (c.type === 'set') {
        const rels = c.rels.map(parseRel);
        needShown(c, c.rels);
        const claim = parseClaim(c.claim);
        const env = envFor(c);
        const [lo, hi] = c.range || [-40, 40];
        const bad = compareSet((x) => rels.every((r) => holds(r, { ...env, [c.var]: x })), claim, lo, hi);
        if (bad.length) say(`claimed set ${c.claim} differs from the real solution set at x = ${bad.join(', ')}`);
        claimEnds(claim).forEach((e, j) => { bind[`${c.name}${j + 1}`] = e; });
        bind[`${c.name}_count`] = claimEnds(claim).length;
      } else if (c.type === 'intcount') {
        const rels = c.rels.map(parseRel);
        let n = 0, min = NaN;
        for (let x = c.from; x <= c.to; x++) if (rels.every((r) => holds(r, { [c.var]: x }))) { n++; if (Number.isNaN(min)) min = x; }
        bind[c.name] = n;
        bind[`${c.name}_min`] = min;
      } else if (c.type === 'eval') {
        const env = { ...bind, ...envFor(c) };
        const v = compile(c.expr, true)(env); // explicit "*" here: names like r1 and q_count are allowed
        if (!fin(v)) say(`"${c.expr}" is not finite`);
        if (c.expect !== undefined && Math.abs(v - c.expect) > 1e-9 * (1 + Math.abs(v))) say(`"${c.expr}" is ${v}, expected ${c.expect}`);
        bind[c.name] = v;
      } else if (c.type === 'intparam') {
        const { r } = fOf(c.eq, c.var, {});
        const [lo, hi] = c.range || [-100, 100];
        let n = 0;
        for (let m = c.from; m <= c.to; m++) {
          const cnt = scanRoots((x) => r.sides[0]({ [c.var]: x, [c.param]: m }) - r.sides[1]({ [c.var]: x, [c.param]: m }), lo, hi, c.xstep || 0.002).length;
          if (cnt === c.count) n++;
        }
        bind[c.name] = n;
      } else if (c.type === 'param') {
        const { r } = fOf(c.eq, c.var, {});
        needShown(c, [c.eq]);
        const [lo, hi] = c.range || [-100, 100];
        const [plo, phi] = c.prange || [-10, 10];
        const step = c.step || 0.25;
        const rules = c.rules.map((q) => ({ rel: parseRel(q.when), count: q.count, when: q.when }));
        const bad = [];
        for (let m = plo; m <= phi + 1e-9; m += step) {
          const pm = Math.round(m * 1e6) / 1e6;
          const cnt = scanRoots((x) => r.sides[0]({ [c.var]: x, [c.param]: pm }) - r.sides[1]({ [c.var]: x, [c.param]: pm }), lo, hi, c.xstep || 0.002).length;
          const hit = rules.filter((q) => holds(q.rel, { [c.param]: pm }));
          if (hit.length !== 1) { bad.push(`${c.param}=${pm}: ${hit.length} rules apply`); continue; }
          if (hit[0].count !== cnt) bad.push(`${c.param}=${pm}: ${cnt} solution(s), rule "${hit[0].when}" says ${hit[0].count}`);
          if (bad.length >= 3) break;
        }
        if (bad.length) say(bad.join('; '));
      } else say(`unknown check type ${c.type}`);
    } catch (e) { errors.push(`check ${k + 1}: ${e.message}`); }
  });
  return { env: bind, errors };
}

/** Value of a part expression in the bindings. */
export function partValue(expr, env) { return compile(expr, true)(env); }

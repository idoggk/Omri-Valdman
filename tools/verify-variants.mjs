// Independent verifier for js/variants.js. Shares NO solving code with the generator:
//  - parses the equations back out of the printed statement (not from the generator's internals)
//  - exact BigInt rational Gaussian elimination for linear systems
//  - exact quadratic along the solution line + brute-force hundredths grid for finite quadratic systems
//  - independent physics recomputation (energy / relative motion / bisection)
// Usage: node tools/verify-variants.mjs [--seeds N] [--template id] [--start S]
import { fileURLToPath } from 'node:url';
import { generate, listTemplates } from '../js/variants.js';

// ---------- exact rationals ----------
const babs = (a) => (a < 0n ? -a : a);
const bgcd = (a, b) => { a = babs(a); b = babs(b); while (b) [a, b] = [b, a % b]; return a; };
class F {
  constructor(n, d = 1n) {
    if (d === 0n) throw new Error('zero denominator');
    if (d < 0n) { n = -n; d = -d; }
    const g = bgcd(n, d) || 1n;
    this.n = n / g; this.d = d / g;
  }
  add(o) { return new F(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o) { return new F(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o) { return new F(this.n * o.n, this.d * o.d); }
  div(o) { return new F(this.n * o.d, this.d * o.n); }
  neg() { return new F(-this.n, this.d); }
  zero() { return this.n === 0n; }
  eq(o) { return this.n === o.n && this.d === o.d; }
  toString() { return this.d === 1n ? `${this.n}` : `${this.n}/${this.d}`; }
}
const F0 = new F(0n);
const F1 = new F(1n);
export function fromDecimal(s) {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(s).trim());
  if (!m) throw new Error(`bad decimal ${s}`);
  const frac = m[3] || '';
  const n = BigInt(m[2] + frac) * (m[1] ? -1n : 1n);
  return new F(n, 10n ** BigInt(frac.length));
}
const finiteWithin2 = (x) => (100n % x.d) === 0n;

// ---------- parsing printed equations ----------
const VARS = ['x', 'y', 'z', 'w'];
// polynomial: Map<monomialKey, F>; key = exponents of x,y,z,w joined by ','
const mono = (e) => e.join(',');
const polyConst = (c) => new Map(c.zero() ? [] : [['0,0,0,0', c]]);
const polyVar = (i) => { const e = [0, 0, 0, 0]; e[i] = 1; return new Map([[mono(e), F1]]); };
const padd = (a, b, sign = 1) => {
  const out = new Map(a);
  for (const [k, v] of b) {
    const nv = (out.get(k) || F0).add(sign === 1 ? v : v.neg());
    if (nv.zero()) out.delete(k); else out.set(k, nv);
  }
  return out;
};
const pmul = (a, b) => {
  let out = new Map();
  for (const [k1, v1] of a) {
    for (const [k2, v2] of b) {
      const e = k1.split(',').map((x, i) => Number(x) + Number(k2.split(',')[i]));
      out = padd(out, new Map([[mono(e), v1.mul(v2)]]));
    }
  }
  return out;
};
const pdeg = (p) => Math.max(0, ...[...p.keys()].map((k) => k.split(',').reduce((s, x) => s + Number(x), 0)));

function plain(s) {
  return s.replace(/<sup>(\d+)<\/sup>/g, '^$1').replace(/<[^>]*>/g, '').replace(/[−‒–—]/g, '-');
}
function parsePoly(text) {
  const s = plain(text);
  const toks = [];
  const re = /\s*(\d+(?:\.\d+)?|[xyzw]|[-+*^()=])/gy;
  let m;
  let pos = 0;
  while ((m = re.exec(s))) { toks.push(m[1]); pos = re.lastIndex; }
  if (s.slice(pos).trim()) throw new Error(`cannot tokenize "${s}"`);
  let i = 0;
  const peek = () => toks[i];
  const expr = () => {
    let v = term();
    while (peek() === '+' || peek() === '-') { const op = toks[i++]; v = padd(v, term(), op === '+' ? 1 : -1); }
    return v;
  };
  const term = () => {
    let v = unary();
    for (;;) {
      const t = peek();
      if (t === '*') { i++; v = pmul(v, unary()); }
      else if (t !== undefined && (t === '(' || /^[xyzw]$/.test(t) || /^\d/.test(t))) v = pmul(v, unary());
      else return v;
    }
  };
  const unary = () => {
    if (peek() === '-') { i++; return padd(new Map(), unary(), -1); }
    if (peek() === '+') { i++; return unary(); }
    return power();
  };
  const power = () => {
    let b = base();
    if (peek() === '^') { i++; const e = Number(toks[i++]); let r = polyConst(F1); for (let k = 0; k < e; k++) r = pmul(r, b); b = r; }
    return b;
  };
  const base = () => {
    const t = toks[i++];
    if (t === undefined) throw new Error('unexpected end');
    if (t === '(') { const v = expr(); if (toks[i++] !== ')') throw new Error('missing )'); return v; }
    if (/^[xyzw]$/.test(t)) return polyVar(VARS.indexOf(t));
    if (/^\d/.test(t)) return polyConst(fromDecimal(t));
    throw new Error(`unexpected ${t}`);
  };
  const lhs = expr();
  if (toks[i++] !== '=') throw new Error('no =');
  const rhs = expr();
  if (i !== toks.length) throw new Error('trailing tokens');
  return padd(lhs, rhs, -1); // lhs - rhs = 0
}
// equation lines of a statement: <span dir="ltr">…=…</span> alone between <br>
export function statementEquations(statement) {
  return statement.split('<br>').map((l) => l.trim()).filter((l) => /^<span dir="ltr">[^<]*(<sup>\d<\/sup>[^<]*)*<\/span>$/.test(l) && l.includes('='));
}

// ---------- exact linear algebra ----------
function eliminate(rows, nv) {
  const M = rows.map((r) => r.slice());
  const pivots = [];
  let r = 0;
  for (let c = 0; c < nv && r < M.length; c++) {
    let p = -1;
    for (let i = r; i < M.length; i++) if (!M[i][c].zero()) { p = i; break; }
    if (p < 0) continue;
    [M[r], M[p]] = [M[p], M[r]];
    const inv = M[r][c];
    M[r] = M[r].map((x) => x.div(inv));
    for (let i = 0; i < M.length; i++) {
      if (i === r || M[i][c].zero()) continue;
      const f = M[i][c];
      M[i] = M[i].map((x, j) => x.sub(f.mul(M[r][j])));
    }
    pivots.push(c);
    r++;
  }
  const inconsistent = M.some((row) => row.slice(0, nv).every((x) => x.zero()) && !row[nv].zero());
  return { M, pivots, inconsistent };
}
function linRows(polys, nv) {
  return polys.map((p) => {
    const row = new Array(nv + 1).fill(F0);
    for (const [k, v] of p) {
      const e = k.split(',').map(Number);
      const deg = e.reduce((s, x) => s + x, 0);
      if (deg === 0) row[nv] = v.neg();
      else if (deg === 1) row[e.indexOf(1)] = v;
      else throw new Error('not linear');
    }
    return row;
  });
}
function det(M) {
  const n = M.length;
  const A = M.map((r) => r.slice());
  let d = F1;
  for (let c = 0; c < n; c++) {
    let p = -1;
    for (let i = c; i < n; i++) if (!A[i][c].zero()) { p = i; break; }
    if (p < 0) return F0;
    if (p !== c) { [A[c], A[p]] = [A[p], A[c]]; d = d.neg(); }
    d = d.mul(A[c][c]);
    for (let i = c + 1; i < n; i++) {
      const f = A[i][c].div(A[c][c]);
      A[i] = A[i].map((x, j) => x.sub(f.mul(A[c][j])));
    }
  }
  return d;
}
const linKind = (polys, nv) => {
  const { M, pivots, inconsistent } = eliminate(linRows(polys, nv), nv);
  if (inconsistent) return { kind: 'none' };
  if (pivots.length < nv) return { kind: 'infinite' };
  return { kind: 'unique', sol: pivots.map((c, i) => M[i][nv]) };
};

// ---------- exercise checks ----------
const HEB = /[֐-׿]/;
const decRe = /^-?\d+(\.\d{1,2})?$/;
const numsIn = (s) => [...plain(s).matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));

export function tipLeaks(ex) {
  const answers = new Set();
  for (const i of ex.inputs || []) answers.add(Math.abs(Number(i.answer)));
  for (const s of (ex.answerSets && ex.answerSets.sets) || []) for (const x of s) answers.add(Math.abs(Number(x)));
  const inStatement = new Set(numsIn(ex.statement || ''));
  const out = [];
  (ex.tips || []).forEach((t, i) => { for (const v of numsIn(t)) if (answers.has(v) && !inStatement.has(v)) out.push(`tip ${i + 1} leaks ${v}`); });
  return out;
}

function commonChecks(ex, tplId, seed, errs) {
  const topics = { 'math-3': 1, 'math-4': 1, 'phys-vertical': 1, 'phys-horizontal': 1 };
  if (ex.id !== `var-${tplId}-${seed}`) errs.push(`bad id ${ex.id}`);
  if (!topics[ex.topic]) errs.push(`bad topic ${ex.topic}`);
  if (![1, 2, 3].includes(ex.level)) errs.push('bad level');
  for (const f of ['title', 'statement']) if (typeof ex[f] !== 'string' || !HEB.test(ex[f])) errs.push(`${f} missing Hebrew`);
  if (!Array.isArray(ex.tips) || ex.tips.length !== 3 || ex.tips.some((t) => typeof t !== 'string' || !HEB.test(t))) errs.push('tips must be 3 Hebrew strings');
  if (!Array.isArray(ex.solution) || ex.solution.length < 3 || ex.solution.some((t) => typeof t !== 'string' || !HEB.test(t))) errs.push('solution must be >=3 Hebrew strings');
  const hasIn = Array.isArray(ex.inputs);
  const hasSets = !!ex.answerSets;
  if (hasIn === hasSets) errs.push('need exactly one of inputs / answerSets');
  if (hasIn) {
    if (!ex.inputs.length) errs.push('no inputs');
    for (const i of ex.inputs) {
      if (!decRe.test(String(i.answer))) errs.push(`answer not a <=2 decimal: ${i.answer}`);
      if (!(i.tolerance > 0) || !i.label) errs.push('bad input meta');
    }
  }
  if (hasSets) {
    const a = ex.answerSets;
    if (!a.sets.length || a.count !== a.sets.length || a.count > 6) errs.push('answerSets count mismatch');
    for (const s of a.sets) {
      if (s.length !== a.labels.length) errs.push('answerSets row length');
      for (const x of s) if (!decRe.test(String(x))) errs.push(`set value not a <=2 decimal: ${x}`);
    }
    if (new Set(a.sets.map((s) => s.join('|'))).size !== a.sets.length) errs.push('duplicate solution sets');
  }
  errs.push(...tipLeaks(ex));
  // every final answer must be visible in the worked solution
  const soln = new Set(numsIn(ex.solution.join(' ')));
  const answers = hasIn ? ex.inputs.map((i) => i.answer) : (ex.answerSets ? ex.answerSets.sets.flat() : []);
  for (const a of answers) if (decRe.test(String(a)) && !soln.has(Math.abs(Number(a)))) errs.push(`answer ${a} absent from solution text`);
}

const answerFracs = (ex) => ex.inputs.map((i) => fromDecimal(i.answer));
const sameFrac = (a, b) => a.length === b.length && a.every((x, i) => x.eq(b[i]));

function nice(polys, errs, cmax = 99, rmax = 999) {
  for (const p of polys) {
    for (const [k, v] of p) {
      const big = k === '0,0,0,0' ? rmax : cmax;
      if (babs(v.n) > BigInt(big) * v.d) errs.push(`coefficient too large ${v}`);
    }
  }
}

function verifyLinear(ex, nv, errs) {
  const lines = statementEquations(ex.statement);
  if (lines.length !== nv) { errs.push(`expected ${nv} equations, found ${lines.length}`); return; }
  const polys = lines.map(parsePoly);
  if (polys.some((p) => pdeg(p) !== 1)) { errs.push('non-linear equation in linear template'); return; }
  nice(polys, errs, 30, 600);
  const r = linKind(polys, nv);
  if (r.kind !== 'unique') { errs.push(`system is ${r.kind}`); return; }
  if (ex.inputs.length !== nv) errs.push('input count mismatch');
  else if (!sameFrac(answerFracs(ex), r.sol)) errs.push(`answers ${ex.inputs.map((i) => i.answer)} != exact solution ${r.sol.map(String)}`);
  if (r.sol.some((x) => !finiteWithin2(x))) errs.push('exact solution has more than 2 decimals');
}

// one quadratic + (nv-1) linear equations; exact quadratic on the solution line + grid scan
function verifyQuadLine(ex, nv, errs) {
  const lines = statementEquations(ex.statement);
  if (lines.length !== nv) { errs.push(`expected ${nv} equations, found ${lines.length}`); return; }
  const polys = lines.map(parsePoly);
  const quad = polys.filter((p) => pdeg(p) === 2);
  const lin = polys.filter((p) => pdeg(p) === 1);
  if (quad.length !== 1 || lin.length !== nv - 1) { errs.push('expected 1 quadratic + linear equations'); return; }
  nice(polys, errs, 30, 600);
  const { M, pivots, inconsistent } = eliminate(linRows(lin, nv), nv);
  if (inconsistent || pivots.length !== nv - 1) { errs.push('linear part not of rank n-1'); return; }
  const f = [...Array(nv).keys()].find((c) => !pivots.includes(c));
  // var_i(t) = a_i + b_i t
  const aff = new Array(nv);
  aff[f] = [F0, F1];
  pivots.forEach((c, r) => { aff[c] = [M[r][nv], M[r][f].neg()]; });
  // quadratic coefficients c0 + c1 t + c2 t^2
  const cc = [F0, F0, F0];
  for (const [k, v] of quad[0]) {
    const e = k.split(',').map(Number);
    let poly = [v];
    e.forEach((pw, i) => {
      for (let j = 0; j < pw; j++) {
        const next = new Array(poly.length + 1).fill(F0);
        poly.forEach((x, d) => { next[d] = next[d].add(x.mul(aff[i][0])); next[d + 1] = next[d + 1].add(x.mul(aff[i][1])); });
        poly = next;
      }
    });
    poly.forEach((x, d) => { cc[d] = cc[d].add(x); });
  }
  // scale to integers
  let lcm = 1n;
  for (const x of cc) lcm = (lcm / bgcd(lcm, x.d)) * x.d;
  const C = cc.map((x) => (x.n * lcm) / x.d);
  if (C[2] === 0n) { errs.push('degenerate: quadratic collapses to linear'); return; }
  const disc = C[1] * C[1] - 4n * C[2] * C[0];
  const expectCount = disc > 0n ? 2 : disc === 0n ? 1 : 0;
  // brute force over hundredths of the free variable
  const found = [];
  for (let k = -3000n; k <= 3000n; k++) {
    if (C[2] * k * k + C[1] * k * 100n + C[0] * 10000n === 0n * 1n) found.push(new F(k, 100n));
  }
  // C[2]*t^2 + C[1]*t + C[0] = 0 with t = k/100  <=>  C2 k^2 + 100 C1 k + 10^4 C0 = 0
  if (found.length !== expectCount) errs.push(`grid found ${found.length} roots but discriminant says ${expectCount} (off-grid or missing roots)`);
  const pts = found.map((t) => aff.map((a) => a[0].add(a[1].mul(t))));
  // direct exact re-substitution into the original polynomials
  const evalPoly = (p, pt) => {
    let s = F0;
    for (const [k, v] of p) {
      let term = v;
      k.split(',').forEach((e, i) => { for (let j = 0; j < Number(e); j++) term = term.mul(pt[i]); });
      s = s.add(term);
    }
    return s;
  };
  for (const pt of pts) for (const p of polys) if (!evalPoly(p, pt).zero()) errs.push('internal: grid point fails an equation');
  if (pts.some((pt) => pt.some((x) => !finiteWithin2(x)))) errs.push('solution coordinate has more than 2 decimals');
  compareSets(ex, pts, nv, errs);
}

function compareSets(ex, pts, nv, errs) {
  const a = ex.answerSets;
  if (!a) return;
  if (a.labels.length !== nv) errs.push('label count mismatch');
  const claimed = a.sets.map((s) => s.map(fromDecimal));
  if (claimed.length !== pts.length) errs.push(`answerSets has ${claimed.length} sets, exact solver found ${pts.length}`);
  const key = (p) => p.map(String).join('|');
  const have = new Set(pts.map(key));
  for (const c of claimed) if (!have.has(key(c))) errs.push(`claimed set (${c.map(String)}) is not a solution`);
  const mine = new Set(claimed.map(key));
  for (const p of pts) if (!mine.has(key(p))) errs.push(`missing solution (${p.map(String)})`);
}

function verifyCyclicProduct(ex, errs) {
  const lines = statementEquations(ex.statement);
  if (lines.length !== 3) { errs.push('expected 3 equations'); return; }
  const polys = lines.map(parsePoly);
  // linearize on the monomials xy, yz, xz
  const cols = ['1,1,0,0', '0,1,1,0', '1,0,1,0'];
  const rows = polys.map((p) => {
    const row = new Array(4).fill(F0);
    for (const [k, v] of p) {
      const ix = cols.indexOf(k);
      if (ix >= 0) row[ix] = v; else if (k === '0,0,0,0') row[3] = v.neg(); else throw new Error(`unexpected monomial ${k}`);
    }
    return row;
  });
  const r = eliminate(rows, 3);
  if (r.inconsistent || r.pivots.length !== 3) { errs.push('monomial system is not uniquely solvable'); return; }
  const [pxy, pyz, pxz] = r.M.map((row) => row[3]);
  if (pxy.zero() || pyz.zero() || pxz.zero()) errs.push('degenerate: a product is zero');
  const pts = [];
  for (let k = -6000n; k <= 6000n; k++) {
    if (k === 0n) continue;
    const x = new F(k, 100n);
    const y = pxy.div(x);
    const z = pxz.div(x);
    if (y.mul(z).eq(pyz)) pts.push([x, y, z]);
  }
  // x = 0 cannot work since xy would be 0; both signs of xyz^2 give exactly two points when the products are consistent
  for (const pt of pts) for (const p of polys) {
    let s = F0;
    for (const [k, v] of p) { let t = v; k.split(',').forEach((e, i) => { for (let j = 0; j < Number(e); j++) t = t.mul(pt[i]); }); s = s.add(t); }
    if (!s.zero()) errs.push('internal: point fails equation');
  }
  // completeness: (xyz)^2 = pxy*pyz*pxz must be a perfect rational square => exactly 2 real solutions
  const sqProd = pxy.mul(pyz).mul(pxz);
  if (sqProd.n <= 0n) errs.push('no real solution');
  if (pts.length !== 2) errs.push(`grid found ${pts.length} solutions, expected 2`);
  compareSets(ex, pts, 3, errs);
}

function verifyParam(ex, errs) {
  const lines = statementEquations(ex.statement);
  if (lines.length !== 3) { errs.push('expected 3 equations'); return; }
  const wantNone = /אין למערכת פתרון/.test(ex.statement);
  const wantInf = /אינסוף פתרונות/.test(ex.statement);
  if (wantNone === wantInf) { errs.push('cannot tell which kind is asked'); return; }
  if (ex.verify && ex.verify.kind !== (wantNone ? 'none' : 'infinite')) errs.push('verify.kind disagrees with the question');
  if (!ex.inputs || ex.inputs.length !== 1 || ex.inputs[0].label !== 'k') { errs.push('param exercise needs one input k'); return; }
  const kClaim = fromDecimal(ex.inputs[0].answer);
  const at = (k) => lines.map((l) => parsePoly(plain(l).replace(/k/g, `(${k})`)));
  const strK = (k) => (k.d === 1n ? `${k.n}` : null);
  // determinant is linear in k: D(k) = D0 + k*slope, root must be the claimed k
  const dets = [0n, 1n, 2n].map((k) => det(linRows(at(String(k)), 3).map((r) => r.slice(0, 3))));
  const s1 = dets[1].sub(dets[0]);
  const s2 = dets[2].sub(dets[1]);
  if (!s1.eq(s2)) errs.push('determinant not linear in k');
  if (s1.zero()) { errs.push('determinant independent of k'); return; }
  const root = dets[0].neg().div(s1);
  if (!root.eq(kClaim)) errs.push(`determinant root ${root} != claimed k ${kClaim}`);
  const ks = strK(kClaim);
  if (ks === null) { errs.push('k not integer'); return; }
  const atK = linKind(at(ks), 3);
  if (atK.kind !== (wantNone ? 'none' : 'infinite')) errs.push(`at claimed k system is ${atK.kind}`);
  for (const dk of [-2n, -1n, 1n, 2n]) {
    if (linKind(at(String(kClaim.n + dk)), 3).kind !== 'unique') errs.push(`k=${kClaim.n + dk} is not unique`);
  }
}

// ----- physics: independent recomputation (g = 10) -----
const near = (a, b) => Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const physModels = {
  'throw-up': ({ H, v0 }) => {
    const vimp = Math.sqrt(v0 * v0 + 2 * 10 * H); // energy conservation
    return [v0 / 10, H + (v0 * v0) / 20, (v0 + vimp) / 10, vimp];
  },
  'nth-second': ({ d }) => {
    const n = (d + 5) / 10; // d = g(n - 1/2)
    return [n, 0.5 * 10 * n * n, 10 * n, d - 10];
  },
  horizontal: ({ H, v0 }) => {
    const T = Math.sqrt((2 * H) / 10);
    const vy = 10 * T;
    const out = [T, v0 * T, Math.hypot(v0, vy)];
    const tan = vy / v0;
    if (near(Math.round(tan * 100) / 100, tan)) out.push(tan);
    return out;
  },
  'horizontal-45': ({ H, v0 }) => {
    const T = Math.sqrt((2 * H) / 10);
    return [T, v0 * T, 10 * T, (Math.atan((10 * T) / v0) * 180) / Math.PI];
  },
  'horizontal-range': ({ H, R }) => {
    const T = Math.sqrt((2 * H) / 10);
    const v0 = R / T;
    const vy = 10 * T;
    const out = [T, v0, vy];
    const sp = Math.hypot(v0, vy);
    if (near(Math.round(sp), sp)) out.push(sp);
    return out;
  },
  meeting: ({ H, v0, tau }) => {
    const yA = (t) => H - 5 * t * t;
    const yB = (t) => v0 * (t - tau) - 5 * (t - tau) ** 2;
    let lo = tau;
    let hi = Math.sqrt(H / 5);
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (yA(mid) - yB(mid) > 0) lo = mid; else hi = mid;
    }
    const t = (lo + hi) / 2;
    return [Math.round(t * 1e9) / 1e9, yA(t), 10 * t, v0 - 10 * (t - tau)];
  },
};
function verifyPhysics(ex, errs) {
  const v = ex.verify;
  if (!v || !physModels[v.model]) { errs.push('unknown physics model'); return; }
  const want = physModels[v.model](v.params);
  if (want.length !== ex.inputs.length) { errs.push(`expected ${want.length} answers, exercise has ${ex.inputs.length}`); return; }
  want.forEach((w, i) => {
    const got = Number(ex.inputs[i].answer);
    if (Math.abs(w - got) > 1e-6) errs.push(`answer ${i + 1}: exercise says ${got}, recomputation gives ${w}`);
    if (Math.abs(Math.round(w * 100) / 100 - w) > 1e-6) errs.push(`answer ${i + 1} (${w}) has more than 2 decimals`);
  });
  const text = numsIn(ex.statement);
  for (const [k, val] of Object.entries(v.params)) if (!text.some((x) => Math.abs(x - val) < 1e-9) && !(v.model === 'meeting' && k === 'tau' && val === 0)) errs.push(`param ${k}=${val} not in statement`);
  if (!/10/.test(plain(ex.statement))) errs.push('statement must state g = 10');
}

const MATH = {
  'm3-linear-int': (ex, e) => verifyLinear(ex, 3, e),
  'm3-linear-dec': (ex, e) => verifyLinear(ex, 3, e),
  'm4-linear': (ex, e) => verifyLinear(ex, 4, e),
  'm4-cyclic': (ex, e) => verifyLinear(ex, 4, e),
  'm3-quad': (ex, e) => verifyQuadLine(ex, 3, e),
  'm4-quad': (ex, e) => verifyQuadLine(ex, 4, e),
  'm3-cyclic-prod': verifyCyclicProduct,
  'm3-param': verifyParam,
};

export function verifyExercise(ex, tplId, seed) {
  const errs = [];
  try {
    commonChecks(ex, tplId, seed, errs);
    if (MATH[tplId]) MATH[tplId](ex, errs);
    else if (tplId.startsWith('ph-')) verifyPhysics(ex, errs);
    else errs.push(`no verifier for template ${tplId}`);
  } catch (e) {
    errs.push(`verifier error: ${e.message}`);
  }
  return errs;
}

export function verifyTemplate(tplId, count, start = 0) {
  const failures = [];
  const seen = new Set();
  for (let seed = start; seed < start + count; seed++) {
    let ex;
    try { ex = generate(tplId, seed); } catch (e) { failures.push({ seed, errs: [`generate threw: ${e.message}`] }); continue; }
    const again = generate(tplId, seed);
    if (JSON.stringify(ex) !== JSON.stringify(again)) failures.push({ seed, errs: ['not deterministic'] });
    seen.add(ex.statement);
    const errs = verifyExercise(ex, tplId, seed);
    if (errs.length) failures.push({ seed, errs });
  }
  return { tplId, count, distinct: seen.size, failures };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : dflt; };
  const count = Number(arg('--seeds', 2000));
  const only = arg('--template', null);
  const start = Number(arg('--start', 0));
  let bad = 0;
  for (const t of listTemplates()) {
    if (only && t.id !== only) continue;
    const t0 = Date.now();
    const r = verifyTemplate(t.id, count, start);
    bad += r.failures.length;
    console.log(`${r.failures.length ? 'FAIL' : 'ok  '} ${t.id.padEnd(20)} seeds=${count} distinct=${r.distinct} failures=${r.failures.length} (${Date.now() - t0} ms)`);
    for (const f of r.failures.slice(0, 5)) console.log(`   seed ${f.seed}: ${f.errs.join(' | ')}`);
  }
  console.log(bad ? `FAILED: ${bad} bad instances` : 'all templates verified');
  process.exit(bad ? 1 : 0);
}

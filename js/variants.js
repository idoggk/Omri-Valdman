// Unlimited exercise variants: seeded, deterministic generators. Pure logic, no DOM.
// generate(templateId, seed) -> exercise object (same shape as data/*.json) with id 'var-<template>-<seed>'.
// Every answer is a real integer or a finite decimal with at most 2 decimals (instances that fail are resampled).
// Physics uses g = 10. All visible text is Hebrew.

const MINUS = '−';
const LET = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע'];
const lab = (i) => LET[i] ?? String(i + 1);
const L = (s) => `<span dir="ltr">${s}</span>`;

// ---------- seeded PRNG ----------
export function makeRng(seed) {
  let a = (Number(seed) >>> 0) ^ 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ri = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const shuffle = (rng, arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

// ---------- small exact rationals (Number based, values stay tiny) ----------
const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };
class Q {
  constructor(n, d = 1) {
    if (d < 0) { n = -n; d = -d; }
    const g = gcd(n, d) || 1;
    this.n = n / g; this.d = d / g;
  }
  add(o) { return new Q(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o) { return new Q(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o) { return new Q(this.n * o.n, this.d * o.d); }
  div(o) { return new Q(this.n * o.d, this.d * o.n); }
  neg() { return new Q(-this.n, this.d); }
  abs() { return new Q(Math.abs(this.n), this.d); }
  isZero() { return this.n === 0; }
  eq(o) { return this.n === o.n && this.d === o.d; }
  num() { return this.n / this.d; }
}
const q = (n, d = 1) => new Q(n, d);
const cq = (x) => (x instanceof Q ? x : q(x));
const Q0 = q(0);
const Q1 = q(1);

// decimal string (ASCII minus) when finite with <= 2 decimals, else null
function decStr(x) {
  x = cq(x);
  if (100 % x.d !== 0) return null;
  const h = x.n * (100 / x.d);
  const neg = h < 0;
  const a = Math.abs(h);
  const ip = Math.floor(a / 100);
  const fp = a % 100;
  const frac = fp === 0 ? '' : '.' + (fp % 10 === 0 ? String(fp / 10) : String(fp).padStart(2, '0'));
  return (neg ? '-' : '') + ip + frac;
}
const okAnswer = (s) => typeof s === 'string' && /^-?\d+(\.\d{1,2})?$/.test(s) && !/^-0(\.0+)?$/.test(s) && Math.abs(Number(s)) <= 2000;
const show = (x) => {
  x = cq(x);
  const s = decStr(x);
  return (s ?? `${x.n}/${x.d}`).replace('-', MINUS);
};
const showP = (x) => (cq(x).n < 0 ? `(${show(x)})` : show(x));

// ---------- term formatting ----------
// term: { c: number|Q, v: ['x','x'] }  (v = product of variables, empty = constant)
const monoHtml = (v) => {
  const cnt = new Map();
  for (const n of v) cnt.set(n, (cnt.get(n) || 0) + 1);
  return [...cnt].map(([n, k]) => (k === 1 ? n : `${n}<sup>${k}</sup>`)).join('');
};
const monoAscii = (v) => {
  const cnt = new Map();
  for (const n of v) cnt.set(n, (cnt.get(n) || 0) + 1);
  return [...cnt].map(([n, k]) => (k === 1 ? n : `${n}^${k}`)).join('*');
};
function lhsHtml(terms) {
  let s = '';
  for (const t of terms) {
    const c = cq(t.c);
    if (c.isZero()) continue;
    const a = c.abs();
    const m = monoHtml(t.v);
    const body = m === '' ? show(a) : (a.eq(Q1) ? '' : show(a)) + m;
    s += s ? (c.n < 0 ? ' − ' : ' + ') + body : (c.n < 0 ? MINUS : '') + body;
  }
  return s || '0';
}
function lhsAscii(terms) {
  let s = '';
  for (const t of terms) {
    const c = cq(t.c);
    if (c.isZero()) continue;
    const a = c.abs();
    const m = monoAscii(t.v);
    const body = m === '' ? decStr(a) : (a.eq(Q1) ? '' : decStr(a) + '*') + m;
    s += s ? (c.n < 0 ? '-' : '+') + body : (c.n < 0 ? '-' : '') + body;
  }
  return s || '0';
}
const rowTerms = (coefs, vars) => coefs.map((c, i) => ({ c, v: [vars[i]] }));
const eqHtml = (terms, rhs) => L(`${lhsHtml(terms)} = ${show(rhs)}`);
const eqAscii = (terms, rhs) => `${lhsAscii(terms)}=${decStr(rhs)}`;
const intEq = (row, vars) => eqHtml(rowTerms(row.slice(0, -1), vars), q(row[row.length - 1]));

// numeric substitution "2·3 − 3·(−2) + 4·1"
function numLhs(terms, vals) {
  let s = '';
  let total = Q0;
  for (const t of terms) {
    const c = cq(t.c);
    if (c.isZero()) continue;
    const a = c.abs();
    const f = [];
    if (!a.eq(Q1) || t.v.length === 0) f.push(show(a));
    let val = c;
    for (const nm of t.v) { const x = vals[nm]; f.push(showP(x)); val = val.mul(x); }
    total = total.add(val);
    const body = f.join('·');
    s += s ? (c.n < 0 ? ' − ' : ' + ') + body : (c.n < 0 ? MINUS : '') + body;
  }
  return { text: s || '0', total };
}
function checkSpan(eqs, vals) {
  const parts = eqs.map((e) => {
    const r = numLhs(e.terms, vals);
    if (!r.total.eq(e.rhs)) throw new Error('internal check failed');
    return L(`${r.text} = ${show(e.rhs)}`) + ' ✓';
  });
  return parts.join('; ');
}

// ---------- Gaussian elimination with Hebrew steps (integer-preserving) ----------
function gaussSteps(rowsQ, vars) {
  const n = vars.length;
  const steps = [];
  let maxAbs = 0;
  const scaledIdx = [];
  const rows = rowsQ.map((r, i) => {
    let m = 1;
    r.forEach((x) => { m = (m / gcd(m, x.d)) * x.d; });
    if (m !== 1) scaledIdx.push(i);
    return r.map((x) => x.n * (m / x.d));
  });
  const note = (r) => { for (const x of r) maxAbs = Math.max(maxAbs, Math.abs(x)); };
  rows.forEach(note);
  if (scaledIdx.length) {
    steps.push(`נכפול כל משוואה שיש בה שברים או מספרים עשרוניים בכפולה משותפת כדי לקבל מקדמים שלמים: ${scaledIdx.map((i) => `(${lab(i)}) ${intEq(rows[i], vars)}`).join(', ')}.`);
  }
  let act = rows.map((r, i) => ({ r, id: i }));
  let next = n;
  const piv = [];
  for (let c = 0; c < n - 1; c++) {
    let P = null;
    for (const x of act) {
      if (x.r[c] !== 0 && (!P || Math.abs(x.r[c]) < Math.abs(P.r[c]))) P = x;
    }
    if (!P) return null;
    const rest = act.filter((x) => x !== P);
    const nextAct = [];
    for (const R of rest) {
      const a = R.r[c];
      if (a === 0) { nextAct.push(R); continue; }
      const g = gcd(a, P.r[c]);
      let mR = P.r[c] / g;
      let mP = a / g;
      if (mR < 0) { mR = -mR; mP = -mP; }
      let nr = R.r.map((x, j) => mR * x - mP * P.r[j]);
      const gg = nr.reduce((s, x) => gcd(s, x), 0);
      let reduced = false;
      if (gg > 1) { nr = nr.map((x) => x / gg); reduced = true; }
      note(nr);
      const id = next++;
      const mult = [];
      if (mR !== 1) mult.push(`את (${lab(R.id)}) ב־${mR}`);
      if (Math.abs(mP) !== 1) mult.push(`את (${lab(P.id)}) ב־${Math.abs(mP)}`);
      const pre = mult.length ? `נכפול ${mult.join(' ו')}, ואז ` : '';
      const op = mP > 0 ? `נחסר את (${lab(P.id)}) מ־(${lab(R.id)})` : `נחבר את (${lab(P.id)}) אל (${lab(R.id)})`;
      steps.push(`חיסול ${vars[c]}: ${pre}${op}. מתקבל ${intEq(nr, vars)}${reduced ? ` (אחרי צמצום ב־${gg})` : ''} — משוואה (${lab(id)}).`);
      nextAct.push({ r: nr, id });
    }
    piv.push({ P, c });
    act = nextAct;
  }
  const last = act[0];
  if (!last || last.r[n - 1] === 0) return null;
  const val = new Array(n).fill(null);
  val[n - 1] = q(last.r[n], last.r[n - 1]);
  steps.push(`נשארה משוואה (${lab(last.id)}) עם נעלם אחד: ${intEq(last.r, vars)}, ולכן ${L(`${vars[n - 1]} = ${show(val[n - 1])}`)}.`);
  for (let i = piv.length - 1; i >= 0; i--) {
    const { P, c } = piv[i];
    let rhs = q(P.r[n]);
    const bits = [String(P.r[n] < 0 ? `${MINUS}${-P.r[n]}` : P.r[n])];
    for (let j = c + 1; j < n; j++) {
      if (P.r[j] === 0) continue;
      rhs = rhs.sub(q(P.r[j]).mul(val[j]));
      bits.push(`${P.r[j] < 0 ? '+' : '−'} ${Math.abs(P.r[j])}·${showP(val[j])}`);
    }
    val[c] = rhs.div(q(P.r[c]));
    steps.push(`נציב את הערכים שכבר נמצאו ב־(${lab(P.id)}): ${L(`${P.r[c] === 1 ? '' : P.r[c] + '·'}${vars[c]} = ${bits.join(' ')}`)}, ולכן ${L(`${vars[c]} = ${show(val[c])}`)}.`);
  }
  return { steps, sol: val, maxAbs };
}

// ---------- common packaging ----------
const HEB = /[֐-׿]/;
const tol = (a) => Math.max(0.01, +(Math.abs(Number(a)) * 0.01).toFixed(3));
function pack(o) {
  const ex = {
    id: `var-${o.tpl}-${o.seed}`,
    topic: o.topic,
    level: o.level,
    title: o.title,
    statement: o.statement,
  };
  if (o.inputs) ex.inputs = o.inputs.map((i) => ({ label: i.label, unit: i.unit || '', answer: i.answer, tolerance: tol(i.answer) }));
  if (o.sets) ex.answerSets = { labels: o.labels, count: o.sets.length, sets: o.sets, tolerance: 0.01 };
  ex.tips = o.tips;
  ex.solution = o.solution;
  ex.verify = o.verify;
  const answers = ex.inputs ? ex.inputs.map((i) => i.answer) : o.sets.flat();
  if (!answers.every(okAnswer)) return null;
  if (!HEB.test(ex.statement) || !ex.tips.every((t) => HEB.test(t)) || !ex.solution.every((t) => HEB.test(t))) return null;
  return ex;
}

// ---------- math templates ----------
const VARS3 = ['x', 'y', 'z'];
const VARS4 = ['x', 'y', 'z', 'w'];

function sysStatement(intro, eqs) {
  return `${intro}<br>${eqs.map((e) => eqHtml(e.terms, e.rhs)).join('<br>')}`;
}
const mkEq = (coefs, vars, rhs) => ({ terms: rowTerms(coefs, vars), rhs });
const dot = (row, sol) => row.reduce((s, c, i) => s.add(cq(c).mul(sol[i])), Q0);

function linearTemplate(rng, ctx, n, opts) {
  const vars = n === 3 ? VARS3 : VARS4;
  const cmax = opts.coefMax;
  // intended solution
  let sol;
  if (opts.dec) {
    sol = vars.map(() => {
      const den = pick(rng, [2, 4, 5, 10, 20, 25]);
      return q(ri(rng, -8 * den, 8 * den), den);
    });
    if (sol.filter((x) => x.d !== 1).length < 2 || sol.some((x) => x.isZero())) return null;
  } else {
    sol = vars.map(() => q(ri(rng, -9, 9)));
    if (sol.filter((x) => x.isZero()).length > 1) return null;
  }
  if (new Set(sol.map((x) => x.abs().num())).size < n - 1) return null;
  let rows;
  if (opts.matrix) rows = opts.matrix(rng);
  else {
    rows = [];
    for (let i = 0; i < n; i++) {
      const r = vars.map(() => (rng() < 0.12 ? 0 : (rng() < 0.5 ? -1 : 1) * ri(rng, 1, cmax)));
      if (r.filter((x) => x !== 0).length < Math.min(3, n)) return null;
      if (r.filter((x) => Math.abs(x) >= 2).length < 2) return null;
      rows.push(r);
    }
  }
  if (!rows) return null;
  // decimal coefficients for some rows
  const coefRows = rows.map((r) => {
    if (!opts.dec || rng() < 0.4) return r.map((c) => q(c));
    const s = pick(rng, [2, 4, 5, 10]);
    return r.map((c) => q(c, s));
  });
  const eqs = coefRows.map((r) => ({ terms: rowTerms(r, vars), rhs: dot(r, sol) }));
  if (eqs.some((e) => decStr(e.rhs) === null || Math.abs(e.rhs.num()) > 500)) return null;
  if (coefRows.some((r) => r.some((c) => decStr(c) === null))) return null;
  const g = gaussSteps(coefRows.map((r, i) => [...r, eqs[i].rhs]), vars);
  if (!g) return null;
  if (g.maxAbs > (n === 3 ? 450 : 1500)) return null;
  if (!g.sol.every((x, i) => x.eq(sol[i]))) return null;
  const answers = sol.map((x) => decStr(x));
  const solution = [
    `נסמן את המשוואות (${eqs.map((_, i) => lab(i)).join('), (')}) לפי הסדר ונפתור בשיטת החיסול.`,
    ...g.steps,
    `בדיקה במשוואות המקוריות: ${checkSpan(eqs, Object.fromEntries(vars.map((v, i) => [v, sol[i]])))}.`,
    `הפתרון: ${L(vars.map((v, i) => `${v} = ${answers[i]}`.replace('-', MINUS)).join(', '))}.`,
  ];
  const tips = opts.dec
    ? [
        'כפלו כל משוואה במספר מתאים כדי להיפטר מהשברים והמספרים העשרוניים, ורק אז התחילו בחיסול.',
        'בחרו נעלם שקל לחסל וחסלו אותו משתי משוואות שונות (כפל מתאים וחיבור או חיסור). כך מקטינים את המערכת.',
        'חזרו על החיסול עד שמגיעים למשוואה עם נעלם אחד, הציבו אחורה ובדקו בכל המשוואות המקוריות.',
      ]
    : [
        'בחרו נעלם שקל לחסל וחסלו אותו משתי משוואות שונות על ידי כפל מתאים וחיבור או חיסור.',
        'אחרי החיסול מתקבלת מערכת קטנה יותר. חזרו על אותה שיטה עד שמגיעים למשוואה עם נעלם אחד.',
        'הציבו אחורה כדי למצוא את שאר הנעלמים, ובדקו את הפתרון בכל המשוואות המקוריות.',
      ];
  return pack({
    ...ctx,
    topic: n === 3 ? 'math-3' : 'math-4',
    level: opts.level,
    title: opts.title,
    statement: sysStatement(`פתרו את מערכת המשוואות (${n} נעלמים):`, eqs),
    inputs: vars.map((v, i) => ({ label: v, answer: answers[i] })),
    tips,
    solution,
    verify: { equations: eqs.map((e) => eqAscii(e.terms, e.rhs)), vars, solutions: [answers], kind: 'unique' },
  });
}

// cyclic system: p*v_i + q*v_{i+1} + r*v_{i+2} = rhs_i
function cyclicMatrix(rng) {
  const p = (rng() < 0.5 ? -1 : 1) * ri(rng, 1, 4);
  const qq = (rng() < 0.5 ? -1 : 1) * ri(rng, 1, 5);
  const r = rng() < 0.4 ? (rng() < 0.5 ? -1 : 1) * ri(rng, 1, 3) : 0;
  const base = [p, qq, r, 0];
  return [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => base[(j - i + 4) % 4]));
}

// ----- generic 2-solution (one quadratic equation) system -----
const detInt = (M) => {
  if (M.length === 1) return M[0][0];
  let s = 0;
  for (let j = 0; j < M.length; j++) {
    const minor = M.slice(1).map((r) => r.filter((_, c) => c !== j));
    s += (j % 2 ? -1 : 1) * M[0][j] * detInt(minor);
  }
  return s;
};
function nullVec(A) {
  const n = A[0].length;
  const d = [];
  for (let j = 0; j < n; j++) d.push((j % 2 ? -1 : 1) * detInt(A.map((r) => r.filter((_, c) => c !== j))));
  const g = d.reduce((s, x) => gcd(s, x), 0);
  return g ? d.map((x) => x / g) : null;
}
function gaussJordan(M, m) {
  M = M.map((r) => r.slice());
  for (let c = 0; c < m; c++) {
    let p = -1;
    for (let r = c; r < m; r++) if (!M[r][c].isZero()) { p = r; break; }
    if (p < 0) return null;
    [M[c], M[p]] = [M[p], M[c]];
    const inv = M[c][c];
    M[c] = M[c].map((x) => x.div(inv));
    for (let r = 0; r < m; r++) {
      if (r === c || M[r][c].isZero()) continue;
      const f = M[r][c];
      M[r] = M[r].map((x, j) => x.sub(f.mul(M[c][j])));
    }
  }
  return M;
}
const pmul = (a, b) => {
  const out = new Array(a.length + b.length - 1).fill(Q0);
  a.forEach((x, i) => b.forEach((y, j) => { out[i + j] = out[i + j].add(x.mul(y)); }));
  return out;
};
const padd = (a, b) => {
  const out = new Array(Math.max(a.length, b.length)).fill(Q0);
  a.forEach((x, i) => { out[i] = out[i].add(x); });
  b.forEach((x, i) => { out[i] = out[i].add(x); });
  return out;
};

function affineHtml(a, b, t) {
  const parts = [];
  if (!a.isZero()) parts.push({ neg: a.n < 0, body: show(a.abs()) });
  if (!b.isZero()) {
    const ab = b.abs();
    const coef = ab.eq(Q1) ? '' : ab.d === 1 || decStr(ab) !== null ? show(ab) : `(${show(ab)})`;
    parts.push({ neg: b.n < 0, body: `${coef}${t}` });
  }
  if (!parts.length) return '0';
  return parts.map((p, i) => (i === 0 ? (p.neg ? MINUS : '') : p.neg ? ' − ' : ' + ') + p.body).join('');
}

function twoSolutionTemplate(rng, ctx, n, opts) {
  const vars = n === 3 ? VARS3 : VARS4;
  const A = [];
  for (let i = 0; i < n - 1; i++) {
    const r = vars.map(() => (rng() < 0.15 ? 0 : (rng() < 0.5 ? -1 : 1) * ri(rng, 1, opts.coefMax)));
    if (r.filter((x) => x !== 0).length < 2) return null;
    A.push(r);
  }
  const d = nullVec(A);
  if (!d || Math.max(...d.map(Math.abs)) > 3 || d.filter((x) => x !== 0).length < 2) return null;
  const s = pick(rng, [1, 2, -1, -2]);
  const P1 = vars.map(() => ri(rng, -5, 5));
  const P2 = P1.map((x, i) => x + s * d[i]);
  if (P2.some((x) => Math.abs(x) > 8)) return null;
  const quad = pick(rng, opts.quads);
  const qv = (P) => quad.reduce((acc, [i, j]) => acc + P[i] * P[j], 0);
  const qd = quad.reduce((acc, [i, j]) => acc + s * d[i] * s * d[j], 0);
  if (qd === 0) return null;
  const nz = d.map((x, i) => (x !== 0 ? i : -1)).filter((i) => i >= 0);
  const j = pick(rng, nz);
  const e = vars.map(() => ri(rng, -4, 4));
  let sum = qv(P2) - qv(P1);
  for (let i = 0; i < n; i++) if (i !== j) sum += e[i] * s * d[i];
  const need = -sum;
  if (need % (s * d[j]) !== 0) return null;
  e[j] = need / (s * d[j]);
  if (Math.abs(e[j]) > 8 || e.every((x) => x === 0)) return null;
  const h = qv(P1) + e.reduce((acc, x, i) => acc + x * P1[i], 0);
  if (Math.abs(h) > 150) return null;
  const quadTerms = [
    ...quad.map(([i, k]) => ({ c: 1, v: [vars[i], vars[k]] })),
    ...e.map((c, i) => ({ c, v: [vars[i]] })),
  ];
  const eqs = A.map((r) => ({ terms: rowTerms(r, vars), rhs: dot(r, P1.map((x) => q(x))) }));
  const qEq = { terms: quadTerms, rhs: q(h) };
  const qPos = ri(rng, 0, n - 1);
  const all = eqs.slice();
  all.splice(qPos, 0, qEq);
  // parametric form in the free variable f
  const f = nz[nz.length - 1];
  const others = vars.map((_, i) => i).filter((i) => i !== f);
  const M = A.map((r, ri2) => [...others.map((c) => q(r[c])), q(-r[f]), eqs[ri2].rhs]);
  // columns: others..., then (-a_f) coefficient for t, then rhs ; solve others = rhs + (-a_f)*t
  const gj = gaussJordan(M, n - 1);
  if (!gj) return null;
  const aff = new Array(n);
  others.forEach((c, k) => { aff[c] = [gj[k][n], gj[k][n - 1]]; });
  aff[f] = [Q0, Q1];
  // quadratic in t
  let poly = [q(-h)];
  for (const [i, k] of quad) poly = padd(poly, pmul(aff[i], aff[k]));
  e.forEach((c, i) => { if (c !== 0) poly = padd(poly, aff[i].map((x) => x.mul(q(c)))); });
  while (poly.length < 3) poly.push(Q0);
  let lcm = 1;
  poly.forEach((x) => { lcm = (lcm / gcd(lcm, x.d)) * x.d; });
  let C = poly.map((x) => x.n * (lcm / x.d));
  const gg = C.reduce((a, b) => gcd(a, b), 0) || 1;
  C = C.map((x) => x / gg);
  if (C[2] < 0) C = C.map((x) => -x);
  if (C[2] === 0) return null;
  const disc = C[1] * C[1] - 4 * C[2] * C[0];
  if (disc <= 0) return null;
  const sq = Math.round(Math.sqrt(disc));
  if (sq * sq !== disc) return null;
  const roots = [q(-C[1] - sq, 2 * C[2]), q(-C[1] + sq, 2 * C[2])];
  const pts = roots.map((t) => vars.map((_, i) => aff[i][0].add(aff[i][1].mul(t))));
  const want = [P1, P2].map((P) => P.map((x) => q(x)));
  const okPts = want.every((W) => pts.some((P) => P.every((x, i) => x.eq(W[i]))));
  if (!okPts) return null;
  if (Math.max(...pts.flat().map((x) => Math.abs(x.num()))) > 12) return null;
  const sets = pts.map((P) => P.map((x) => decStr(x)));
  sets.sort((a, b) => Number(a[0]) - Number(b[0]) || Number(a[1]) - Number(b[1]));
  const tv = vars[f];
  const tName = tv;
  const rootsTxt = roots.map((r) => show(r));
  const solution = [
    `נסמן את המשוואות לפי הסדר. שתי משוואות מהן ליניאריות והאחת ריבועית.`,
    `נפתור את המשוואות הליניאריות בחיסול (גאוס) ונבטא את כל הנעלמים באמצעות ${tName}: ${L(others.map((c) => `${vars[c]} = ${affineHtml(aff[c][0], aff[c][1], tName)}`).join(', '))}.`,
    `נציב את הביטויים במשוואה הריבועית ונסדר: ${L(`${lhsHtml([{ c: C[2], v: [tName, tName] }, { c: C[1], v: [tName] }, { c: C[0], v: [] }])} = 0`)}.`,
    `דיסקרימיננטה: ${L(`Δ = ${C[1] < 0 ? `(${MINUS}${-C[1]})` : C[1]}² − 4·${C[2]}·${C[0] < 0 ? `(${MINUS}${-C[0]})` : C[0]} = ${disc}`)}, ולכן ${L(`√Δ = ${sq}`)} ו־${L(`${tName} = (${C[1] === 0 ? '0' : show(-C[1])} ± ${sq}) / ${2 * C[2]}`)}, כלומר ${L(`${tName} = ${rootsTxt[0]}`)} או ${L(`${tName} = ${rootsTxt[1]}`)}.`,
    `לכל ערך של ${tName} נחשב את שאר הנעלמים: ${pts.map((P) => L(`(${P.map((x) => show(x)).join(', ')})`)).join(' ו־')}.`,
    `בדיקה בשלוש המשוואות המקוריות: ${pts.map((P) => `${L('(' + P.map((x) => show(x)).join(', ') + ')')}: ${checkSpan(all, Object.fromEntries(vars.map((v, i) => [v, P[i]])))}`).join('. ')}.`,
    `יש בדיוק שני פתרונות, כי המשוואה הריבועית ב־${tName} היא ממעלה שנייה עם שני שורשים ממשיים שונים.`,
  ];
  return pack({
    ...ctx,
    topic: n === 3 ? 'math-3' : 'math-4',
    level: 3,
    title: opts.title,
    statement: sysStatement(`מצאו את כל הפתרונות הממשיים של המערכת (${n} נעלמים):`, all),
    labels: vars,
    sets,
    tips: [
      'המשוואות הליניאריות מאפשרות לבטא את כל הנעלמים באמצעות נעלם אחד בלבד. חסלו אותן בשיטת החיסול.',
      'הציבו את הביטויים במשוואה הריבועית ופתחו סוגריים בזהירות. מתקבלת משוואה ריבועית בנעלם אחד, ורצוי לצמצם במחלק משותף.',
      'פתרו את המשוואה הריבועית (נוסחת השורשים), ולכל שורש חשבו את שאר הנעלמים. אל תשכחו לבדוק את כל המשוואות.',
    ],
    solution,
    verify: { equations: all.map((x) => eqAscii(x.terms, x.rhs)), vars, solutions: sets, kind: 'finite' },
  });
}

// ----- parameter k -----
function paramTemplate(rng, ctx) {
  const vars = VARS3;
  const rowsAB = [0, 1].map(() => vars.map(() => (rng() < 0.12 ? 0 : (rng() < 0.5 ? -1 : 1) * ri(rng, 1, 5))));
  if (rowsAB.some((r) => r.filter((x) => x !== 0).length < 2)) return null;
  const jk = ri(rng, 0, 2);
  const [j1, j2] = [0, 1, 2].filter((c) => c !== jk);
  const minor = rowsAB[0][j1] * rowsAB[1][j2] - rowsAB[0][j2] * rowsAB[1][j1];
  if (minor === 0) return null;
  const lam = pick(rng, [-3, -2, -1, 1, 2, 3]);
  const mu = pick(rng, [-3, -2, -1, 1, 2, 3]);
  const bAB = rowsAB.map(() => ri(rng, -9, 9));
  const D = vars.map((_, c) => lam * rowsAB[0][c] + mu * rowsAB[1][c]);
  const Db = lam * bAB[0] + mu * bAB[1];
  if (Math.max(...D.map(Math.abs), Math.abs(Db)) > 14) return null;
  const k0 = pick(rng, [-6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6]);
  const pk = pick(rng, [1, 1, 2]);
  const c = D[jk] - pk * k0;
  const m = pick(rng, [-3, -2, -1, 0, 1, 2, 3]);
  const none = rng() < 0.5;
  const delta = none ? pick(rng, [-3, -2, -1, 1, 2, 3]) : 0;
  const e = Db + delta - m * k0;
  if (Math.abs(c) > 12 || Math.abs(e) > 20) return null;
  // third row html / ascii
  const segs = [];
  const segsA = [];
  for (let col = 0; col < 3; col++) {
    if (col === jk) {
      const kc = c === 0 ? (pk === 1 ? 'k' : `${pk}k`) : `(${pk === 1 ? '' : pk}k ${c < 0 ? '−' : '+'} ${Math.abs(c)})`;
      const kcA = c === 0 ? (pk === 1 ? 'k' : `${pk}*k`) : `(${pk === 1 ? '' : pk + '*'}k${c < 0 ? '-' : '+'}${Math.abs(c)})`;
      segs.push({ neg: false, body: `${kc}${vars[col]}` });
      segsA.push({ neg: false, body: `${kcA}*${vars[col]}` });
    } else if (D[col] !== 0) {
      const a = Math.abs(D[col]);
      segs.push({ neg: D[col] < 0, body: `${a === 1 ? '' : a}${vars[col]}` });
      segsA.push({ neg: D[col] < 0, body: `${a === 1 ? '' : a + '*'}${vars[col]}` });
    }
  }
  const join = (arr, minus) => arr.map((s, i) => (i === 0 ? (s.neg ? minus : '') : s.neg ? ` ${minus} ` : ' + ') + s.body).join('');
  const joinA = (arr) => arr.map((s, i) => (i === 0 ? (s.neg ? '-' : '') : s.neg ? '-' : '+') + s.body).join('');
  const rhsH = m === 0 ? show(q(e)) : `${Math.abs(m) === 1 ? (m < 0 ? MINUS : '') : (m < 0 ? MINUS : '') + Math.abs(m)}k${e === 0 ? '' : ` ${e < 0 ? '−' : '+'} ${Math.abs(e)}`}`;
  const rhsA = m === 0 ? String(e) : `${m < 0 ? '-' : ''}${Math.abs(m) === 1 ? '' : Math.abs(m) + '*'}k${e === 0 ? '' : (e < 0 ? '-' : '+') + Math.abs(e)}`;
  const eqs = rowsAB.map((r, i) => ({ terms: rowTerms(r, vars), rhs: q(bAB[i]) }));
  const row3Html = L(`${join(segs, '−')} = ${rhsH}`);
  const row3Ascii = `${joinA(segsA)}=${rhsA}`;
  const lines = [...eqs.map((x) => eqHtml(x.terms, x.rhs)), row3Html];
  const question = none ? 'עבור איזה ערך של k אין למערכת פתרון?' : 'עבור איזה ערך של k יש למערכת אינסוף פתרונות?';
  // solution
  const v1 = vars[j1];
  const v2 = vars[j2];
  const vk = vars[jk];
  const eqLam = (col) => L(`${rowsAB[0][col] === 0 ? '0' : show(rowsAB[0][col])}·λ + ${rowsAB[1][col] === 0 ? '0' : showP(rowsAB[1][col])}·μ = ${show(D[col])}`.replace(/\+ −/g, '− ').replace(/ ·/g, '·'));
  const rhsAt = m * k0 + e;
  const solution = [
    `המערכת היא (א), (ב) ו־(ג) לפי הסדר. כאשר המשוואה (ג) היא צירוף של (א) ו־(ב) המערכת אינה בעלת פתרון יחיד: יש אינסוף פתרונות או אין פתרון. נחפש ערך k שעבורו (ג) = λ·(א) + μ·(ב).`,
    `נשווה מקדמים בנעלמים שאינם מכילים את k, כלומר ${v1} ו־${v2}: ${eqLam(j1)} ו־${eqLam(j2)}.`,
    `נפתור את שתי המשוואות ונקבל ${L(`λ = ${lam}, μ = ${mu}`.replace(/= -/g, '= ' + MINUS).replace(/, μ = -/, ', μ = ' + MINUS))}.`,
    `נשווה את מקדם ${vk}: ${L(`${c === 0 ? '' : ''}${pk === 1 ? '' : pk}k${c === 0 ? '' : (c < 0 ? ' − ' : ' + ') + Math.abs(c)} = ${show(D[jk])}`)}, ולכן ${L(`k = ${show(q(D[jk] - c, pk))}`)}.`.replace('= -', '= ' + MINUS),
    `ברגע זה האגף הימני של (ג) הוא ${L(`${show(q(rhsAt))}`)}, ואילו הצירוף ${L(`λ·(${show(q(bAB[0]))}) + μ·(${show(q(bAB[1]))})`)} שווה ${L(show(q(Db)))}.`,
    none
      ? `האגפים הימניים שונים (${L(show(q(rhsAt)))} ≠ ${L(show(q(Db)))}), ולכן מתקבלת סתירה: עבור ${L(`k = ${show(q(k0))}`)} אין פתרון.`
      : `האגפים הימניים שווים, ולכן (ג) היא צירוף של (א) ו־(ב) בדיוק: עבור ${L(`k = ${show(q(k0))}`)} יש אינסוף פתרונות.`,
    `לכל ערך אחר של k המשוואה (ג) אינה צירוף של שתי האחרות (מקדם ${vk} שונה), ולכן יש פתרון יחיד. כלומר הערך היחיד הוא ${L(`k = ${show(q(k0))}`)}.`,
  ];
  return pack({
    ...ctx,
    topic: 'math-3',
    level: 3,
    title: none ? 'פרמטר k: מתי אין פתרון' : 'פרמטר k: מתי יש אינסוף פתרונות',
    statement: `נתונה המערכת, כאשר k הוא פרמטר:<br>${lines.join('<br>')}<br>${question}`,
    inputs: [{ label: 'k', answer: String(k0) }],
    tips: [
      'המערכת אינה בעלת פתרון יחיד בדיוק כאשר אחת המשוואות היא צירוף ליניארי של האחרות. חפשו צירוף של שתי המשוואות הראשונות שמתאים לשלישית.',
      'השוו מקדמים בנעלמים שאינם תלויים בפרמטר כדי למצוא את מקדמי הצירוף, ואז השוו את המקדם התלוי בפרמטר כדי לקבל את ערך k.',
      'אחרי שמצאתם את k, השוו את האגפים הימניים: אם הם מתאימים לצירוף יש אינסוף פתרונות, ואם לא מתקבלת סתירה ואין פתרון.',
    ],
    solution,
    verify: {
      equations: [...eqs.map((x) => eqAscii(x.terms, x.rhs)), row3Ascii],
      kind: none ? 'none' : 'infinite',
      param: { input: 0, value: k0 },
    },
  });
}

// ----- cyclic product system  x(y+z)=A, y(z+x)=B, z(x+y)=C -----
function cyclicProductTemplate(rng, ctx) {
  const nzv = () => (rng() < 0.5 ? -1 : 1) * ri(rng, 1, 6);
  const [x, y, z] = [nzv(), nzv(), nzv()];
  const A = x * (y + z);
  const B = y * (z + x);
  const C = z * (x + y);
  if ([A, B, C].every((v) => v === 0) || Math.abs(x * y * z) > 120) return null;
  const p = x * y;
  const qq = y * z;
  const r = z * x;
  const m = Math.abs(x * y * z);
  const fm = (v) => (v < 0 ? `(${MINUS}${-v})` : String(v));
  const sg = (v) => (v < 0 ? MINUS + -v : String(v));
  const sets = [[x, y, z], [-x, -y, -z]].map((P) => P.map(String)).sort((a, b) => Number(a[0]) - Number(b[0]));
  const eqs = [
    { h: L(`x(y + z) = ${sg(A)}`), a: `x*(y+z)=${A}` },
    { h: L(`y(z + x) = ${sg(B)}`), a: `y*(z+x)=${B}` },
    { h: L(`z(x + y) = ${sg(C)}`), a: `z*(x+y)=${C}` },
  ];
  const solution = [
    `נפתח סוגריים: ${L(`xy + xz = ${sg(A)}`)} (א), ${L(`yz + yx = ${sg(B)}`)} (ב), ${L(`zx + zy = ${sg(C)}`)} (ג). אלו משוואות ליניאריות במכפלות xy, yz, zx.`,
    `נחבר את (א) ו־(ב) ונחסר את (ג): ${L(`2xy = ${sg(A)} + ${fm(B)} − ${fm(C)} = ${sg(2 * p)}`)}, ולכן ${L(`xy = ${sg(p)}`)}. באותו אופן ${L(`yz = ${sg(qq)}`)} ו־${L(`zx = ${sg(r)}`)}.`,
    `נכפיל את שלוש המכפלות: ${L(`(xyz)² = ${fm(p)}·${fm(qq)}·${fm(r)} = ${p * qq * r}`)}, ולכן ${L(`xyz = ${m}`)} או ${L(`xyz = ${MINUS}${m}`)}.`,
    `אם ${L(`xyz = ${sg(x * y * z)}`)}: ${L(`x = xyz / yz = ${sg(x)}`)}, ${L(`y = xyz / zx = ${sg(y)}`)}, ${L(`z = xyz / xy = ${sg(z)}`)}.`,
    `אם ${L(`xyz = ${sg(-x * y * z)}`)}: כל המשתנים מתהפכים: ${L(`(${sg(-x)}, ${sg(-y)}, ${sg(-z)})`)}.`,
    `בדיקה: ${[[x, y, z], [-x, -y, -z]].map((P) => L(`${fm(P[0])}(${fm(P[1])} + ${fm(P[2])}) = ${sg(P[0] * (P[1] + P[2]))}`) + ' ✓').join(', ')} (ושאר המשוואות מתקיימות באותו אופן).`,
  ];
  return pack({
    ...ctx,
    topic: 'math-3',
    level: 3,
    title: 'מערכת מעגלית עם מכפלות',
    statement: `מצאו את כל הפתרונות הממשיים של המערכת:<br>${eqs.map((e) => e.h).join('<br>')}`,
    labels: VARS3,
    sets,
    tips: [
      'פתחו סוגריים בכל משוואה. תראו שכל משוואה היא סכום של שתי מכפלות מבין שלוש המכפלות האפשריות של זוגות נעלמים.',
      'התייחסו למכפלות כאל נעלמים חדשים וחסלו אותם בשיטה הרגילה (חיבור וחיסור משוואות) כדי למצוא כל מכפלה בנפרד.',
      'כפלו את שלוש המכפלות כדי לקבל את הריבוע של מכפלת שלושת הנעלמים, ומשם גם את הערך החיובי וגם את השלילי. בדקו את שני הפתרונות.',
    ],
    solution,
    verify: { equations: eqs.map((e) => e.a), vars: VARS3, solutions: sets, kind: 'finite' },
  });
}

// ---------- physics templates (g = 10) ----------
const G_TXT = `נתון ${L('g = 10 מ/ש²')}. התעלמו מהתנגדות האוויר.`;
const isSq = (n) => Number.isInteger(Math.sqrt(n));
const P = (x) => L(show(q(Math.round(x * 100), 100)).replace(/^−/, MINUS));

function phThrowUp(rng, ctx) {
  const T = pick(rng, [3, 4, 5, 6, 7, 8]);
  const v0 = ri(rng, 4, 5 * T - 4);
  const H = T * (5 * T - v0);
  const tp = q(v0, 10);
  const hmax = q(H * 20 + v0 * v0, 20);
  const vimp = 10 * T - v0;
  const disc = v0 * v0 + 20 * H;
  const solution = [
    `נבחר כיוון חיובי כלפי מעלה, ראשית הציר בקרקע. משוואת המקום: ${L(`y(t) = ${H} + ${v0}t − 5t²`)} ומשוואת המהירות: ${L(`v(t) = ${v0} − 10t`)}.`,
    `בנקודת השיא המהירות מתאפסת: ${L(`${v0} − 10t = 0`)}, ולכן ${L(`t = ${show(tp)} ש'`)}.`,
    `העלייה מעל נקודת הזריקה: ${L(`Δh = v₀² / 2g = ${v0}² / 20 = ${show(q(v0 * v0, 20))} מ'`)}. הגובה המרבי מעל הקרקע: ${L(`${H} + ${show(q(v0 * v0, 20))} = ${show(hmax)} מ'`)}.`,
    `הגעה לקרקע: ${L(`y = 0`)}, כלומר ${L(`5t² − ${v0}t − ${H} = 0`)}.`,
    `דיסקרימיננטה: ${L(`Δ = ${v0}² + 20·${H} = ${disc}`)}, ו־${L(`√Δ = ${vimp}`)}. השורשים: ${L(`t = (${v0} ± ${vimp}) / 10`)}, כלומר ${L(`t = ${T}`)} או ${L(`t = ${show(q(v0 - vimp, 10))}`)}. הזמן השלילי אינו פיזיקלי, ולכן הכדור מגיע לקרקע אחרי ${L(`${T} ש'`)}.`,
    `מהירות הפגיעה: ${L(`v = ${v0} − 10·${T} = ${v0 - 10 * T} מ/ש`)}, כלומר גודלה ${L(`${vimp} מ/ש`)} כלפי מטה.`,
    `בדיקה בעזרת שימור אנרגיה: ${L(`v = √(v₀² + 2gH) = √(${v0}² + 20·${H}) = ${vimp} מ/ש`)} ✓.`,
  ];
  return pack({
    ...ctx,
    topic: 'phys-vertical',
    level: 3,
    title: 'זריקה אנכית כלפי מעלה מגג בניין',
    statement: `כדור נזרק אנכית כלפי מעלה במהירות התחלתית ${L(`${v0} מ/ש`)} מגג בניין שגובהו ${L(`${H} מ'`)} מעל הקרקע. ${G_TXT}<br>חשבו: א. הזמן עד נקודת השיא. ב. הגובה המרבי של הכדור מעל הקרקע. ג. הזמן עד הגעת הכדור לקרקע. ד. גודל מהירות הכדור ברגע הפגיעה בקרקע.`,
    inputs: [
      { label: 'הזמן עד נקודת השיא', unit: "ש'", answer: decStr(tp) },
      { label: 'הגובה המרבי מעל הקרקע', unit: "מ'", answer: decStr(hmax) },
      { label: 'הזמן עד הגעה לקרקע', unit: "ש'", answer: String(T) },
      { label: 'גודל מהירות הפגיעה', unit: 'מ/ש', answer: String(vimp) },
    ],
    tips: [
      'בנקודת השיא המהירות האנכית מתאפסת. השתמשו בקשר בין מהירות, תאוצה וזמן כדי למצוא את זמן העלייה.',
      'כדי למצוא את הגובה המרבי הוסיפו לגובה הגג את העלייה מעל נקודת הזריקה, שאפשר לחשב בלי להשתמש בזמן.',
      'זמן הגעה לקרקע: כתבו את משוואת המקום עם כיוון חיובי אחד, השוו לאפס ופתרו משוואה ריבועית. פסלו שורש שלילי. את המהירות חשבו מהזמן.',
    ],
    solution,
    verify: { model: 'throw-up', params: { H, v0 } },
  });
}

function phNthSecond(rng, ctx) {
  const n = ri(rng, 3, 14);
  const d = 10 * n - 5;
  const Ht = 5 * n * n;
  const solution = [
    `נסמן ב־${L('T')} את זמן הנפילה הכולל. הגוף נשמט ממנוחה, ולכן המרחק שעבר עד זמן t הוא ${L('h(t) = 5t²')}.`,
    `המרחק בשנייה האחרונה: ${L(`h(T) − h(T − 1) = 5T² − 5(T − 1)² = 10T − 5`)}.`,
    `נשווה לנתון: ${L(`10T − 5 = ${d}`)}, ולכן ${L(`T = ${n} ש'`)}.`,
    `גובה הנפילה: ${L(`H = 5·${n}² = ${Ht} מ'`)}.`,
    `מהירות הפגיעה: ${L(`v = gT = 10·${n} = ${10 * n} מ/ש`)}.`,
    `המרחק בשנייה שלפני האחרונה: ${L(`h(${n - 1}) − h(${n - 2}) = 5·${(n - 1) ** 2} − 5·${(n - 2) ** 2} = ${10 * n - 15} מ'`)}.`,
  ];
  return pack({
    ...ctx,
    topic: 'phys-vertical',
    level: 2,
    title: 'נפילה חופשית: המרחק בשנייה האחרונה',
    statement: `גוף נשמט ממנוחה מגובה לא ידוע ונופל נפילה חופשית. בשנייה האחרונה לפני הפגיעה בקרקע הוא עבר ${L(`${d} מ'`)}. ${G_TXT}<br>חשבו: א. זמן הנפילה הכולל. ב. גובה הנפילה. ג. מהירות הפגיעה. ד. המרחק שעבר הגוף בשנייה שלפני האחרונה.`,
    inputs: [
      { label: 'זמן הנפילה הכולל', unit: "ש'", answer: String(n) },
      { label: 'גובה הנפילה', unit: "מ'", answer: String(Ht) },
      { label: 'מהירות הפגיעה', unit: 'מ/ש', answer: String(10 * n) },
      { label: 'המרחק בשנייה שלפני האחרונה', unit: "מ'", answer: String(10 * n - 15) },
    ],
    tips: [
      'המרחק בשנייה האחרונה הוא ההפרש בין המרחק שעבר הגוף עד סוף הנפילה למרחק שעבר עד שנייה אחת לפני כן.',
      'סמנו את זמן הנפילה באות, כתבו את ההפרש כביטוי בזמן הנפילה, והשוו לנתון כדי לקבל משוואה פשוטה.',
      'אחרי שמצאתם את זמן הנפילה, חשבו את הגובה ואת המהירות מהנוסחאות הרגילות, ואת השנייה שלפני האחרונה באותו אופן כמו האחרונה.',
    ],
    solution,
    verify: { model: 'nth-second', params: { d } },
  });
}

// (v0, 5m) pairs with an integer hypotenuse
function pythPair(rng, maxV0) {
  const m = ri(rng, 2, 12);
  const opts = [];
  for (let v0 = 3; v0 <= maxV0; v0++) if (isSq(v0 * v0 + 25 * m * m)) opts.push(v0);
  if (!opts.length) return null;
  return { m, v0: pick(rng, opts) };
}

function phHorizontal(rng, ctx) {
  const mode = rng() < 0.6 ? 'pyth' : 'deg45';
  let m;
  let v0;
  if (mode === 'pyth') {
    const pr = pythPair(rng, 60);
    if (!pr) return null;
    ({ m, v0 } = pr);
  } else {
    m = ri(rng, 2, 12);
    v0 = 5 * m;
  }
  const T = q(m, 2);
  const H = q(5 * m * m, 4);
  const R = q(v0 * m, 2);
  const vy = 5 * m;
  const hyp = Math.round(Math.sqrt(v0 * v0 + vy * vy));
  const tanQ = q(vy, v0);
  const hasTan = mode === 'pyth' && decStr(tanQ) !== null;
  const inputs = [
    { label: 'זמן התעופה', unit: "ש'", answer: decStr(T) },
    { label: 'הטווח האופקי', unit: "מ'", answer: decStr(R) },
  ];
  const asks = ['א. זמן התעופה.', 'ב. הטווח האופקי.'];
  const sol = [
    `זמן התעופה נקבע רק מהתנועה האנכית (נפילה חופשית): ${L(`H = 5t²`)}, ולכן ${L(`${show(H)} = 5t²`)}, ${L(`t² = ${show(q(H.n, 5 * H.d))}`)} ו־${L(`t = ${show(T)} ש'`)}.`,
    `בציר האופקי המהירות קבועה: ${L(`x = v₀t = ${v0}·${show(T)} = ${show(R)} מ'`)}.`,
    `המהירות האנכית ברגע הפגיעה: ${L(`v_y = gt = 10·${show(T)} = ${vy} מ/ש`)}.`,
  ];
  let tips;
  if (mode === 'pyth') {
    inputs.push({ label: 'גודל מהירות הפגיעה', unit: 'מ/ש', answer: String(hyp) });
    asks.push('ג. גודל המהירות ברגע הפגיעה בקרקע.');
    sol.push(`גודל המהירות: ${L(`v = √(v₀² + v_y²) = √(${v0}² + ${vy}²) = √${v0 * v0 + vy * vy} = ${hyp} מ/ש`)}.`);
    if (hasTan) {
      inputs.push({ label: 'טנגנס הזווית מתחת לאופק', unit: '', answer: decStr(tanQ) });
      asks.push('ד. טנגנס הזווית שבה הכדור פוגע בקרקע ביחס לאופק.');
      sol.push(`הזווית ביחס לאופק: ${L(`tan θ = v_y / v₀ = ${vy} / ${v0} = ${show(tanQ)}`)}.`);
    }
    tips = [
      'התנועה בציר האנכי היא נפילה חופשית מהגובה הנתון, והיא קובעת את זמן התעופה. התנועה האופקית היא במהירות קבועה.',
      'הטווח הוא המהירות האופקית כפול זמן התעופה. המהירות האנכית בפגיעה נקבעת מהזמן ומהתאוצה.',
      'גודל המהירות מתקבל ממשפט פיתגורס על שני רכיבי המהירות, והטנגנס של הזווית הוא היחס בין הרכיב האנכי לאופקי.',
    ];
  } else {
    inputs.push({ label: 'המהירות האנכית ברגע הפגיעה', unit: 'מ/ש', answer: String(vy) });
    inputs.push({ label: 'הזווית מתחת לאופק', unit: 'מעלות', answer: '45' });
    asks.push('ג. המהירות האנכית ברגע הפגיעה.', 'ד. הזווית שבה הכדור פוגע בקרקע ביחס לאופק (במעלות).');
    sol.push(`הרכיב האנכי שווה לרכיב האופקי (${L(`v_y = v₀ = ${vy} מ/ש`)}), ולכן ${L('tan θ = 1')} והזווית היא ${L('45°')}.`);
    tips = [
      'התנועה בציר האנכי היא נפילה חופשית מהגובה הנתון, והיא קובעת את זמן התעופה. התנועה האופקית היא במהירות קבועה.',
      'הטווח הוא המהירות האופקית כפול זמן התעופה. את המהירות האנכית בפגיעה מוצאים מהזמן ומהתאוצה.',
      'כדי למצוא את הזווית השוו בין שני רכיבי המהירות ברגע הפגיעה. כאשר הם שווים, הזווית היא זווית מוכרת.',
    ];
  }
  return pack({
    ...ctx,
    topic: 'phys-horizontal',
    level: 3,
    title: 'שיגור אופקי מצוק',
    statement: `כדור נזרק אופקית במהירות ${L(`${v0} מ/ש`)} מקצה מצוק שגובהו ${L(`${show(H)} מ'`)} מעל הקרקע. ${G_TXT}<br>חשבו: ${asks.join(' ')}`,
    inputs,
    tips,
    solution: sol,
    verify: { model: mode === 'pyth' ? 'horizontal' : 'horizontal-45', params: { H: H.num(), v0 } },
  });
}

function phHorizontalRange(rng, ctx) {
  const m = ri(rng, 2, 12);
  const v0 = ri(rng, 4, 40);
  const T = q(m, 2);
  const H = q(5 * m * m, 4);
  const R = q(v0 * m, 2);
  const vy = 5 * m;
  const hyp2 = v0 * v0 + vy * vy;
  const withSpeed = isSq(hyp2);
  const inputs = [
    { label: 'זמן התעופה', unit: "ש'", answer: decStr(T) },
    { label: 'המהירות ההתחלתית האופקית', unit: 'מ/ש', answer: String(v0) },
    { label: 'המהירות האנכית ברגע הפגיעה', unit: 'מ/ש', answer: String(vy) },
  ];
  const asks = ['א. זמן התעופה.', 'ב. המהירות ההתחלתית של הכדור.', 'ג. המהירות האנכית של הכדור ברגע הפגיעה.'];
  const sol = [
    `זמן התעופה תלוי רק בגובה: ${L(`${show(H)} = 5t²`)}, ולכן ${L(`t² = ${show(q(H.n, 5 * H.d))}`)} ו־${L(`t = ${show(T)} ש'`)}.`,
    `בציר האופקי המהירות קבועה, ולכן ${L(`v₀ = x / t = ${show(R)} / ${show(T)} = ${v0} מ/ש`)}.`,
    `המהירות האנכית בפגיעה: ${L(`v_y = gt = 10·${show(T)} = ${vy} מ/ש`)}.`,
  ];
  if (withSpeed) {
    const hyp = Math.round(Math.sqrt(hyp2));
    inputs.push({ label: 'גודל מהירות הפגיעה', unit: 'מ/ש', answer: String(hyp) });
    asks.push('ד. גודל המהירות ברגע הפגיעה.');
    sol.push(`גודל המהירות: ${L(`v = √(${v0}² + ${vy}²) = ${hyp} מ/ש`)}.`);
  }
  return pack({
    ...ctx,
    topic: 'phys-horizontal',
    level: 3,
    title: 'שיגור אופקי לפי טווח וגובה',
    statement: `גוף נזרק אופקית מגובה ${L(`${show(H)} מ'`)} מעל הקרקע ונוחת במרחק אופקי של ${L(`${show(R)} מ'`)} מהנקודה שמתחת לנקודת הזריקה. ${G_TXT}<br>חשבו: ${asks.join(' ')}`,
    inputs,
    tips: [
      'התנועה האנכית היא נפילה חופשית מהגובה הנתון, ולכן הגובה קובע את זמן התעופה בלי קשר למהירות האופקית.',
      'בציר האופקי אין תאוצה: הטווח שווה למהירות האופקית כפול זמן התעופה. מכאן אפשר לבודד את המהירות ההתחלתית.',
      'המהירות האנכית בפגיעה נקבעת מזמן התעופה ומהתאוצה. כשמבקשים את גודל המהירות הכוללת, חברו את שני הרכיבים לפי פיתגורס.',
    ],
    solution: sol,
    verify: { model: 'horizontal-range', params: { H: H.num(), R: R.num() } },
  });
}

function phMeeting(rng, ctx) {
  const tau = pick(rng, [0, 1, 2]);
  const s = ri(rng, 1, 4);
  const v0 = ri(rng, 5 * s + 1, 5 * s + 30);
  const H = s * (v0 + 10 * tau) + 5 * tau * tau;
  const t = s + tau;
  if (5 * t * t >= H || H > 400) return null;
  const y = v0 * s - 5 * s * s;
  const vA = 10 * t;
  const vB = v0 - 10 * s;
  const delay = tau === 0 ? 'באותו רגע' : `${L(`${tau} ש'`)} לאחר מכן`;
  const solution = [
    `נקבע ${L('t = 0')} ברגע שחרור גוף א', וכיוון חיובי כלפי מעלה (ראשית בקרקע). גוף א': ${L(`y_A = ${H} − 5t²`)}. גוף ב' נזרק ברגע ${L(`t = ${tau}`)}, ולכן ${L(`y_B = ${v0}(t − ${tau}) − 5(t − ${tau})²`)} (עבור ${L(`t ≥ ${tau}`)}).`,
    `במפגש ${L('y_A = y_B')}. נסמן ${L(`s = t − ${tau}`)} (הזמן מאז זריקת ב'), ולכן ${L(`t = s + ${tau}`)}: ${L(`${H} − 5(s + ${tau})² = ${v0}s − 5s²`)}.`,
    `אחרי פתיחת סוגריים האיברים ${L('5s²')} מצטמצמים ומתקבלת משוואה ליניארית: ${L(`${H - 5 * tau * tau} = ${v0 + 10 * tau}s`)}, ולכן ${L(`s = ${s} ש'`)}.`,
    `זמן המפגש מרגע שחרור א': ${L(`t = s + ${tau} = ${t} ש'`)}.`,
    `גובה המפגש: ${L(`y = ${H} − 5·${t}² = ${H - 5 * t * t} מ'`)}. בדיקה לפי ב': ${L(`${v0}·${s} − 5·${s}² = ${y} מ'`)} ✓.`,
    `מהירות א' במפגש (כלפי מטה): ${L(`10·${t} = ${vA} מ/ש`)}. מהירות ב' (חיובי כלפי מעלה): ${L(`${v0} − 10·${s} = ${vB} מ/ש`)}.`,
  ];
  return pack({
    ...ctx,
    topic: 'phys-vertical',
    level: 3,
    title: 'שני גופים נפגשים באוויר',
    statement: `גוף א' נשמט ממנוחה מגובה ${L(`${H} מ'`)} מעל הקרקע ברגע ${L('t = 0')}. ${delay === 'באותו רגע' ? 'באותו רגע' : `${delay}`} נזרק מהקרקע אנכית כלפי מעלה גוף ב' במהירות ${L(`${v0} מ/ש`)} (מהקרקע, מתחת לגוף א'). ${G_TXT}<br>חשבו: א. כמה זמן מרגע שחרור גוף א' הם נפגשים. ב. באיזה גובה מעל הקרקע הם נפגשים. ג. גודל מהירות גוף א' ברגע המפגש. ד. מהירות גוף ב' ברגע המפגש (חיובי = כלפי מעלה).`,
    inputs: [
      { label: "הזמן מרגע שחרור גוף א' עד המפגש", unit: "ש'", answer: String(t) },
      { label: 'גובה המפגש מעל הקרקע', unit: "מ'", answer: String(y) },
      { label: "גודל מהירות גוף א' במפגש", unit: 'מ/ש', answer: String(vA) },
      { label: "מהירות גוף ב' במפגש (חיובי = כלפי מעלה)", unit: 'מ/ש', answer: String(vB) },
    ],
    tips: [
      "כתבו לכל גוף משוואת מקום כפונקציה של הזמן עם אותו ציר וראשית זמן משותפת. זכרו שגוף ב' מתחיל לנוע מאוחר יותר.",
      'במפגש הגבהים שווים. אחרי פתיחת סוגריים האיברים הריבועיים מצטמצמים, ומתקבלת משוואה ליניארית בזמן.',
      "אחרי שמצאתם את זמן המפגש, הציבו אותו במשוואות המקום והמהירות של כל גוף. שימו לב לסימן המהירות של גוף ב'.",
    ],
    solution,
    verify: { model: 'meeting', params: { H, v0, tau } },
  });
}

// ---------- registry ----------
const TEMPLATES = [
  { id: 'm3-linear-int', topic: 'math-3', level: 2, title: 'מערכת 3×3 עם פתרון שלם', run: (r, c) => linearTemplate(r, c, 3, { coefMax: 8, level: 2, title: 'מערכת של שלוש משוואות בשלושה נעלמים' }) },
  { id: 'm3-linear-dec', topic: 'math-3', level: 3, title: 'מערכת 3×3 עם פתרון עשרוני', run: (r, c) => linearTemplate(r, c, 3, { coefMax: 8, dec: true, level: 3, title: 'מערכת עם מקדמים ופתרון עשרוניים' }) },
  { id: 'm3-quad', topic: 'math-3', level: 3, title: 'שתי ליניאריות ומשוואה ריבועית', run: (r, c) => twoSolutionTemplate(r, c, 3, { coefMax: 4, quads: [[[0, 0]], [[0, 1]], [[1, 1]], [[2, 2]], [[0, 2]], [[1, 2]]], title: 'שתי משוואות ליניאריות ומשוואה ריבועית' }) },
  { id: 'm3-param', topic: 'math-3', level: 3, title: 'פרמטר k: אין פתרון / אינסוף פתרונות', run: paramTemplate },
  { id: 'm3-cyclic-prod', topic: 'math-3', level: 3, title: 'מערכת מעגלית עם מכפלות', run: cyclicProductTemplate },
  { id: 'm4-linear', topic: 'math-4', level: 3, title: 'מערכת 4×4 עם פתרון שלם', run: (r, c) => linearTemplate(r, c, 4, { coefMax: 6, level: 3, title: 'מערכת של ארבע משוואות בארבעה נעלמים' }) },
  { id: 'm4-quad', topic: 'math-4', level: 3, title: 'שלוש ליניאריות ומשוואה ריבועית', run: (r, c) => twoSolutionTemplate(r, c, 4, { coefMax: 3, quads: [[[0, 0]], [[0, 1]], [[1, 2]], [[2, 3]], [[0, 3]], [[0, 0], [1, 1]], [[0, 1], [2, 3]]], title: 'שלוש משוואות ליניאריות ומשוואה ריבועית בארבעה נעלמים' }) },
  { id: 'm4-cyclic', topic: 'math-4', level: 3, title: 'מערכת מעגלית של ארבעה נעלמים', run: (r, c) => linearTemplate(r, c, 4, { coefMax: 6, level: 3, matrix: cyclicMatrix, title: 'מערכת מעגלית של ארבע משוואות' }) },
  { id: 'ph-throw-up', topic: 'phys-vertical', level: 3, title: 'זריקה אנכית כלפי מעלה מגובה', run: phThrowUp },
  { id: 'ph-nth-second', topic: 'phys-vertical', level: 2, title: 'נפילה חופשית: השנייה האחרונה', run: phNthSecond },
  { id: 'ph-horizontal', topic: 'phys-horizontal', level: 3, title: 'שיגור אופקי מגובה', run: phHorizontal },
  { id: 'ph-horizontal-range', topic: 'phys-horizontal', level: 3, title: 'שיגור אופקי לפי טווח וגובה', run: phHorizontalRange },
  { id: 'ph-meeting', topic: 'phys-vertical', level: 3, title: 'שני גופים נפגשים באוויר', run: phMeeting },
];

export function listTemplates() {
  return TEMPLATES.map(({ id, topic, level, title }) => ({ id, topic, level, title }));
}

const hashStr = (s) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

export function generate(templateId, seed) {
  const t = TEMPLATES.find((x) => x.id === templateId);
  if (!t) throw new Error(`unknown template ${templateId}`);
  if (!Number.isInteger(seed) || seed < 0) throw new Error('seed must be a non-negative integer');
  const rng = makeRng((seed * 2654435761 + hashStr(templateId)) >>> 0);
  for (let attempt = 0; attempt < 5000; attempt++) {
    const ex = t.run(rng, { tpl: templateId, seed });
    if (ex) return ex;
  }
  throw new Error(`could not generate ${templateId} for seed ${seed}`);
}

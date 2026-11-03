// Independent verifier for the algebra sprints (js/sprint.js): generates thousands of items across seeds and families and, with
// its OWN expression evaluator (not js/fbuilder.js), re-derives every answer from the text the student sees:
//   factored  the product equals the displayed trinomial at several points
//   frac      the displayed arithmetic equals the answer, the answer is in lowest terms
//   poly / singlefrac / mono / surd / num   the displayed expression equals the answer (surds: squarefree radicand)
//   linear equation   the answer solves it and the equation really is linear (unique root)
//   quadratic equation   every answer solves it, no rational root is missing (scan), count matches the discriminant
//   formula rearrangement   with random values for the other variables the answer satisfies the original formula
//   inequality   the claimed set agrees with the displayed inequality on both sides of the boundary and at it
// It also checks that the checker accepts the canonical answer and every equivalent form of an item, rejects every near-miss
// (sign flips, off-by-one, unsimplified, original typed back), and that makeItem is deterministic.
// Usage: node tools/verify-sprint.mjs [count]
import { pathToFileURL } from 'node:url';
import { makeItem, checkSprintAnswer, FAMILIES, MAX_LEVEL, gcd, mulberry32 } from '../js/sprint.js';

/* ---------- independent evaluator ---------- */
export function ev(src, env = {}) {
  const s = String(src).replace(/[·×]/g, '*').replace(/−/g, '-').replace(/log_(\d+)\((\d+)\)/g, 'log($2,$1)');
  const toks = [];
  for (let i = 0; i < s.length;) {
    const c = s[i];
    let m;
    if (/\s/.test(c)) i++;
    else if ((m = /^\d+(\.\d+)?/.exec(s.slice(i)))) { toks.push({ t: 'n', v: Number(m[0]) }); i += m[0].length; }
    else if ((m = /^[A-Za-z][A-Za-z0-9]*/.exec(s.slice(i)))) { toks.push({ t: 'i', v: m[0] }); i += m[0].length; }
    else if ('+-*/^(),'.includes(c)) { toks.push({ t: 'o', v: c }); i++; }
    else throw new Error(`bad char ${c} in ${src}`);
  }
  let p = 0;
  const op = (v) => toks[p] && toks[p].t === 'o' && toks[p].v === v;
  const need = (v) => { if (!op(v)) throw new Error(`expected ${v} in ${src}`); p++; };
  const atom = () => {
    const k = toks[p++];
    if (!k) throw new Error(`unexpected end in ${src}`);
    if (k.t === 'n') return k.v;
    if (k.t === 'i') {
      if (k.v === 'sqrt' && op('(')) { p++; const a = expr(); need(')'); return Math.sqrt(a); }
      if (k.v === 'log' && op('(')) { p++; const a = expr(); need(','); const b = expr(); need(')'); return Math.log(a) / Math.log(b); }
      if (!Object.hasOwn(env, k.v)) throw new Error(`unknown ${k.v} in ${src}`);
      return env[k.v];
    }
    if (k.v === '(') { const e = expr(); need(')'); return e; }
    throw new Error(`unexpected ${k.v} in ${src}`);
  };
  const unary = () => { if (op('-')) { p++; return -unary(); } return pow(); };
  const pow = () => { const b = atom(); if (op('^')) { p++; return Math.pow(b, unary()); } return b; };
  const term = () => {
    let v = unary();
    for (;;) {
      if (op('*')) { p++; v *= unary(); } else if (op('/')) { p++; v /= unary(); }
      else if (toks[p] && (toks[p].t === 'i' || (toks[p].t === 'o' && toks[p].v === '('))) v *= unary(); // implicit multiplication
      else return v;
    }
  };
  const expr = () => {
    let v = term();
    while (op('+') || op('-')) { const plus = toks[p++].v === '+'; const r = term(); v = plus ? v + r : v - r; }
    return v;
  };
  const out = expr();
  if (p !== toks.length) throw new Error(`trailing tokens in ${src}`);
  return out;
}
const near = (x, y) => Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= 1e-8 * Math.max(1, Math.abs(x), Math.abs(y));
const splitRel = (math) => { const m = /^(.*?)(≤|≥|<|>|=)(.*)$/.exec(math); return m ? { l: m[1], op: m[2], r: m[3] } : null; };
const isSquarefree = (n) => { for (let k = 2; k * k <= n; k++) if (n % (k * k) === 0) return false; return n > 1; };
const ratOf = (s) => { const m = /^(-?\d+)(?:\/(\d+))?$/.exec(s); return m ? [Number(m[1]), m[2] ? Number(m[2]) : 1] : null; };

/** Verifies one item. Returns an array of error strings. */
export function verifyItem(it) {
  const errs = [];
  const fail = (m) => errs.push(`${it.id} [${it.math}] ${m}`);
  try {
    const rnd = mulberry32(7);
    const pts = (n, lo, hi) => Array.from({ length: n }, () => lo + (hi - lo) * rnd());
    const k = it.kind;
    if (k === 'factored') {
      for (const x of pts(8, -6, 6)) if (!near(ev(it.answer, { x }), ev(it.math, { x }))) { fail(`product differs from trinomial at x=${x}`); break; }
      if (!/\)\*\(/.test(it.answer)) fail('answer is not a product');
    } else if (k === 'frac' || k === 'num' || k === 'surd') {
      const eq = splitRel(it.math);
      if (eq && eq.op === '=') {
        const g = (x) => ev(eq.l, { x }) - ev(eq.r, { x });
        const root = ev(it.answer.replace(/^x=/, ''));
        if (!near(g(root), 0)) fail(`answer ${it.answer} does not solve the equation`);
        const s1 = g(1) - g(0); const s2 = g(2) - g(1);
        if (!near(s1, s2) || Math.abs(s1) < 1e-9) fail('equation is not linear with a unique solution');
      } else if (!near(ev(it.math), ev(it.answer))) fail(`expression ${ev(it.math)} != answer ${it.answer}`);
      if (k === 'frac') {
        const r = ratOf(it.answer);
        if (!r || gcd(r[0], r[1]) !== 1) fail('answer is not a lowest-terms fraction');
      }
      if (k === 'surd') {
        const m = /sqrt\((\d+)\)/.exec(it.answer);
        if (!m || !isSquarefree(Number(m[1]))) fail('radicand not squarefree');
      }
    } else if (k === 'poly' || k === 'singlefrac' || k === 'mono') {
      for (const x of pts(8, 1.3, 4.9)) {
        if (!near(ev(it.answer, { x }), ev(it.math, { x }))) { fail(`answer differs from the expression at x=${x}`); break; }
      }
    } else if (k === 'roots') {
      const eq = splitRel(it.math);
      const g = (x) => ev(eq.l, { x }) - ev(eq.r, { x });
      const roots = it.answer.split(', ').map((s) => ev(s));
      for (const r of roots) if (!near(g(r), 0)) fail(`root ${r} does not solve`);
      const A = (g(1) - 2 * g(0) + g(-1)) / 2; const B = (g(1) - g(-1)) / 2; const C = g(0);
      if (!near(g(3), A * 9 + B * 3 + C) || !near(g(-5), A * 25 - B * 5 + C)) fail('equation is not a quadratic');
      const disc = B * B - 4 * A * C;
      const want = Math.abs(disc) < 1e-9 ? 1 : disc > 0 ? 2 : 0;
      if (new Set(roots.map((r) => r.toFixed(9))).size !== want) fail(`has ${want} real roots by the discriminant`);
      let found = 0; // independent scan over rationals with denominators up to 6
      for (let q = 1; q <= 6; q++) for (let n = -80 * q; n <= 80 * q; n++) if (gcd(n, q) === 1 && Math.abs(g(n / q)) < 1e-9) found++;
      if (found !== want) fail(`scan finds ${found} rational roots, expected ${want}`);
    } else if (k === 'expr') {
      const eq = splitRel(it.math);
      const names = [...new Set(it.math.match(/[A-Za-z][A-Za-z0-9]*/g))].filter((v) => v !== it.target);
      let good = 0;
      for (let i = 0; i < 8; i++) {
        const env = Object.fromEntries(names.map((v) => [v, 1.5 + 7 * rnd()]));
        const val = ev(it.answer, env);
        if (!Number.isFinite(val)) continue;
        good++;
        env[it.target] = val;
        if (!near(ev(eq.l, env), ev(eq.r, env))) { fail(`answer does not satisfy the formula (${JSON.stringify(env)})`); break; }
      }
      if (good < 4) fail('too few finite sample points');
    } else if (k === 'ineq') {
      const rel = splitRel(it.math);
      const sol = /^x(<=|>=|<|>)(-?\d+)$/.exec(it.answer);
      const x0 = Number(sol[2]);
      const holds = (op, a, b) => ({ '<': a < b, '>': a > b, '≤': a <= b + 1e-12, '≥': a >= b - 1e-12 }[op]);
      const claim = (x) => holds(sol[1].replace('<=', '≤').replace('>=', '≥'), x, x0);
      const orig = (x) => holds(rel.op, ev(rel.l, { x }), ev(rel.r, { x }));
      for (const x of [x0 - 7, x0 - 1, x0 - 0.01, x0, x0 + 0.01, x0 + 1, x0 + 7]) {
        if (claim(x) !== orig(x)) { fail(`claimed solution set disagrees with the inequality at x=${x}`); break; }
      }
    } else fail(`unknown kind ${k}`);

    // checker behaviour
    const acc = checkSprintAnswer(it, it.answer);
    if (!acc.valid || !acc.correct) fail(`canonical answer rejected (${JSON.stringify(acc)})`);
    for (const e of it.equiv || []) {
      const r = checkSprintAnswer(it, e);
      if (!r.valid || !r.correct) fail(`equivalent form "${e}" rejected (${JSON.stringify(r)})`);
    }
    for (const w of it.wrong || []) {
      const r = checkSprintAnswer(it, w);
      if (r.valid && r.correct) fail(`near-miss "${w}" accepted`);
    }
    if (!(it.wrong || []).length) fail('item has no near-miss to test');
  } catch (e) {
    fail(`exception: ${e.message}`);
  }
  return errs;
}

export function verifyAll(count = 2000) {
  const combos = [];
  for (const f of FAMILIES) for (let l = 1; l <= MAX_LEVEL; l++) combos.push([f.id, l]);
  const errs = [];
  const counts = {};
  for (let i = 0; i < count; i++) {
    const [fam, lvl] = combos[i % combos.length];
    const seed = 1000 + Math.floor(i / combos.length) * 7919 + i;
    const it = makeItem(fam, lvl, seed);
    const again = makeItem(fam, lvl, seed);
    if (JSON.stringify(it) !== JSON.stringify(again)) errs.push(`${it.id} not deterministic`);
    counts[`${fam}-${lvl}`] = (counts[`${fam}-${lvl}`] || 0) + 1;
    errs.push(...verifyItem(it));
  }
  return { errs, counts, items: count };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const n = Number(process.argv[2]) || 2000;
  const { errs, counts } = verifyAll(n);
  console.log(`sprint items: ${n}, combos: ${Object.keys(counts).length}, min per combo: ${Math.min(...Object.values(counts))}`);
  if (errs.length) {
    console.error(`${errs.length} problem(s):`);
    for (const e of errs.slice(0, 40)) console.error(' -', e);
    process.exit(1);
  }
  console.log('OK');
}

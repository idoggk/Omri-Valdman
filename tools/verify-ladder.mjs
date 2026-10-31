// Independent verifier for the INLINE items of data/ladder.json (exam ladder, graph-reading stage S3).
// It never uses an item's closed form. Every body is stepped numerically (dt = 0.001) and every root,
// maximum and meeting time is found by scanning for a sign change and bisecting. Then it checks:
//  (a) every stored answer equals the simulated value of its query (verify.queries[i]),
//  (b) the data the graph draws (series polynomials, marked points, landing time) equals the simulation,
//  (c) the statement, title and tips do not contain the numbers marked graphOnly (they exist only in the figure),
//  (d) structure rules: id lad-s3-NN, 3 tips, Hebrew units, answers with <= 2 decimals, tolerance <= 2%, lettered parts.
// Usage: node tools/verify-ladder.mjs [data/ladder.json]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { seriesSamples, polyAt, ladderDiagram, validateSvg, layoutIssues } from './diagrams.mjs';

export const G = 10;
const DT = 0.001;
const TMAX = 20;

// ---------------------------------------------------------------- numeric simulator
/** body = { id, p0, v0, a }: position p (height or x), velocity v, constant acceleration a. */
export function trace(b) {
  const n = Math.round(TMAX / DT);
  const P = new Float64Array(n + 1);
  const V = new Float64Array(n + 1);
  let p = b.p0, v = b.v0;
  for (let i = 0; i <= n; i++) {
    P[i] = p; V[i] = v;
    p += v * DT + 0.5 * b.a * DT * DT; // exact step for constant acceleration
    v += b.a * DT;
  }
  return { b, P, V };
}
export function stateAt(tr, t) {
  const i = Math.min(Math.floor(t / DT + 1e-9), tr.P.length - 1);
  const h = t - i * DT;
  return { p: tr.P[i] + tr.V[i] * h + 0.5 * tr.b.a * h * h, v: tr.V[i] + tr.b.a * h };
}
/** First t > 0 where f changes sign (scan + bisection); null if none within TMAX. */
export function firstCross(f) {
  let prev = null, prevT = 0;
  for (let i = 0; i * DT <= TMAX; i++) {
    const t = i * DT, x = f(t);
    if (x === 0 && prev !== null && prev !== 0) return t;
    if (prev !== null && prev !== 0 && x !== 0 && Math.sign(x) !== Math.sign(prev)) {
      let lo = prevT, hi = t;
      for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (Math.sign(f(mid)) === Math.sign(prev)) lo = mid; else hi = mid; }
      return (lo + hi) / 2;
    }
    if (x !== 0) { prev = x; prevT = t; }
  }
  return null;
}
const integrate = (tr, t0, t1, fn) => {
  let s = 0;
  const i0 = Math.round(t0 / DT), i1 = Math.round(t1 / DT);
  for (let i = i0; i < i1; i++) s += ((fn(tr.V[i]) + fn(tr.V[i + 1])) / 2) * DT;
  return s;
};

/** Evaluates one query against the simulated bodies. */
export function evalQuery(q, tr, floor) {
  const T = (id) => {
    if (!tr[id]) throw new Error(`unknown body "${id}"`);
    return tr[id];
  };
  const landT = (id) => firstCross((t) => stateAt(T(id), t).p - (floor ?? 0));
  const peakT = (id) => firstCross((t) => stateAt(T(id), t).v);
  switch (q.q) {
    case 'p0': return T(q.body).P[0];
    case 'v0': return T(q.body).V[0];
    case 'accel': return stateAt(T(q.body), 1).v - stateAt(T(q.body), 0).v;
    case 'peakT': return peakT(q.body);
    case 'peakP': return stateAt(T(q.body), peakT(q.body)).p;
    case 'rise': return stateAt(T(q.body), peakT(q.body)).p - T(q.body).P[0];
    case 'landT': return landT(q.body);
    case 'backT': return firstCross((t) => stateAt(T(q.body), t).p - T(q.body).P[0]);
    case 'landV': return stateAt(T(q.body), landT(q.body)).v;
    case 'landSpeed': return Math.abs(stateAt(T(q.body), landT(q.body)).v);
    case 'landDiff': return Math.abs(landT(q.a) - landT(q.b));
    case 'at': return stateAt(T(q.body), q.t)[q.what];
    case 'avgV': return (stateAt(T(q.body), q.t1).p - stateAt(T(q.body), q.t0).p) / (q.t1 - q.t0);
    case 'area': return (q.neg ? -1 : 1) * integrate(T(q.body), q.t0, q.t1, (v) => v);
    case 'path': return integrate(T(q.body), q.t0, q.t1, Math.abs);
    case 'gap': return Math.abs(stateAt(T(q.a), q.t).p - stateAt(T(q.b), q.t).p);
    case 'equalVT': return firstCross((t) => stateAt(T(q.a), t).v - stateAt(T(q.b), t).v);
    case 'meetT': return firstCross((t) => stateAt(T(q.a), t).p - stateAt(T(q.b), t).p);
    case 'meetP': {
      const t = firstCross((x) => stateAt(T(q.a), x).p - stateAt(T(q.b), x).p);
      return t === null ? null : stateAt(T(q.a), t).p;
    }
    case 'vAtMeet': {
      const t = firstCross((x) => stateAt(T(q.a), x).p - stateAt(T(q.b), x).p);
      return t === null ? null : stateAt(T(q.body), t).v;
    }
    case 'pAtMeet': {
      const t = firstCross((x) => stateAt(T(q.a), x).p - stateAt(T(q.b), x).p);
      return t === null ? null : stateAt(T(q.body), t).p - T(q.body).P[0];
    }
    default: throw new Error(`unknown query "${q.q}"`);
  }
}

// ---------------------------------------------------------------- structure helpers
const HEBREW = /[֐-׿]/;
const DECIMAL = /^-?\d+(\.\d{1,2})?$/;
const LATIN_UNIT = /(\d|^)\s*(km\/h|m\/s²?|m\/s\^2|km|m|s)(?![\p{L}\d])/iu;
const COMPLEX = /מרוכב|דמיוני|שורש\s+של\s+מינוס|imaginary|complex/i;
const PART_LETTERS = ['א', 'ב', 'ג', 'ד', 'ה'];
const stripTags = (s) => String(s).replace(/<[^>]*>/g, ' ').replace(/[⁦-⁩‎‏]/g, '');
const numbersIn = (s) => (stripTags(s).match(/(?<![\p{L}\d.])\d+(?:\.\d+)?(?![\p{L}\d]|\.\d)/gu) || []).map(Number);
const nonEmpty = (s) => typeof s === 'string' && s.trim().length > 0;
const heb = (s) => nonEmpty(s) && HEBREW.test(s);
const close = (a, b, eps) => Math.abs(a - b) <= eps;

export function checkItem(it) {
  const errs = [];
  const where = it && it.id ? it.id : '?';
  const err = (m) => errs.push(`${where}: ${m}`);
  if (!it || typeof it !== 'object') return [`${where}: not an object`];
  if (!/^lad-s3-\d{2}$/.test(it.id || '')) err('bad id (expected lad-s3-NN)');
  if (!['phys-vertical', 'phys-horizontal'].includes(it.topic)) err('bad topic');
  if (it.level !== 3) err('level must be 3');
  if (!heb(it.title)) err('title missing or not Hebrew');
  if (!heb(it.statement)) err('statement missing or not Hebrew');
  if (!Array.isArray(it.tips) || it.tips.length !== 3) err('tips must have exactly 3 items');
  else it.tips.forEach((t, i) => heb(t) || err(`tip ${i + 1} empty or not Hebrew`));
  if (!Array.isArray(it.solution) || it.solution.length < 4) err('solution needs at least 4 steps');
  else it.solution.forEach((s, i) => heb(s) || err(`solution step ${i + 1} empty or not Hebrew`));
  const texts = [['title', it.title], ['statement', it.statement], ...(it.tips || []).map((t, i) => [`tip ${i + 1}`, t]), ...(it.solution || []).map((s, i) => [`solution step ${i + 1}`, s])];
  for (const [f, t] of texts) {
    if (typeof t !== 'string') continue;
    if (LATIN_UNIT.test(stripTags(t))) err(`${f}: Latin unit label, use Hebrew units`);
    if (COMPLEX.test(stripTags(t))) err(`${f}: complex-number wording`);
  }
  const inputs = it.inputs;
  if (!Array.isArray(inputs) || inputs.length < 3 || inputs.length > 5) { err('3-5 lettered parts (inputs) required'); return errs; }
  const plainStatement = stripTags(it.statement || '');
  const marker = (l) => new RegExp(`(?<![א-ת])${l}\.`);
  inputs.forEach((inp, i) => { if (!marker(PART_LETTERS[i]).test(plainStatement)) err(`statement lacks part marker "${PART_LETTERS[i]}."`); });
  if (PART_LETTERS[inputs.length] && marker(PART_LETTERS[inputs.length]).test(plainStatement)) err('statement has more lettered parts than inputs');
  if (typeof it.diagram !== 'string' || !it.diagram) err('diagram missing');
  else validateSvg(it.diagram).forEach((m) => err(`diagram: ${m}`));
  const v = it.verify;
  if (!v || !Array.isArray(v.bodies) || !Array.isArray(v.queries) || !Array.isArray(v.graphOnly)) { err('verify {bodies, queries, graphOnly} missing'); return errs; }
  if (v.queries.length !== inputs.length) { err('verify.queries must have one entry per input'); return errs; }
  const g = it.graph;
  if (!g || !['yt', 'vt', 'xt'].includes(g.kind) || !Array.isArray(g.series) || !g.series.length) { err('graph {kind, series} missing'); return errs; }

  // simulator
  const tr = {};
  for (const b of v.bodies) {
    if (![b.p0, b.v0, b.a].every(Number.isFinite) || !nonEmpty(b.id)) { err('body needs id, p0, v0, a'); return errs; }
    if (it.topic === 'phys-vertical' && b.a !== -G) err(`body ${b.id}: vertical bodies must have a = -${G}`);
    tr[b.id] = trace(b);
  }
  const floor = it.topic === 'phys-vertical' ? 0 : null;

  // (a) answers vs simulator
  inputs.forEach((inp, i) => {
    if (!heb(inp.label)) err(`part ${i + 1}: label missing or not Hebrew`);
    if (!nonEmpty(inp.unit) || !HEBREW.test(inp.unit) || LATIN_UNIT.test(inp.unit)) err(`part ${i + 1}: unit must be a Hebrew unit label`);
    if (!DECIMAL.test(String(inp.answer))) return err(`part ${i + 1}: answer "${inp.answer}" must be a plain decimal with at most 2 decimals`);
    const a = Number(inp.answer);
    if (a === 0) err(`part ${i + 1}: answer 0 cannot carry a relative tolerance`);
    if (typeof inp.tolerance !== 'number' || !(inp.tolerance > 0)) err(`part ${i + 1}: tolerance must be > 0`);
    else if (inp.tolerance > 0.02 * Math.abs(a) + 1e-12) err(`part ${i + 1}: tolerance ${inp.tolerance} exceeds 2% of ${a}`);
    let sim;
    try { sim = evalQuery(v.queries[i], tr, floor); } catch (e) { return err(`part ${i + 1}: query failed: ${e.message}`); }
    if (!Number.isFinite(sim)) return err(`part ${i + 1}: simulation found no finite value`);
    if (!close(sim, a, 0.005) || !close(sim, a, inp.tolerance ?? 0)) err(`part ${i + 1}: stored answer ${a} differs from simulated ${Math.round(sim * 1e4) / 1e4}`);
    if (it.tips && numbersIn(it.tips.join(' ')).includes(Math.abs(a))) err(`part ${i + 1}: a tip contains the answer ${a}`);
  });

  // (b) graph data equals the simulation
  const quantity = g.kind === 'vt' ? 'v' : 'p';
  const seen = new Set();
  g.series.forEach((s, si) => {
    const t = tr[s.body];
    if (!t) return err(`series ${si + 1}: unknown body "${s.body}"`);
    const pts = seriesSamples(s, 0.25);
    if (pts.length < 3) err(`series ${si + 1}: too few samples`);
    for (const [x, y] of pts) {
      const want = stateAt(t, x)[quantity];
      if (!close(want, y, 1e-6)) { err(`series ${si + 1}: plotted ${y} at t=${x} but the simulation gives ${Math.round(want * 1e6) / 1e6}`); break; }
      if (g.kind === 'yt' && floor !== null && y < floor - 1e-9) { err(`series ${si + 1}: plotted below the ground at t=${x}`); break; }
    }
    if (s.endsAtFloor) {
      const lt = firstCross((x) => stateAt(t, x).p - (floor ?? 0));
      if (lt === null || !close(lt, s.t1, 1e-3)) err(`series ${si + 1}: marked as ending at the ground but lands at ${lt}`);
    }
    seen.add(si);
  });
  (g.marks || []).forEach((m, mi) => {
    const s = g.series[m.s || 0];
    const t = s && tr[s.body];
    if (!t) return err(`mark ${mi + 1}: unknown series`);
    const want = stateAt(t, m.t)[quantity];
    if (!close(want, m.y, 1e-6)) err(`mark ${mi + 1}: (${m.t}, ${m.y}) is not on the simulated curve (value ${Math.round(want * 1e6) / 1e6})`);
    if (m.label && /\d/.test(m.label)) err(`mark ${mi + 1}: label must not print numbers`);
  });

  // (c) graph-only numbers appear in the figure but not in the text
  if (v.graphOnly.length < 3) err('graphOnly needs at least 3 source values');
  const visible = new Set();
  (g.marks || []).forEach((m) => { visible.add(Math.abs(m.t)); visible.add(Math.abs(m.y)); });
  g.series.forEach((s) => (s.fn || []).forEach((c) => visible.add(Math.abs(c))));
  const hidden = [['title', it.title], ['statement', it.statement], ...(it.tips || []).map((t, i) => [`tip ${i + 1}`, t])];
  for (const n of v.graphOnly) {
    if (!Number.isFinite(n)) { err(`graphOnly value ${n} is not a number`); continue; }
    if (!visible.has(Math.abs(n))) err(`graphOnly value ${n} is not visible in the graph (marks or series)`);
    for (const [f, t] of hidden) if (numbersIn(t).includes(Math.abs(n))) err(`${f} contains the graph-only number ${n}`);
  }

  // diagram stored equals the generated one and is overlap-free
  try {
    const d = ladderDiagram(it);
    if (d.replace(/\r\n?/g, '\n') !== String(it.diagram).replace(/\r\n?/g, '\n')) err('stored diagram differs from the generated one (run node tools/diagrams.mjs --write)');
    layoutIssues(d).forEach((m) => err(`diagram layout: ${m}`));
  } catch (e) { err(`diagram generation failed: ${e.message}`); }
  return errs;
}

/** Inline items = stage items without a ref. */
export const inlineItems = (data) => ((data && data.stages) || []).flatMap((st) => (st.items || []).filter((it) => it && !it.ref).map((it) => ({ stage: st.id, it })));

export function checkLadder(data) {
  const errs = [];
  const seen = new Set();
  for (const { stage, it } of inlineItems(data)) {
    if (seen.has(it.id)) errs.push(`${it.id}: duplicate id`);
    seen.add(it.id);
    if (stage !== 'S3') errs.push(`${it.id}: inline items are only verified for S3 (found in ${stage})`);
    errs.push(...checkItem(it));
  }
  return errs;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const file = process.argv[2] || fileURLToPath(new URL('../data/ladder.json', import.meta.url));
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const n = inlineItems(data).length;
  const errs = checkLadder(data);
  if (errs.length) {
    console.error(`FAILED: ${errs.length} problem(s)`);
    errs.forEach((e) => console.error(' - ' + e));
    process.exit(1);
  }
  console.log(`OK: ${n} inline ladder items verified by simulation (answers, graph data, graph-only numbers, structure)`);
}

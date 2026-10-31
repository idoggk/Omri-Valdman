// Independent verifier for the INLINE items of data/ladder.json (exam ladder, graph-reading stage S3, angled launch stage S4, two-body meetings S5).
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
import { seriesSamples, polyAt, ladderDiagram, validateSvg, layoutIssues, DUO_KINDS } from './diagrams.mjs';

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

// ---------------------------------------------------------------- stage S4 (angled launch, speed and direction)
// A body is { id, x0, y0, vx, vy } (components at t = 0; g = 10 downward). Both axes are stepped numerically with trace().
// A query is { body, what, at } with what in t|x|y|vx|vy|speed|ang and at in 'start'|'land'|'peak'|{ t }|{ x },
// or { op: 'diff', a, b } (|a - b|). ang = atan2(vy, vx) in degrees: positive above the horizontal, negative below.
const S4_DIRECTION_RULE = 'כיוון המהירות = זווית מעל (+) או מתחת (−) לאופק';
export function traceBody(b) {
  return { b, X: trace({ id: b.id, p0: b.x0, v0: b.vx, a: 0 }), Y: trace({ id: b.id, p0: b.y0, v0: b.vy, a: -G }) };
}
const s4At = (tb, t) => {
  const x = stateAt(tb.X, t), y = stateAt(tb.Y, t);
  return { t, x: x.p, y: y.p, vx: x.v, vy: y.v, speed: Math.hypot(x.v, y.v), ang: (Math.atan2(y.v, x.v) * 180) / Math.PI };
};
export function evalS4(q, tbs) {
  if (q.op === 'diff') return Math.abs(evalS4(q.a, tbs) - evalS4(q.b, tbs));
  const tb = tbs[q.body];
  if (!tb) throw new Error(`unknown body "${q.body}"`);
  let t;
  if (q.at === 'start') t = 0;
  else if (q.at === 'land') t = firstCross((s) => stateAt(tb.Y, s).p);
  else if (q.at === 'peak') t = firstCross((s) => stateAt(tb.Y, s).v);
  else if (q.at && Number.isFinite(q.at.t)) t = q.at.t;
  else if (q.at && Number.isFinite(q.at.x)) t = firstCross((s) => stateAt(tb.X, s).p - q.at.x);
  else throw new Error('bad "at"');
  if (t === null) return null;
  if (q.what === 'drop') return tb.b.y0 - s4At(tb, t).y;
  const st = s4At(tb, t);
  if (!(q.what in st)) throw new Error(`unknown quantity "${q.what}"`);
  return st[q.what];
}

export function checkItemS4(it) {
  const errs = [];
  const where = it && it.id ? it.id : '?';
  const err = (m) => errs.push(`${where}: ${m}`);
  if (!it || typeof it !== 'object') return [`${where}: not an object`];
  if (!/^lad-s4-\d{2}$/.test(it.id || '')) err('bad id (expected lad-s4-NN)');
  if (it.topic !== 'phys-horizontal') err('bad topic');
  if (it.level !== 4) err('level must be 4');
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
  if (!Array.isArray(inputs) || inputs.length < 4 || inputs.length > 5) { err('4-5 lettered parts (inputs) required'); return errs; }
  const plainStatement = stripTags(it.statement || '');
  const marker = (l) => new RegExp(`(?<![א-ת])${l}\\.`);
  inputs.forEach((inp, i) => { if (!marker(PART_LETTERS[i]).test(plainStatement)) err(`statement lacks part marker "${PART_LETTERS[i]}."`); });
  if (PART_LETTERS[inputs.length] && marker(PART_LETTERS[inputs.length]).test(plainStatement)) err('statement has more lettered parts than inputs');
  if (!/g = 10/.test(plainStatement)) err('statement must state g = 10');
  const asksDirection = inputs.some((inp) => /כיוון/.test(inp.label || ''));
  if (asksDirection && !plainStatement.includes(S4_DIRECTION_RULE)) err('a direction part needs the sign-convention line in the statement');
  if (typeof it.diagram !== 'string' || !it.diagram) err('diagram missing');
  else validateSvg(it.diagram).forEach((m) => err(`diagram: ${m}`));
  const v = it.verify;
  if (!v || !Array.isArray(v.bodies) || !Array.isArray(v.queries)) { err('verify {bodies, queries} missing'); return errs; }
  if (v.queries.length !== inputs.length) { err('verify.queries must have one entry per input'); return errs; }

  const tbs = {};
  for (const b of v.bodies) {
    if (![b.x0, b.y0, b.vx, b.vy].every(Number.isFinite) || !nonEmpty(b.id)) { err('body needs id, x0, y0, vx, vy'); return errs; }
    if (!(b.vx > 0)) err(`body ${b.id}: vx must be > 0`);
    tbs[b.id] = traceBody(b);
  }
  inputs.forEach((inp, i) => {
    const angle = inp.unit === 'מעלות';
    if (!heb(inp.label)) err(`part ${i + 1}: label missing or not Hebrew`);
    if (!nonEmpty(inp.unit) || !HEBREW.test(inp.unit) || LATIN_UNIT.test(inp.unit)) err(`part ${i + 1}: unit must be a Hebrew unit label`);
    if (!DECIMAL.test(String(inp.answer))) return err(`part ${i + 1}: answer "${inp.answer}" must be a plain decimal with at most 2 decimals (ASCII minus)`);
    const a = Number(inp.answer);
    if (a === 0) err(`part ${i + 1}: answer 0 cannot carry a relative tolerance`);
    if (typeof inp.tolerance !== 'number' || !(inp.tolerance > 0)) err(`part ${i + 1}: tolerance must be > 0`);
    else if (angle && inp.tolerance > 0.5) err(`part ${i + 1}: angle tolerance ${inp.tolerance} exceeds 0.5 degrees`);
    else if (!angle && inp.tolerance > 0.02 * Math.abs(a) + 1e-12) err(`part ${i + 1}: tolerance ${inp.tolerance} exceeds 2% of ${a}`);
    if (angle && Math.abs(a) > 90) err(`part ${i + 1}: angle ${a} outside -90..90`);
    if (!angle && /^(כיוון|הזווית|זווית)/.test(inp.label || '')) err(`part ${i + 1}: an angle part must use the unit מעלות`);
    let sim;
    try { sim = evalS4(v.queries[i], tbs); } catch (e) { return err(`part ${i + 1}: query failed: ${e.message}`); }
    if (!Number.isFinite(sim)) return err(`part ${i + 1}: simulation found no finite value`);
    if (!close(sim, a, 0.005) || !close(sim, a, inp.tolerance ?? 0)) err(`part ${i + 1}: stored answer ${a} differs from simulated ${Math.round(sim * 1e4) / 1e4}`);
    if (angle && (Math.sign(sim) !== Math.sign(a))) err(`part ${i + 1}: angle sign differs from the simulation`);
    if (it.tips && numbersIn(it.tips.join(' ')).includes(Math.abs(a))) err(`part ${i + 1}: a tip contains the answer ${a}`);
  });
  // every stated angle / speed must match the body that is simulated
  for (const [ci, c] of (v.claims || []).entries()) {
    let sim;
    try { sim = evalS4(c.q, tbs); } catch (e) { err(`claim ${ci + 1}: ${e.message}`); continue; }
    if (!Number.isFinite(sim) || !close(sim, c.value, c.tol)) err(`claim ${ci + 1}: statement value ${c.value} but the simulation gives ${Math.round(sim * 1e4) / 1e4}`);
  }
  if (v.target) {
    const A = tbs.A;
    const t = A && firstCross((s) => stateAt(A.X, s).p - v.target.x);
    if (t === null || !A) err('target: the body never reaches the target distance');
    else {
      const st = s4At(A, t);
      if (!close(st.y, v.target.y, 0.01)) err(`target: at x = ${v.target.x} the body is at height ${Math.round(st.y * 1e3) / 1e3}, not ${v.target.y}`);
      if (v.target.descending && !(st.vy < 0)) err('target: the body must be descending at the target');
      if (!it.scene || !it.scene.target || it.scene.target.x !== v.target.x || it.scene.target.y !== v.target.y) err('target: the scene must draw the same target');
    }
  }
  if (v.sameLand) {
    const [a, b] = v.sameLand.map((id) => tbs[id]);
    const xa = a && evalS4({ body: v.sameLand[0], what: 'x', at: 'land' }, tbs), xb = b && evalS4({ body: v.sameLand[1], what: 'x', at: 'land' }, tbs);
    if (!close(xa, xb, 0.01)) err(`sameLand: ranges differ (${xa} vs ${xb})`);
  }
  // the drawing follows the simulated body
  const sc = it.scene, A = v.bodies[0];
  if (!sc || sc.vx !== A.vx || sc.vy !== A.vy || (sc.h0 || 0) !== A.y0) err('scene shape must equal the first simulated body (h0, vx, vy)');
  else {
    try {
      const d = ladderDiagram(it);
      if (d.replace(/\r\n?/g, '\n') !== String(it.diagram).replace(/\r\n?/g, '\n')) err('stored diagram differs from the generated one (run node tools/diagrams.mjs --write)');
      layoutIssues(d).forEach((m) => err(`diagram layout: ${m}`));
    } catch (e) { err(`diagram generation failed: ${e.message}`); }
    const label = Object.values(sc.labels || {}).join(' ');
    if (sc.labels && sc.labels.ang && Math.abs(A.vy) > 0 && !sc.labels.ang.includes(String(Math.round(Math.abs(Math.atan2(A.vy, A.vx) * 180 / Math.PI))))) err('scene angle label does not match the launch angle');
    if (!label) err('scene has no labels');
  }
  return errs;
}

// ---------------------------------------------------------------- stage S5 (two bodies, meetings)
// A body is { id, x0, y0, vx, vy, ax = 0, ay = -10, t0 = 0 }: each axis has constant acceleration; a body with t0 > 0 waits at
// (x0, y0) until t0 and then moves (a car starting later). Both axes are stepped numerically (dt = 0.001).
// verify.meet = { a, b, axis: 'x'|'y' } defines "the meeting": the first sign change (scan + bisection) of the separation along
// `axis`, accepted only if the other coordinate agrees there (<= 0.01) and, for thrown bodies (verify.floor), both are still above the ground.
// Queries: { body, what: t|x|y|vx|vy|speed|ang, at } with at = 'start' | 'meet' | 'peak' | { t } | { land: id } | { equalV: [a, b] },
//          { op: 'meets' } (1 = yes, 2 = no), { op: 'maxGap', a, b, axis } (largest separation before the meeting).
export function traceDuo(b) {
  return { b, t0: b.t0 || 0, X: trace({ id: b.id, p0: b.x0, v0: b.vx, a: b.ax || 0 }), Y: trace({ id: b.id, p0: b.y0, v0: b.vy, a: b.ay ?? -G }) };
}
const duoAt = (tb, t) => {
  const waiting = t < tb.t0, tt = waiting ? 0 : t - tb.t0;
  const x = stateAt(tb.X, tt), y = stateAt(tb.Y, tt);
  const vx = waiting ? 0 : x.v, vy = waiting ? 0 : y.v;
  return { t, x: x.p, y: y.p, vx, vy, speed: Math.hypot(vx, vy), ang: (Math.atan2(vy, vx) * 180) / Math.PI };
};
const duoPos = (tb, axis, t) => duoAt(tb, t)[axis];
/** { t, ok }: first time the separation along m.axis changes sign, and whether the bodies really coincide there. */
export function duoMeeting(m, tbs, floor) {
  const A = tbs[m.a], B = tbs[m.b];
  const other = m.axis === 'x' ? 'y' : 'x';
  const t = firstCross((s) => duoPos(A, m.axis, s) - duoPos(B, m.axis, s));
  if (t === null) return { t: null, ok: false };
  const sa = duoAt(A, t), sb = duoAt(B, t);
  let ok = Math.abs(sa[other] - sb[other]) <= 0.01;
  if (floor && (sa.y < -1e-6 || sb.y < -1e-6)) ok = false;
  return { t, ok };
}
export function evalS5(q, tbs, v) {
  const floor = !!v.floor;
  const mt = () => duoMeeting(v.meet, tbs, floor);
  if (q.op === 'meets') return mt().ok ? 1 : 2;
  if (q.op === 'gapAt') return Math.abs(duoPos(tbs[q.a], q.axis, q.t) - duoPos(tbs[q.b], q.axis, q.t));
  if (q.op === 'maxGap') {
    const m = mt();
    if (!m.ok) return null;
    let best = 0;
    for (let i = 0; i * DT <= m.t; i++) best = Math.max(best, Math.abs(duoPos(tbs[q.a], q.axis, i * DT) - duoPos(tbs[q.b], q.axis, i * DT)));
    return best;
  }
  const tb = tbs[q.body];
  if (!tb) throw new Error(`unknown body "${q.body}"`);
  let t;
  if (q.at === 'start') t = 0;
  else if (q.at === 'meet') { const m = mt(); t = m.ok ? m.t : null; }
  else if (q.at === 'peak') t = firstCross((s) => duoAt(tb, s).vy);
  else if (q.at && Number.isFinite(q.at.t)) t = q.at.t;
  else if (q.at && q.at.land) { const l = tbs[q.at.land]; if (!l) throw new Error(`unknown body "${q.at.land}"`); t = firstCross((s) => duoAt(l, s).y); }
  else if (q.at && Array.isArray(q.at.equalV)) { const [a, b] = q.at.equalV.map((id) => tbs[id]); t = firstCross((s) => duoAt(a, s).vx - duoAt(b, s).vx); }
  else throw new Error('bad "at"');
  if (t === null) return null;
  const st = duoAt(tb, t);
  if (!(q.what in st) && q.what !== 'fall') throw new Error(`unknown quantity "${q.what}"`);
  return q.what === 'fall' ? duoAt(tb, 0).y - st.y : st[q.what];
}

export function checkItemS5(it) {
  const errs = [];
  const where = it && it.id ? it.id : '?';
  const err = (m) => errs.push(`${where}: ${m}`);
  if (!it || typeof it !== 'object') return [`${where}: not an object`];
  if (!/^lad-s5-\d{2}$/.test(it.id || '')) err('bad id (expected lad-s5-NN)');
  if (!['phys-vertical', 'phys-horizontal'].includes(it.topic)) err('bad topic');
  if (it.level !== 5) err('level must be 5');
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
  if (!Array.isArray(inputs) || inputs.length < 4 || inputs.length > 5) { err('4-5 lettered parts (inputs) required'); return errs; }
  const plainStatement = stripTags(it.statement || '');
  const marker = (l) => new RegExp(`(?<![א-ת])${l}\\.`);
  inputs.forEach((inp, i) => { if (!marker(PART_LETTERS[i]).test(plainStatement)) err(`statement lacks part marker "${PART_LETTERS[i]}."`); });
  if (PART_LETTERS[inputs.length] && marker(PART_LETTERS[inputs.length]).test(plainStatement)) err('statement has more lettered parts than inputs');
  if (!(it.scene && it.scene.kind === 'cars') && !/g = 10/.test(plainStatement)) err('statement must state g = 10');
  if (inputs.some((inp) => /כיוון/.test(inp.label || '') && inp.unit === 'מעלות') && !plainStatement.includes(S4_DIRECTION_RULE)) err('a direction part needs the sign-convention line in the statement');
  if (inputs.some((inp) => /בסימן/.test(inp.label || '')) && !/כיוון חיובי/.test(plainStatement)) err('a signed-velocity part needs "כיוון חיובי ..." in the statement');
  const yesNo = (inp) => /נפגשים/.test(inp.label || '');
  if (inputs.some(yesNo) && !(/1 = כן/.test(plainStatement) && /2 = לא/.test(plainStatement))) err('a yes/no part must tell how to enter it ("1 = כן", "2 = לא") in the statement');
  const v = it.verify;
  const noPair = it.scene && it.scene.kind === 'tower3'; // three independent stones: no pair to meet
  if (!v || !Array.isArray(v.bodies) || !Array.isArray(v.queries) || (!v.meet && !noPair)) { err('verify {bodies, queries, meet} missing'); return errs; }
  if (v.queries.length !== inputs.length) { err('verify.queries must have one entry per input'); return errs; }
  const tbs = {};
  for (const b of v.bodies) {
    if (![b.x0, b.y0, b.vx, b.vy].every(Number.isFinite) || !nonEmpty(b.id)) { err('body needs id, x0, y0, vx, vy'); return errs; }
    tbs[b.id] = traceDuo(b);
  }
  if (!noPair && (!tbs[v.meet.a] || !tbs[v.meet.b] || !['x', 'y'].includes(v.meet.axis))) { err('verify.meet {a, b, axis} must name two bodies and an axis'); return errs; }
  inputs.forEach((inp, i) => {
    const angle = inp.unit === 'מעלות';
    if (!heb(inp.label)) err(`part ${i + 1}: label missing or not Hebrew`);
    if (!nonEmpty(inp.unit) || !HEBREW.test(inp.unit) || LATIN_UNIT.test(inp.unit)) err(`part ${i + 1}: unit must be a Hebrew unit label`);
    if (!DECIMAL.test(String(inp.answer))) return err(`part ${i + 1}: answer "${inp.answer}" must be a plain decimal with at most 2 decimals (ASCII minus)`);
    const a = Number(inp.answer);
    if (a === 0) err(`part ${i + 1}: answer 0 cannot carry a relative tolerance`);
    if (typeof inp.tolerance !== 'number' || !(inp.tolerance > 0)) err(`part ${i + 1}: tolerance must be > 0`);
    else if (angle && inp.tolerance > 0.5) err(`part ${i + 1}: angle tolerance ${inp.tolerance} exceeds 0.5 degrees`);
    else if (!angle && inp.tolerance > 0.02 * Math.abs(a) + 1e-12) err(`part ${i + 1}: tolerance ${inp.tolerance} exceeds 2% of ${a}`);
    if (angle && Math.abs(a) > 90) err(`part ${i + 1}: angle ${a} outside -90..90`);
    if (yesNo(inp) && ![1, 2].includes(a)) err(`part ${i + 1}: a yes/no answer must be 1 or 2`);
    let sim;
    try { sim = evalS5(v.queries[i], tbs, v); } catch (e) { return err(`part ${i + 1}: query failed: ${e.message}`); }
    if (!Number.isFinite(sim)) return err(`part ${i + 1}: simulation found no finite value`);
    if (!close(sim, a, 0.005) || !close(sim, a, inp.tolerance ?? 0)) err(`part ${i + 1}: stored answer ${a} differs from simulated ${Math.round(sim * 1e4) / 1e4}`);
    if (angle && Math.sign(sim) !== Math.sign(a)) err(`part ${i + 1}: angle sign differs from the simulation`);
    if (yesNo(inp) && !v.queries[i].op) err(`part ${i + 1}: the yes/no part must be verified with { op: 'meets' }`);
    if (it.tips && numbersIn(it.tips.join(' ')).includes(Math.abs(a))) err(`part ${i + 1}: a tip contains the answer ${a}`);
  });
  // an item that claims the bodies never meet is checked against the whole flight: closest approach while both are airborne
  const m = noPair ? { ok: true } : duoMeeting(v.meet, tbs, !!v.floor);
  if (v.noMeet) {
    if (m.ok) err(`noMeet: the simulation finds a meeting at t = ${Math.round(m.t * 1e3) / 1e3}`);
    const end = Math.min(...Object.values(tbs).map((tb) => (v.floor ? firstCross((s) => duoAt(tb, s).y) : null) ?? Infinity));
    if (!Number.isFinite(end)) err('noMeet: needs thrown bodies with a landing time');
    else {
      let min = Infinity;
      for (let i = 0; i * DT <= end; i++) { const a = duoAt(tbs[v.meet.a], i * DT), b = duoAt(tbs[v.meet.b], i * DT); min = Math.min(min, Math.hypot(a.x - b.x, a.y - b.y)); }
      if (!(min >= 0.2)) err(`noMeet: the bodies come within ${Math.round(min * 1e3) / 1e3} m of each other`);
    }
    if (!inputs.some(yesNo)) err('noMeet: needs a yes/no part');
  } else if (!m.ok) err('the bodies never meet, but the item is not marked noMeet');
  if (inputs.some(yesNo) && !v.noMeet && Number(inputs.find(yesNo).answer) === 2) err('yes/no answer 2 requires noMeet');
  // the drawing
  const sc = it.scene;
  if (!sc || !DUO_KINDS.includes(sc.kind) || !sc.labels) err('scene {kind, labels} missing');
  else {
    try {
      const d = ladderDiagram(it);
      if (d.replace(/\r\n?/g, '\n') !== String(it.diagram || '').replace(/\r\n?/g, '\n')) err('stored diagram differs from the generated one (run node tools/diagrams.mjs --write)');
      validateSvg(d).forEach((x) => err(`diagram: ${x}`));
      layoutIssues(d).forEach((x) => err(`diagram layout: ${x}`));
    } catch (e) { err(`diagram generation failed: ${e.message}`); }
    const given = new Set(numbersIn(plainStatement));
    const stray = numbersIn([].concat(...Object.values(sc.labels).map((l) => (Array.isArray(l) ? l : [l]))).join(' ')).filter((n) => n !== 0 && !given.has(n));
    if (stray.length) err(`scene labels print numbers that the statement does not give: ${stray.join(', ')}`);
  }
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
    if (stage === 'S3') errs.push(...checkItem(it));
    else if (stage === 'S4') errs.push(...checkItemS4(it));
    else if (stage === 'S5') errs.push(...checkItemS5(it));
    else errs.push(`${it.id}: inline items are only verified for S3, S4 and S5 (found in ${stage})`);
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

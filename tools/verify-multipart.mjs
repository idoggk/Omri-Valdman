// Verifies data/multipart.json (multi-part exam questions).
// Every part answer is recomputed from an independent projectile model (v0, angle, h0 with sin/cos 37/53 table, g = 10),
// and every dependency formula is re-evaluated with the TRUE earlier answers and must reproduce the stored answer.
// Also checks: `uses` equals the part ids the formula references (earlier parts only), answers are real numbers with
// at most 2 decimals, text is Hebrew, no complex numbers, and a wrong earlier answer is classified as carried-forward.
// Usage: node tools/verify-multipart.mjs [path-to-json]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { evalFormula, formulaRefs, classifyPart, validQuestion, tierOf } from '../js/multipart.js';
import { graph, duo, shot, DUO_KINDS, validateSvg, layoutIssues, sameText } from './diagrams.mjs';

const G = 10;
const HEB = /[֐-׿]/;
const COMPLEX = /sqrt\(\s*-|imaginary|complex|מרוכב|דמיוני/i;
const DECIMAL2 = /^-?\d+(\.\d{1,2})?$/;
const TRIG = { 37: [0.6, 0.8], 53: [0.8, 0.6], 90: [1, 0], 0: [0, 1] }; // [sin, cos]
const trig = (ang) => { const t = TRIG[Math.abs(ang)]; return t ? [Math.sign(ang || 1) * t[0], t[1]] : null; };

/** Independent physics for one question model. Returns a function quantity(q-spec) -> number. */
export function physics(model) {
  const [s, c] = trig(model.ang);
  const vy0 = model.v0 * s;
  const vx = model.v0 * c;
  const h0 = model.h0 || 0;
  const T = (vy0 + Math.sqrt(vy0 * vy0 + 2 * G * h0)) / G;
  const rise = vy0 > 0 ? vy0 * vy0 / (2 * G) : 0;
  const timeOf = (k) => (k === 'T' ? T : k === 't1' ? model.t1 : k === 't2' ? (vy0 + Math.sqrt(vy0 * vy0 - 2 * G * (model.H - h0))) / G : NaN);
  const vyAt = (t) => vy0 - G * t;
  const tH = (which) => (vy0 + (which === 'first' ? -1 : 1) * Math.sqrt(vy0 * vy0 - 2 * G * (model.H - h0))) / G;
  return (spec) => {
    switch (spec.k) {
      case 'vx': return vx;
      case 'vy0': return vy0;
      case 'tpeak': return vy0 / G;
      case 'hmax': return rise;
      case 'hmaxAbs': return h0 + rise;
      case 'tflight': return T;
      case 'tfall': return Math.sqrt(2 * (h0 + rise) / G);
      case 'range': return vx * T;
      case 'vyAt': return vyAt(timeOf(spec.t));
      case 'speedAt': return Math.hypot(vx, vyAt(timeOf(spec.t)));
      case 'tanAt': return vyAt(timeOf(spec.t)) / vx;
      case 'tAtH': return tH(spec.which);
      case 'xAtH': return vx * tH(spec.which);
      default: return NaN;
    }
  };
}

/* ---------- numeric multi-body engine (exam tier): model.bodies, quantities by numeric scan + bisection ----------
   A body is polynomial { x0, y0, vx, vy, ax, ay, t0 } (position before t0 = start point) or piecewise-linear velocity
   { x0, pts: [[t, v], ...] } along x. Nothing here uses closed-form solutions: meetings, landings and maxima are found by
   scanning sign changes with step 1e-3 and bisecting, so a wrong closed form in the data cannot hide. */
const STEP = 1e-3;
const TMAX = 40; // every scenario in the data ends well before 40 s
export function makeBody(b) {
  if (b.pts) {
    const pts = b.pts, start = pts[0][0], last = pts[pts.length - 1];
    const vAt = (t) => {
      if (t <= start) return pts[0][1];
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ta, va] = pts[i], [tb, vb] = pts[i + 1];
        if (t <= tb) return va + ((vb - va) * (t - ta)) / (tb - ta);
      }
      return last[1];
    };
    const xAt = (t) => {
      let x = b.x0 || 0;
      for (let i = 0; i + 1 < pts.length && t > pts[i][0]; i++) {
        const [ta, va] = pts[i], tb = Math.min(t, pts[i + 1][0]);
        x += ((va + vAt(tb)) / 2) * (tb - ta);
      }
      if (t > last[0]) x += last[1] * (t - last[0]);
      return x;
    };
    return { start, pos: (t) => ({ x: xAt(t), y: 0 }), vel: (t) => ({ x: vAt(t), y: 0 }) };
  }
  const start = b.t0 || 0;
  const tau = (t) => Math.max(0, t - start);
  return {
    start,
    pos: (t) => ({ x: (b.x0 || 0) + (b.vx || 0) * tau(t) + ((b.ax || 0) * tau(t) ** 2) / 2, y: (b.y0 || 0) + (b.vy || 0) * tau(t) + ((b.ay || 0) * tau(t) ** 2) / 2 }),
    vel: (t) => ({ x: (b.vx || 0) + (b.ax || 0) * tau(t), y: (b.vy || 0) + (b.ay || 0) * tau(t) }),
  };
}
function bisect(f, a, b) {
  let fa = f(a);
  for (let i = 0; i < 80; i++) {
    const m = (a + b) / 2, fm = f(m);
    if (fa * fm <= 0) b = m; else { a = m; fa = fm; }
  }
  return (a + b) / 2;
}
/** All sign-change roots of f on [a, b] (scan step STEP, then bisection). */
export function roots(f, a, b, step = STEP) {
  const out = [];
  let ta = a, fa = f(a);
  for (let t = a + step; t <= b + 1e-12; t += step) {
    const fb = f(t);
    if (fa * fb < 0 || fb === 0) out.push(bisect(f, ta, t));
    ta = t; fa = fb;
  }
  return out;
}
const dedupe = (xs) => xs.sort((p, q) => p - q).filter((x, i, a) => !i || x - a[i - 1] > 1e-6);

export function bodyModel(model) {
  const bodies = model.bodies.map(makeBody);
  const comp = (p, c) => (c === 'y' ? p.y : p.x);
  const T = (t) => (t !== null && typeof t === 'object' ? val(t) : t);
  const landOf = (i) => {
    const bd = bodies[i];
    let prev = bd.pos(bd.start + 1e-9).y;
    for (let t = bd.start + STEP; t < TMAX; t += STEP) {
      const y = bd.pos(t).y;
      if (prev > 0 && y <= 0) return bisect((s) => bd.pos(s).y, t - STEP, t);
      prev = y;
    }
    return NaN;
  };
  const meets = (i, j) => {
    const s = Math.max(bodies[i].start, bodies[j].start) + 1e-4;
    const d = (c) => (t) => comp(bodies[i].pos(t), c) - comp(bodies[j].pos(t), c);
    const cand = [...roots(d('x'), s, TMAX), ...roots(d('y'), s, TMAX)]
      .filter((t) => Math.abs(d('x')(t)) < 1e-6 && Math.abs(d('y')(t)) < 1e-6);
    return dedupe(cand);
  };
  const scanMax = (f, a, b) => {
    let best = -Infinity, at = a;
    for (let t = a; t <= b + 1e-12; t += STEP) { const v = f(t); if (v > best) { best = v; at = t; } }
    return [best, at];
  };
  function val(s) {
    if (typeof s === 'number') return s;
    const bd = bodies[s.b];
    switch (s.k) {
      case 'x': case 'y': return comp(bd.pos(T(s.t)), s.k);
      case 'vx': return bd.vel(T(s.t)).x;
      case 'vy': return bd.vel(T(s.t)).y;
      case 'speed': { const v = bd.vel(T(s.t)); return Math.hypot(v.x, v.y); }
      case 'ang': { const v = bd.vel(T(s.t)); return (Math.atan(Math.abs(v.y) / Math.abs(v.x)) * 180) / Math.PI; }
      case 'launchSpeed': { const v = bd.vel(bd.start); return Math.hypot(v.x, v.y); }
      case 'land': return landOf(s.b);
      case 'tAtX': return roots((t) => bd.pos(t).x - s.x, bd.start, TMAX)[0];
      case 'meet': return meets(s.b[0], s.b[1])[(s.n || 1) - 1] ?? NaN;
      case 'meetX': return bodies[s.b[0]].pos(meets(s.b[0], s.b[1])[(s.n || 1) - 1]).x;
      case 'gap': return comp(bodies[s.b[0]].pos(T(s.t)), s.c) - comp(bodies[s.b[1]].pos(T(s.t)), s.c);
      case 'relv': return bodies[s.b[0]].vel(T(s.t)).x - bodies[s.b[1]].vel(T(s.t)).x;
      case 'acc': return (bd.vel(T(s.t) + 1e-4).x - bd.vel(T(s.t) - 1e-4).x) / 2e-4; // slope of the v(t) graph
      case 'launchX': return bd.pos(bd.start).x;
      case 'maxGap': return scanMax((t) => comp(bodies[s.b[0]].pos(t), 'x') - comp(bodies[s.b[1]].pos(t), 'x'), s.from, s.to)[0];
      case 'tMaxGap': return scanMax((t) => comp(bodies[s.b[0]].pos(t), 'x') - comp(bodies[s.b[1]].pos(t), 'x'), s.from, s.to)[1];
      case 'maxY': return scanMax((t) => bd.pos(t).y, bd.start, landOf(s.b))[0];
      case 'diff': return val(s.a) - val(s.c);
      case 'start': return bd.start;
      case 'tMaxY': return scanMax((t) => bd.pos(t).y, bd.start, landOf(s.b))[1];
      case 'altAngle': { // second launch angle with the same speed that passes through the same point
        const v = val({ k: 'launchSpeed', b: s.b }), v0 = bd.vel(bd.start), th0 = (Math.atan2(v0.y, v0.x) * 180) / Math.PI;
        const [X, Y] = s.target, y0 = bd.pos(bd.start).y;
        const miss = (deg) => { const r = (deg * Math.PI) / 180, t = X / (v * Math.cos(r)); return y0 + v * Math.sin(r) * t - 5 * t * t - Y; };
        return roots(miss, 0.01, 89.99, 1e-3).find((d) => Math.abs(d - th0) > 0.01) ?? NaN;
      }
      default: return NaN;
    }
  }
  return { val, tPass: (x, y) => { const t = roots((u) => bodies[0].pos(u).x - x, 0, TMAX)[0]; return Number.isFinite(t) && Math.abs(bodies[0].pos(t).y - y) < 1e-6; } };
}

const MEMO = new Map(); // (bodies, quantity spec) -> value; the scans are slow and the data rarely changes between validate() calls
const near = (a, b) => Math.abs(a - b) < 1e-9;
const r2 = (x) => Math.round(x * 100) / 100;
const plain = (s) => String(s).replace(/<[^>]*>/g, ' ');
const solText = (s) => (Array.isArray(s) ? s.join(' ') : s);

/** A stored diagram must equal what tools/diagrams.mjs generates from its figure spec, be valid SVG and have no label overlaps. */
function checkFigure(spec, svgText, say) {
  if (spec == null && svgText == null) return;
  if (!spec || !svgText) { say('figure spec and diagram must both be present'); return; }
  let gen;
  try { gen = spec.graph ? graph(spec.graph) : DUO_KINDS.includes(spec.scene.kind) ? duo(spec.scene) : shot(spec.scene); } catch (x) { say(`figure spec error: ${x.message}`); return; }
  if (!sameText(gen, svgText)) say('diagram is stale: it differs from the one generated from its figure spec');
  validateSvg(svgText).forEach((m) => say(`diagram: ${m}`));
  layoutIssues(svgText).forEach((m) => say(`diagram layout: ${m}`));
}

export function validate(data) {
  const errs = [];
  if (!Array.isArray(data)) return ['data is not an array'];
  if (data.length !== 22) errs.push(`expected 22 questions, got ${data.length}`);
  const tiers = data.map(tierOf);
  if (tiers.filter((t) => t === 'warmup').length !== 8 || tiers.filter((t) => t === 'exam').length !== 14) errs.push('expected 8 warm-up and 14 exam questions');
  if (tiers.indexOf('exam') < tiers.lastIndexOf('warmup')) errs.push('warm-up questions must come before exam questions');
  const ids = new Set();
  for (const q of data) {
    const e = (m) => errs.push(`${q && q.id}: ${m}`);
    if (!validQuestion(q)) { e('malformed question'); continue; }
    if (ids.has(q.id)) e('duplicate id');
    ids.add(q.id);
    const exam = tierOf(q) === 'exam';
    if (q.tier !== (exam ? 'exam' : 'warmup')) e('tier must be "warmup" or "exam"');
    if (q.parts.length < (exam ? 5 : 4) || q.parts.length > 6) e(exam ? 'exam questions need 5-6 parts' : 'needs 4-6 parts');
    if (exam && q.parts.map((p) => p.id).join('') !== 'abcdef'.slice(0, q.parts.length)) e('part ids must be a, b, c, ...');
    checkFigure(q.figure, q.diagram, e);
    for (const f of ['title', 'stem']) if (!HEB.test(q[f] || '')) e(`${f} must be Hebrew`);
    if (q.given.g !== G) e('g must be 10');
    let quantity;
    if (q.model && Array.isArray(q.model.bodies)) {
      const bm = bodyModel(q.model);
      const mk = JSON.stringify(q.model.bodies);
      quantity = (spec) => { const key = mk + JSON.stringify(spec); if (!MEMO.has(key)) MEMO.set(key, bm.val(spec)); return MEMO.get(key); };
      const b0 = makeBody(q.model.bodies[0]), v0 = b0.vel(b0.start), sp = Math.hypot(v0.x, v0.y);
      if ('sin' in q.given && Math.abs(Math.abs(q.given.sin) - Math.abs(v0.y / sp)) > 1e-9) e('given.sin differs from the launch direction of body 1');
      if ('cos' in q.given && Math.abs(Math.abs(q.given.cos) - Math.abs(v0.x / sp)) > 1e-9) e('given.cos differs from the launch direction of body 1');
      for (const [x, y] of q.model.through || []) if (!bm.tPass(x, y)) e(`body 1 does not pass through (${x}, ${y})`);
      for (const gc of q.model.givenChecks || []) { const tv = bm.val(gc.q); if (!(Math.abs(tv - q.given[gc.key]) < 1e-9)) e(`given.${gc.key} = ${q.given[gc.key]} differs from the model (${tv})`); }
      if (!exam) e('bodies models are for exam questions');
    } else {
      if (exam) { e('exam questions need model.bodies'); continue; }
      if (!q.model || !trig(q.model.ang)) { e('model.ang must be 0, 37, 53, 90 or negative of those'); continue; }
      const [s, c] = trig(q.model.ang);
      if (q.given.v0 !== q.model.v0 || (q.given.h0 || 0) !== (q.model.h0 || 0)) e('given v0/h0 differ from model');
      if ('sin' in q.given && q.given.sin !== s) e('given.sin differs from table');
      if ('cos' in q.given && q.given.cos !== c) e('given.cos differs from table');
      if (q.model.t1 != null && q.given.t1 !== q.model.t1) e('given.t1 differs from model');
      if (q.model.H != null && q.given.H !== q.model.H) e('given.H differs from model');
      quantity = physics(q.model);
    }
    const seen = [];
    const vars = { ...q.given };
    const dependsOnLater = q.parts.some((p) => p.uses.length > 0);
    if (!dependsOnLater) e('no part uses an earlier part');
    for (const p of q.parts) {
      const pe = (m) => e(`part ${p.id}: ${m}`);
      if (!HEB.test(p.ask) || !HEB.test(solText(p.solution))) pe('ask and solution must be Hebrew');
      if (COMPLEX.test(p.ask + solText(p.solution))) pe('complex numbers are not allowed');
      if (/<script|on\w+\s*=/i.test(p.ask + solText(p.solution))) pe('unsafe html');
      if (!DECIMAL2.test(String(p.answer))) pe(`answer ${p.answer} is not an integer or decimal with at most 2 places`);
      const truth = quantity(p.q || {});
      if (!Number.isFinite(truth)) pe('q does not name a computable quantity');
      else if (!near(r2(truth), p.answer)) pe(`answer ${p.answer} differs from independent physics ${truth}`);
      const refs = formulaRefs(p.formula, q.parts.map((x) => x.id));
      if (refs.some((r) => !seen.includes(r))) pe('formula references a later or the same part');
      if (JSON.stringify([...refs].sort()) !== JSON.stringify([...p.uses].sort())) pe(`uses ${JSON.stringify(p.uses)} does not match formula references ${JSON.stringify(refs)}`);
      try {
        const v = evalFormula(p.formula, vars);
        if (!(Math.abs(v - p.answer) <= 0.005 + 1e-9)) pe(`formula "${p.formula}" gives ${v}, answer is ${p.answer}`);
      } catch (x) { pe(`formula error: ${x.message}`); }
      if (!plain(solText(p.solution)).includes(String(p.answer).replace('-', '−')) && !plain(solText(p.solution)).includes(String(p.answer))) pe('solution text does not show the answer');
      // carried-forward behaviour: feeding a wrong earlier answer into the formula must be accepted as method credit
      const mine = {};
      for (const u of p.uses) mine[u] = q.parts.find((x) => x.id === u).answer + 3;
      if (p.uses.length) {
        try {
          const v = evalFormula(p.formula, { ...vars, ...mine });
          if (Number.isFinite(v) && Math.abs(v - p.answer) > 0.011) {
            const r = Math.round(v * 100) / 100;
            if (classifyPart(q, p, r, mine) !== 'carried') pe('carried-forward value is not classified as carried');
          }
        } catch (x) { /* formula domain error for the perturbed value: nothing to check */ }
      }
      if (classifyPart(q, p, p.answer) !== 'correct') pe('true answer not classified correct');
      seen.push(p.id);
      vars[p.id] = p.answer;
    }
  }
  return errs;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const file = process.argv[2] || fileURLToPath(new URL('../data/multipart.json', import.meta.url));
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const errs = validate(data);
  if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
  console.log(`multipart: ${data.length} questions, ${data.reduce((n, q) => n + q.parts.length, 0)} parts verified`);
}

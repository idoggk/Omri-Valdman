// Independent check of data/skills.json. Graph: unique ids, prerequisites exist, no cycles. Content: Hebrew name,
// 4-6 line lesson and a worked example (>= 3 steps), exactly 8 questions each in 3 tiers (3 / 3 / 2) with Hebrew
// prompt, parameters and a stored answer that is recomputed here from the parameters (never trusted): finite decimal
// with <= 2 decimals, real, consistent with g = 10. Tier 2/3 questions carry a written solution (>= 2 / >= 3 steps),
// and the equations printed in `eqs` are evaluated at the recomputed solution(s).
// skillTags: every key must be an existing exercise id of data/math.json / data/physics.json, values existing skills.
// Run: node tools/verify-skills.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const TIER_SIZES = [3, 3, 2];
export const QUESTIONS_PER_SKILL = 8;
export const MIN_SOLUTION_STEPS = { 1: 0, 2: 2, 3: 3 };
export const MIN_SKILLS = 12;
const hasHebrew = (s) => typeof s === 'string' && /[א-ת]/.test(s);
const G = 10;
const TRIG = { sin: { 30: 0.5, 37: 0.6, 53: 0.8 }, cos: { 37: 0.8, 53: 0.6 } };
const r2 = (x) => Math.round(x * 1e6) / 1e6;
const r100 = (x) => Math.round(x * 100) / 100;
const DEG = 180 / Math.PI;

const trig = (fn, ang) => {
  const v = TRIG[fn][ang];
  if (v === undefined) throw new Error(`no exact ${fn} for ${ang} degrees`);
  return v;
};
/** Real roots of a x^2 + b x + c = 0, ascending. Throws when the discriminant is negative (no complex numbers). */
function roots(a, b, c) {
  const d = b * b - 4 * a * c;
  if (d < 0) throw new Error('negative discriminant');
  const s = Math.sqrt(d);
  return [...new Set([(-b - s) / (2 * a), (-b + s) / (2 * a)])].sort((x, y) => x - y);
}
const posRoot = (a, b, c) => { const p = roots(a, b, c).filter((t) => t > 1e-9); if (p.length !== 1) throw new Error('need exactly one positive time'); return p[0]; };

/** Recomputes the answer of a question from its kind and parameters. */
export const SOLVERS = {
  lin: ({ a, b, c, d }) => { if (a === c) throw new Error('a == c'); return (d - b) / (a - c); },
  elim: ({ a1, b1, c1, a2, b2, c2, ask }) => {
    const det = a1 * b2 - a2 * b1;
    if (det === 0) throw new Error('singular system');
    const x = (c1 * b2 - c2 * b1) / det, y = (a1 * c2 - a2 * c1) / det;
    if (Math.abs(a1 * x + b1 * y - c1) > 1e-9 || Math.abs(a2 * x + b2 * y - c2) > 1e-9) throw new Error('solution does not satisfy the system');
    return ask === 'x' ? x : y;
  },
  subst: ({ m, k, p, q, r, ask }) => {
    if (p + q * m === 0) throw new Error('no unique solution');
    const x = (r - q * k) / (p + q * m), y = m * x + k;
    if (Math.abs(p * x + q * y - r) > 1e-9) throw new Error('solution does not satisfy the system');
    return ask === 'x' ? x : y;
  },
  factor: ({ b, c, ask }) => {
    const hits = [];
    for (let x = -200; x <= 200; x++) if (x * x + b * x + c === 0) hits.push(x); // integer roots by brute force
    if (hits.length !== 2) throw new Error(`expected two distinct integer roots, found ${hits.length}`);
    return ask === 'max' ? Math.max(...hits) : Math.min(...hits);
  },
  disc: ({ a, b, c, ask }) => {
    const rs = roots(a, b, c);
    if (ask === 'disc') return b * b - 4 * a * c;
    return ask === 'max' ? rs[rs.length - 1] : rs[0];
  },
  sqrtcheck: ({ p, q, s }) => { // sqrt(p x + q) = x - s, tested on the ORIGINAL equation over a grid of candidates
    const ok = [];
    for (let i = -4000; i <= 4000; i++) {
      const x = i / 4;
      if (p * x + q >= 0 && x - s >= 0 && Math.abs(Math.sqrt(p * x + q) - (x - s)) < 1e-9) ok.push(x);
    }
    if (ok.length !== 1) throw new Error(`expected exactly one valid root, found ${ok.length}`);
    // the squared equation must really produce a rejected candidate
    if (roots(1, -(2 * s + p), s * s - q).length !== 2) throw new Error('squared equation has no rejected candidate');
    return ok[0];
  },
  sign: ({ dir, quantity, mag }) => {
    const up = dir === 'up';
    if (quantity === 'accel') return up ? -G : G;
    if (quantity === 'velFall') return up ? -mag : mag;
    if (quantity === 'velRise') return up ? mag : -mag;
    throw new Error(`unknown quantity ${quantity}`);
  },
  vert: ({ v0, t, ask }) => (ask === 'v' ? v0 - G * t : v0 * t - (G / 2) * t * t),
  comp: ({ v0, angle, ask }) => (ask === 'vx' ? v0 * trig('cos', angle) : v0 * trig('sin', angle)),
  tof: ({ mode, v0, h }) => {
    if (mode === 'up') return (2 * v0) / G;
    if (mode === 'drop') return Math.sqrt((2 * h) / G);
    if (mode === 'cliff') return posRoot(-G / 2, v0, h);
    throw new Error(`unknown mode ${mode}`);
  },
  range: ({ mode, vx, h, v0, angle }) => {
    if (mode === 'h') return vx * Math.sqrt((2 * h) / G);
    if (mode === 'angle') return v0 * trig('cos', angle) * ((2 * v0 * trig('sin', angle)) / G);
    throw new Error(`unknown mode ${mode}`);
  },
  maxh: ({ v0, h0, angle }) => { const vy = angle ? v0 * trig('sin', angle) : v0; return h0 + (vy * vy) / (2 * G); },
  /* ----- tier 2 / tier 3 kinds ----- */
  linb: ({ p, a, b, q, c, d, e, f }) => { // p(ax + b) - q(cx + d) = ex + f
    const slope = p * a - q * c - e;
    if (slope === 0) throw new Error('no unique solution');
    return (f - p * b + q * d) / slope;
  },
  sys3: (P) => {
    const M = [[P.a1, P.b1, P.c1], [P.a2, P.b2, P.c2], [P.a3, P.b3, P.c3]], R = [P.d1, P.d2, P.d3];
    const sol = solve3(M, R);
    return sol[{ x: 0, y: 1, z: 2 }[P.ask]];
  },
  qsubst: ({ m, k, r, ask }) => { // y = mx + k together with x^2 + y^2 = r: two different real solutions
    const xs = roots(1 + m * m, 2 * m * k, k * k - r);
    if (xs.length !== 2) throw new Error('need two different solutions');
    const pairs = xs.map((x) => ({ x, y: m * x + k }));
    for (const s of pairs) if (Math.abs(s.x * s.x + s.y * s.y - r) > 1e-9) throw new Error('solution does not satisfy the system');
    const pick = { xmin: pairs.map((s) => s.x), xmax: pairs.map((s) => s.x), ymin: pairs.map((s) => s.y), ymax: pairs.map((s) => s.y) }[ask];
    if (!pick) throw new Error(`unknown ask ${ask}`);
    return ask.endsWith('min') ? Math.min(...pick) : Math.max(...pick);
  },
  factora: ({ a, b, c, ask }) => { // a x^2 + b x + c = 0 with rational roots: exact integer test on x = i / 100
    const hits = [];
    for (let i = -10000; i <= 10000; i++) if (a * i * i + 100 * b * i + 10000 * c === 0) hits.push(i / 100);
    if (hits.length !== 2) throw new Error(`expected two distinct roots with <= 2 decimals, found ${hits.length}`);
    return ask === 'max' ? Math.max(...hits) : Math.min(...hits);
  },
  discparam: ({ mode, a, b, c }) => {
    const D = (A, B, C) => B * B - 4 * A * C;
    if (mode === 'one_b') { for (let k = 0.5; k <= 400; k += 0.5) if (D(a, k, c) === 0) return k; throw new Error('no positive k'); } // a x^2 + k x + c
    if (mode === 'one_c') { for (let k = -400; k <= 400; k += 0.25) if (D(a, b, k) === 0) return k; throw new Error('no k'); } // a x^2 + b x + k
    if (mode === 'maxk') { if (a <= 0) throw new Error('a must be positive'); for (let k = 400; k >= -400; k--) if (D(a, b, k) > 0) return k; throw new Error('no k'); }
    throw new Error(`unknown mode ${mode}`);
  },
  sqrtiso: ({ k, p, q, t }) => { // k sqrt(p x + q) + t = x, tested on the ORIGINAL equation
    const ok = [];
    for (let i = -4000; i <= 4000; i++) {
      const x = i / 4;
      if (p * x + q >= 0 && Math.abs(k * Math.sqrt(p * x + q) + t - x) < 1e-9) ok.push(x);
    }
    if (ok.length !== 1) throw new Error(`expected exactly one valid root, found ${ok.length}`);
    if (roots(1, -(2 * t + k * k * p), t * t - k * k * q).length !== 2) throw new Error('squared equation has no rejected candidate');
    return ok[0];
  },
  signmov: ({ dir, u, t, ask }) => { // u = speed upward (negative: thrown down); dir = positive direction
    const v = u - G * t, y = u * t - (G / 2) * t * t, s = dir === 'up' ? 1 : -1;
    if (dir !== 'up' && dir !== 'down') throw new Error(`unknown dir ${dir}`);
    return s * (ask === 'v' ? v : y);
  },
  signland: ({ dir, u, h }) => { // lands h below the launch point; velocity at impact in the chosen convention
    const t = posRoot(-G / 2, u, h);
    return (dir === 'up' ? 1 : -1) * (u - G * t);
  },
  vert2: ({ mode, v0, v, t }) => {
    if (mode === 'v0') return v + G * t;
    if (mode === 'tv') return (v0 - v) / G;
    throw new Error(`unknown mode ${mode}`);
  },
  dist: ({ v0, t }) => { // distance travelled (not displacement) by a ball thrown up from the ground
    const tp = v0 / G, peak = (v0 * v0) / (2 * G), y = v0 * t - (G / 2) * t * t;
    return t <= tp ? y : peak + (peak - y);
  },
  vertat: ({ h0, v0, y1 }) => { // velocity (up positive) when passing height y1 the second time
    const rs = roots(-G / 2, v0, h0 - y1).filter((t) => t > 0);
    if (rs.length !== 2) throw new Error('need two positive times');
    return v0 - G * rs[1];
  },
  compt: ({ v0, angle, t, ask }) => {
    const vx = v0 * trig('cos', angle), vy = v0 * trig('sin', angle) - G * t;
    return ask === 'vy' ? vy : r100(Math.hypot(vx, vy));
  },
  compv: ({ vx, vy }) => Math.hypot(vx, vy),
  impact: ({ v0, angle, h, ask }) => { // thrown from height h above the ground; velocity at impact
    const vx = v0 * trig('cos', angle), vy = -Math.sqrt((v0 * trig('sin', angle)) ** 2 + 2 * G * h);
    if (ask === 'vy') return vy;
    if (ask === 'speed') return r100(Math.hypot(vx, vy));
    if (ask === 'ang') return r100(Math.atan2(vy, vx) * DEG);
    throw new Error(`unknown ask ${ask}`);
  },
  maxh2: ({ v0, h0 }) => -Math.sqrt(2 * G * (h0 + (v0 * v0) / (2 * G))), // speed at the ground, up positive
  maxrev: ({ H, h0, ask }) => { // from the maximum height H (above ground) of a throw from h0
    const v0 = Math.sqrt(2 * G * (H - h0));
    if (ask === 'v0') return v0;
    if (ask === 'tland') return posRoot(-G / 2, v0, h0);
    throw new Error(`unknown ask ${ask}`);
  },
};

// extra modes for existing kinds (tof / range / disc count) live next to the base solvers
const baseTof = SOLVERS.tof, baseRange = SOLVERS.range, baseDisc = SOLVERS.disc;
SOLVERS.tof = (p) => {
  if (p.mode === 'angle') return posRoot(-G / 2, p.v0 * trig('sin', p.angle), p.h);
  if (p.mode === 'gap') { const rs = roots(-G / 2, p.v0, p.h0 - p.y1).filter((t) => t > 0); if (rs.length !== 2) throw new Error('need two positive times'); return rs[1] - rs[0]; }
  return baseTof(p);
};
SOLVERS.range = (p) => {
  if (p.mode === 'land') return p.v0 * trig('cos', p.angle) * posRoot(-G / 2, p.v0 * trig('sin', p.angle), p.h);
  if (p.mode === 'roof') { // lands on a roof of height H on the way down: later of the two times
    const rs = roots(-G / 2, p.v0 * trig('sin', p.angle), -p.H).filter((t) => t > 0);
    if (rs.length !== 2) throw new Error('need two positive times');
    return p.v0 * trig('cos', p.angle) * rs[1];
  }
  return baseRange(p);
};
SOLVERS.disc = (p) => (p.ask === 'count' ? (p.b * p.b - 4 * p.a * p.c > 0 ? 2 : p.b * p.b - 4 * p.a * p.c === 0 ? 1 : 0) : baseDisc(p));
// angles are given with 2 decimals: those answers are compared after rounding the recomputed value

/** Solves a 3x3 system by Cramer's rule and verifies it. */
function solve3(M, R) {
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M);
  if (D === 0) throw new Error('singular system');
  const sol = [0, 1, 2].map((c) => det(M.map((row, i) => row.map((v, j) => (j === c ? R[i] : v)))) / D);
  for (let i = 0; i < 3; i++) if (Math.abs(M[i][0] * sol[0] + M[i][1] * sol[1] + M[i][2] * sol[2] - R[i]) > 1e-9) throw new Error('solution does not satisfy the system');
  return sol;
}

/* ---------- the printed equations must hold at the solutions (catches a typo in `eqs` text) ---------- */
function evalSide(src, vars) {
  let s = src.replace(/\s+/g, '');
  s = s.replace(/\(([^()]*)\)²/g, '(($1)**2)').replace(/([a-z])²/g, '($1**2)'); // -x² means -(x²)
  s = s.replace(/(\d|\))(?=[a-z(√])/g, '$1*').replace(/([a-z])(?=[a-z(√])/g, '$1*'); // implicit multiplication
  s = s.replace(/√/g, 'Math.sqrt');
  if (!/^[\d.+\-*/()a-zA-Z]*$/.test(s) || /[a-zA-Z]{2,}/.test(s.replace(/Math\.sqrt/g, ''))) throw new Error(`cannot read equation "${src}"`);
  return new Function(...Object.keys(vars), `return ${s}`)(...Object.values(vars));
}
export function equationHolds(eq, vars) {
  const sides = eq.split('=');
  if (sides.length !== 2) throw new Error(`"${eq}" is not an equation`);
  return Math.abs(evalSide(sides[0], vars) - evalSide(sides[1], vars)) < 1e-6;
}
/** Assignments the printed equations must satisfy, per kind (null: not checked, e.g. the question asks for D). */
export const SOLUTION_SETS = {
  lin: (p, got) => [{ x: got }],
  linb: (p, got) => [{ x: got }],
  elim: (p) => { const det = p.a1 * p.b2 - p.a2 * p.b1; return [{ x: (p.c1 * p.b2 - p.c2 * p.b1) / det, y: (p.a1 * p.c2 - p.a2 * p.c1) / det }]; },
  subst: (p) => { const x = (p.r - p.q * p.k) / (p.p + p.q * p.m); return [{ x, y: p.m * x + p.k }]; },
  sys3: (p) => { const [x, y, z] = solve3([[p.a1, p.b1, p.c1], [p.a2, p.b2, p.c2], [p.a3, p.b3, p.c3]], [p.d1, p.d2, p.d3]); return [{ x, y, z }]; },
  qsubst: (p) => roots(1 + p.m * p.m, 2 * p.m * p.k, p.k * p.k - p.r).map((x) => ({ x, y: p.m * x + p.k })),
  factor: (p) => roots(1, p.b, p.c).map((x) => ({ x })),
  factora: (p) => roots(p.a, p.b, p.c).map((x) => ({ x })),
  disc: (p) => (p.b * p.b - 4 * p.a * p.c >= 0 ? roots(p.a, p.b, p.c).map((x) => ({ x })) : null),
  sqrtcheck: (p, got) => [{ x: got }],
  sqrtiso: (p, got) => [{ x: got }],
  discparam: (p, got) => (p.mode === 'one_b' ? [{ x: -got / (2 * p.a), k: got }] : null),
};

const decimals = (x) => { const s = String(r2(x)); return s.includes('.') ? s.split('.')[1].length : 0; };

export function validateSkills(data, exerciseIds) {
  const errs = [];
  const e = (m) => errs.push(m);
  if (!data || !Array.isArray(data.skills)) return ['skills must be an array'];
  if (data.skills.length < MIN_SKILLS) e(`expected at least ${MIN_SKILLS} skills, got ${data.skills.length}`);
  const ids = new Set();
  for (const s of data.skills) {
    if (!s || typeof s.id !== 'string' || !s.id) { e('skill without id'); continue; }
    if (ids.has(s.id)) e(`duplicate skill id ${s.id}`);
    ids.add(s.id);
  }
  const byId = new Map(data.skills.map((s) => [s.id, s]));
  for (const s of data.skills) {
    if (!s || !s.id) continue;
    const w = (m) => e(`${s.id}: ${m}`);
    if (!['math', 'phys'].includes(s.topic)) w('topic must be math or phys');
    if (!hasHebrew(s.name)) w('name must contain Hebrew');
    if (!Array.isArray(s.prereqs)) w('prereqs must be an array');
    else for (const p of s.prereqs) { if (!ids.has(p)) w(`unknown prerequisite "${p}"`); if (p === s.id) w('lists itself as a prerequisite'); }
    if (!Array.isArray(s.lesson) || s.lesson.length < 4 || s.lesson.length > 6) w('lesson must have 4-6 lines');
    else if (!s.lesson.every(hasHebrew)) w('every lesson line must contain Hebrew');
    if (/[iI]\s*=\s*√|\bi\b²|מורכב/.test(JSON.stringify(s))) w('complex numbers are not allowed');
    if (!Array.isArray(s.example) || s.example.length < 4 || !s.example.every((t) => typeof t === "string" && t.trim()) || !hasHebrew(s.example[0])) w('needs a worked example: a problem line and at least 3 Hebrew steps');
    if (!Array.isArray(s.questions) || s.questions.length !== QUESTIONS_PER_SKILL) { w(`needs exactly ${QUESTIONS_PER_SKILL} questions`); continue; }
    const tierOf = TIER_SIZES.flatMap((n, i) => Array(n).fill(i + 1));
    if (!s.questions.every((q, i) => q && q.tier === tierOf[i])) w(`questions must be in tiers ${TIER_SIZES.join('/')} in order (tier field 1,1,1,2,2,2,3,3)`);
    const qids = new Set();
    for (const q of s.questions) {
      const x = (m) => e(`${q && q.id}: ${m}`);
      if (!q || typeof q.id !== 'string') { w('question without id'); continue; }
      const need = MIN_SOLUTION_STEPS[q.tier] || 0;
      if (need && (!Array.isArray(q.solution) || q.solution.length < need || !q.solution.every((t) => typeof t === "string" && t.trim()) || !q.solution.some(hasHebrew))) x(`tier ${q.tier} needs a Hebrew solution with at least ${need} steps`);
      if (q.tier === 3 && s.topic === 'math' && !q.eqs) x('math question needs its equations in eqs');
      if (qids.has(q.id)) x('duplicate question id'); qids.add(q.id);
      if (!hasHebrew(q.prompt)) x('prompt must contain Hebrew');
      if (s.topic === 'math' && /(?:מכונית|סטודנט|חנות|קנה|מחיר|גיל)/.test(q.prompt)) x('math questions must not be word problems');
      if (!q.params || typeof q.params !== 'object') { x('params missing'); continue; }
      if (!Object.values(q.params).every((v) => typeof v === 'string' || Number.isFinite(v))) x('params must be numbers or strings');
      if (!Number.isFinite(q.answer)) { x('answer must be a finite number'); continue; }
      if (decimals(q.answer) > 2) x(`answer ${q.answer} has more than 2 decimals`);
      if (s.topic === 'phys' && q.params.g !== undefined && q.params.g !== G) x('g must be 10');
      const solve = SOLVERS[q.kind];
      if (!solve) { x(`unknown kind "${q.kind}"`); continue; }
      let got;
      try { got = solve(q.params); } catch (err) { x(`cannot be solved: ${err.message}`); continue; }
      if (!Number.isFinite(got)) x('recomputed answer is not finite');
      else if (decimals(got) > 2) x(`recomputed answer ${got} has more than 2 decimals`);
      else if (Math.abs(got - q.answer) > 1e-9) x(`stored answer ${q.answer} but recomputed ${r2(got)}`);
      if (Array.isArray(q.eqs) && s.topic === 'math' && !q.eqs.every((t) => typeof t === 'string')) x('eqs must be strings');
      if (Array.isArray(q.eqs) && SOLUTION_SETS[q.kind]) {
        try {
          const sets = SOLUTION_SETS[q.kind](q.params, got);
          if (sets) for (const vars of sets) for (const eq of q.eqs) if (!equationHolds(eq, vars)) x(`printed equation "${eq}" does not hold at ${JSON.stringify(vars)}`);
        } catch (err) { x(`equation check failed: ${err.message}`); }
      }
    }
  }
  // cycles: DFS with colours
  const colour = new Map();
  const visit = (id, trail) => {
    if (colour.get(id) === 2) return;
    if (colour.get(id) === 1) { e(`prerequisite cycle: ${[...trail, id].join(' -> ')}`); return; }
    colour.set(id, 1);
    for (const p of (byId.get(id) || {}).prereqs || []) if (byId.has(p)) visit(p, [...trail, id]);
    colour.set(id, 2);
  };
  for (const id of ids) visit(id, []);
  // tags
  if (!data.skillTags || typeof data.skillTags !== 'object' || Array.isArray(data.skillTags)) e('skillTags must be an object');
  else {
    const tagged = new Set();
    for (const [ex, list] of Object.entries(data.skillTags)) {
      if (exerciseIds && !exerciseIds.has(ex)) e(`skillTags: unknown exercise id "${ex}"`);
      if (!Array.isArray(list) || !list.length) { e(`skillTags: "${ex}" needs a non-empty list`); continue; }
      for (const sid of list) { if (!ids.has(sid)) e(`skillTags: "${ex}" has unknown skill "${sid}"`); tagged.add(sid); }
    }
    for (const id of ids) if (!tagged.has(id)) e(`skill ${id} is not used by any exercise tag`);
  }
  return errs;
}

export function loadExerciseIds(root) {
  const ids = new Set();
  for (const f of ['math', 'physics']) for (const ex of JSON.parse(readFileSync(path.join(root, 'data', `${f}.json`), 'utf8'))) ids.add(ex.id);
  return ids;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const errs = validateSkills(JSON.parse(readFileSync(path.join(root, 'data', 'skills.json'), 'utf8')), loadExerciseIds(root));
  if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
  console.log('skills OK');
}

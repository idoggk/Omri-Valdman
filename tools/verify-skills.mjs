// Independent check of data/skills.json. Graph: unique ids, prerequisites exist, no cycles. Content: Hebrew name and
// 4-6 line lesson, exactly 3 questions each with Hebrew prompt, parameters and a stored answer that is recomputed here
// from the parameters (never trusted): finite decimal with <= 2 decimals, real, and consistent with g = 10.
// skillTags: every key must be an existing exercise id of data/math.json / data/physics.json, values existing skills.
// Run: node tools/verify-skills.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const QUESTIONS_PER_SKILL = 3;
export const MIN_SKILLS = 12;
const hasHebrew = (s) => typeof s === 'string' && /[א-ת]/.test(s);
const G = 10;
const TRIG = { sin: { 30: 0.5, 37: 0.6, 53: 0.8 }, cos: { 37: 0.8, 53: 0.6 } };
const r2 = (x) => Math.round(x * 1e6) / 1e6;

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
    if (!Array.isArray(s.questions) || s.questions.length !== QUESTIONS_PER_SKILL) { w(`needs exactly ${QUESTIONS_PER_SKILL} questions`); continue; }
    const qids = new Set();
    for (const q of s.questions) {
      const x = (m) => e(`${q && q.id}: ${m}`);
      if (!q || typeof q.id !== 'string') { w('question without id'); continue; }
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

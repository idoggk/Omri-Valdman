// Verifies data/formulas.json (formula sheet) and data/examples.json (worked examples).
//  - structure, non-empty Hebrew text, unique ids, valid topics, minimum item counts
//  - HTML sanity: no script/on*=/javascript:, only simple allowed tags, balanced tags
//  - examples carry a "verify" block that is recomputed here:
//      math:    {system:[[..augmented rows..]], solution:[..]}  (exact rational Gaussian elimination)
//               {kind:"none"|"infinite", system:[[..]]}
//               {equations:[".."], vars:[".."], solutions:[[..],..]}  (finite polynomial systems)
//      physics: {model:"name", params:{..}, expect:{..}}  (small models below, g = 10)
//    A "verify" may also be an array of such blocks.
//  - every verified value must be mentioned in the written steps.
// Usage: node tools/verify-content.mjs [formulas.json] [examples.json]
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { solveSystem, parseFrac, parseEquation, solveFinite } from './verify-math.mjs';

export const G = 10;
export const TOPICS = ['math-3', 'math-4', 'phys-vertical', 'phys-horizontal'];
const HEB = /[֐-׿]/;
const heb = (s) => typeof s === 'string' && HEB.test(s.replace(/<[^>]*>/g, ' '));

// ---------------------------------------------------------------- HTML sanity
const ALLOWED_TAGS = new Set(['span', 'sup', 'sub', 'br', 'b', 'i', 'em', 'strong', 'code']);
const VOID_TAGS = new Set(['br']);

// Returns a list of problems (empty when the fragment is fine).
export function htmlProblems(html) {
  const out = [];
  if (typeof html !== 'string') return ['not a string'];
  if (/<\s*\/?\s*(script|iframe|object|embed|style|link|meta|svg|img)\b/i.test(html)) out.push('forbidden tag');
  if (/\son[a-z]+\s*=/i.test(html)) out.push('inline event handler');
  if (/javascript\s*:/i.test(html)) out.push('javascript: url');
  const stack = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;
  let m;
  let last = 0;
  while ((m = re.exec(html))) {
    const between = html.slice(last, m.index);
    if (between.includes('<')) out.push('stray "<" (use &lt;)');
    last = re.lastIndex;
    const [, close, nameRaw, attrs] = m;
    const name = nameRaw.toLowerCase();
    if (!ALLOWED_TAGS.has(name)) { out.push(`tag <${name}> not allowed`); continue; }
    if (attrs.trim() && !(name === 'span' && /^\s+dir="ltr"\s*$/.test(attrs))) out.push(`attributes on <${name}> not allowed`);
    if (VOID_TAGS.has(name)) continue;
    if (!close) stack.push(name);
    else if (stack.pop() !== name) out.push(`unbalanced </${name}>`);
  }
  if (html.slice(last).includes('<')) out.push('stray "<" (use &lt;)');
  if (stack.length) out.push(`unclosed <${stack[stack.length - 1]}>`);
  return [...new Set(out)];
}

// ---------------------------------------------------------------- formulas.json
export function validateFormulas(data, opts = {}) {
  const minItems = opts.minItems ?? 8;
  const minMistakes = opts.minMistakes ?? 6;
  const errors = [];
  const err = (where, msg) => errors.push(`formulas ${where}: ${msg}`);
  if (!data || typeof data !== 'object' || !data.topics || typeof data.topics !== 'object') return ['formulas: top level must be {topics:{..}}'];
  for (const t of TOPICS) if (!data.topics[t]) err(t, 'topic missing');
  for (const t of Object.keys(data.topics)) if (!TOPICS.includes(t)) err(t, 'unknown topic');
  const checkText = (where, s, { hebrew = true, html = true } = {}) => {
    if (typeof s !== 'string' || !s.trim()) { err(where, 'empty or not a string'); return; }
    if (hebrew && !heb(s)) err(where, 'no Hebrew text');
    if (html) for (const p of htmlProblems(s)) err(where, p);
  };
  for (const t of TOPICS) {
    const topic = data.topics[t];
    if (!topic) continue;
    checkText(`${t}.title`, topic.title);
    if (!Array.isArray(topic.sections) || !topic.sections.length) { err(t, 'sections missing'); continue; }
    let items = 0;
    const labels = new Set();
    topic.sections.forEach((s, si) => {
      checkText(`${t}.sections[${si}].heading`, s.heading);
      if (!Array.isArray(s.items) || !s.items.length) { err(`${t}.sections[${si}]`, 'items missing'); return; }
      s.items.forEach((it, ii) => {
        const w = `${t}.sections[${si}].items[${ii}]`;
        items++;
        checkText(`${w}.label`, it.label);
        checkText(`${w}.note`, it.note);
        checkText(`${w}.formula`, it.formula, { hebrew: false });
        if (typeof it.formula === 'string' && !/<span dir="ltr">/.test(it.formula)) err(`${w}.formula`, 'formula must be wrapped in <span dir="ltr">');
        if (labels.has(it.label)) err(w, `duplicate label "${it.label}"`);
        labels.add(it.label);
        if (/\bNaN\b|undefined|null/.test(`${it.label} ${it.formula} ${it.note}`)) err(w, 'contains NaN/undefined/null text');
      });
    });
    if (items < minItems) err(t, `needs at least ${minItems} items, found ${items}`);
    if (!Array.isArray(topic.mistakes) || topic.mistakes.length < minMistakes) err(t, `needs at least ${minMistakes} mistakes`);
    else topic.mistakes.forEach((m, i) => checkText(`${t}.mistakes[${i}]`, m));
  }
  return errors;
}

// ---------------------------------------------------------------- physics models (g = 10)
// Each model: params -> object of named results.
export const models = {
  vertical_from_height: ({ h, v0 }) => {
    const t = (v0 + Math.sqrt(v0 * v0 + 2 * G * h)) / G;
    return { t, hmax: h + (v0 * v0) / (2 * G), vfinal: v0 - G * t };
  },
  two_body_meet: ({ H, vA, vB }) => {
    const t = H / (vA + vB);
    return { t, y: vA * t - (G * t * t) / 2, vA: vA - G * t, vB: -vB - G * t };
  },
  last_second_down: ({ v0, d }) => {
    const t = (d - v0) / G + 0.5;
    return { t, h: v0 * t + (G * t * t) / 2 };
  },
  stopping_max_speed: ({ d, tr, a }) => {
    const v = -a * tr + Math.sqrt(a * a * tr * tr + 2 * a * d);
    return { v, kmh: v * 3.6, T: tr + v / a };
  },
  chase_accel: ({ v, d0, a }) => {
    const t = (v + Math.sqrt(v * v + 2 * a * d0)) / a;
    const tgap = v / a;
    return { t, x: (a * t * t) / 2, vp: a * t, tgap, gap: d0 + v * tgap - (a * tgap * tgap) / 2 };
  },
  horizontal_launch: ({ h, vx }) => {
    const t = Math.sqrt((2 * h) / G);
    return { t, x: vx * t, v: Math.hypot(vx, G * t) };
  },
  projectile_cliff: ({ v0, sin, cos, h }) => {
    const vx = v0 * cos;
    const vy = v0 * sin;
    const T = (vy + Math.sqrt(vy * vy + 2 * G * h)) / G;
    return { tUp: vy / G, Hmax: h + (vy * vy) / (2 * G), T, R: vx * T };
  },
  vt_trapezoid: ({ t1, t2, t3, v }) => {
    const dist = (v * t1) / 2 + v * t2 + (v * t3) / 2;
    return { dist, avg: dist / (t1 + t2 + t3), a1: v / t1, a3: -v / t3 };
  },
};

const near = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

function checkPhysics(spec, err) {
  const fn = models[spec.model];
  if (!fn) { err(`unknown model "${spec.model}"`); return []; }
  if (!spec.params || typeof spec.params !== 'object') { err('verify.params missing'); return []; }
  if (!spec.expect || typeof spec.expect !== 'object' || !Object.keys(spec.expect).length) { err('verify.expect missing'); return []; }
  for (const [k, v] of Object.entries(spec.params)) if (typeof v !== 'number' || !Number.isFinite(v)) err(`param ${k} must be a finite number`);
  let got;
  try { got = fn(spec.params); } catch (e) { err(`model failed: ${e.message}`); return []; }
  const values = [];
  for (const [k, want] of Object.entries(spec.expect)) {
    if (!(k in got)) { err(`model ${spec.model} has no result "${k}"`); continue; }
    if (typeof want !== 'number' || !near(got[k], want)) err(`${k}: expected ${want}, recomputed ${got[k]}`);
    else if (!/^-?\d+(\.\d{1,2})?$/.test(String(want))) err(`${k}: ${want} must be an integer or at most 2 decimals`);
    values.push(want);
  }
  return values;
}

// ---------------------------------------------------------------- math verification
const keyOf = (sol) => sol.map(String).join('|');
const DECIMAL2 = /^-?\d+(\.\d{1,2})?$/;

function checkMath(spec, topic, err) {
  const n = topic === 'math-3' ? 3 : 4;
  const values = [];
  const decimals = (xs) => xs.forEach((x) => { if (!DECIMAL2.test(String(x))) err(`value "${x}" must be an integer or at most 2 decimals`); });
  if (spec.system) {
    if (!Array.isArray(spec.system) || spec.system.length !== n || spec.system.some((r) => !Array.isArray(r) || r.length !== n + 1)) {
      err(`system must be ${n} rows of ${n + 1} numbers`);
      return values;
    }
    let r;
    try { r = solveSystem(spec.system, n); } catch (e) { err(`system invalid: ${e.message}`); return values; }
    const kind = spec.kind ?? (spec.solution ? 'unique' : null);
    if (!kind) { err('system needs "solution" or "kind"'); return values; }
    if (r.kind !== kind) err(`system is ${r.kind}, claimed ${kind}`);
    if (spec.solution) {
      if (!Array.isArray(spec.solution) || spec.solution.length !== n) { err(`solution must have ${n} entries`); return values; }
      decimals(spec.solution);
      if (r.kind === 'unique') {
        const want = spec.solution.map(parseFrac).map(String);
        const got = r.solution.map(String);
        if (want.join('|') !== got.join('|')) err(`solution mismatch: claimed (${want.join(', ')}), exact (${got.join(', ')})`);
      }
      values.push(...spec.solution);
    }
    return values;
  }
  if (spec.equations) {
    if (!Array.isArray(spec.vars) || spec.vars.length !== n) { err(`vars must list ${n} names`); return values; }
    if (!Array.isArray(spec.solutions) || !spec.solutions.length) { err('solutions missing'); return values; }
    let polys;
    let sols;
    try {
      polys = spec.equations.map((s) => parseEquation(s, spec.vars));
      sols = spec.solutions.map((s) => {
        if (!Array.isArray(s) || s.length !== n) throw new Error(`each solution needs ${n} entries`);
        decimals(s);
        return s.map(parseFrac);
      });
    } catch (e) { err(`equations invalid: ${e.message}`); return values; }
    sols.forEach((s, j) => {
      if (!polys.every((p) => p.partial(s).constValue().isZero())) err(`claimed solution #${j + 1} does not satisfy every equation`);
    });
    const { solutions: found, incomplete } = solveFinite(polys, n);
    if (incomplete) err(`completeness not certified: ${incomplete}`);
    else {
      const a = found.map(keyOf).sort();
      const b = sols.map(keyOf).sort();
      if (a.length !== b.length || a.some((k, i) => k !== b[i])) err(`solver found ${found.length} solution(s) [${a.join('; ')}], listed ${sols.length} [${b.join('; ')}]`);
    }
    spec.solutions.forEach((s) => values.push(...s));
    return values;
  }
  err('verify needs "system" or "equations"');
  return values;
}

// ---------------------------------------------------------------- examples.json
const plain = (s) => String(s).replace(/<[^>]*>/g, ' ').replace(/[−‒–—]/g, '-').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const mentions = (text, value) => {
  const v = String(Math.abs(value));
  return new RegExp(`(?<![\\d.])${v.replace('.', '\\.')}(?!\\d|\\.\\d)`).test(text);
};

export function validateExamples(data, opts = {}) {
  const requireVerify = opts.requireVerify ?? true;
  const errors = [];
  const err = (id, msg) => errors.push(`examples ${id}: ${msg}`);
  if (!Array.isArray(data)) return ['examples: top level must be an array'];
  const seen = new Set();
  const perTopic = {};
  const COMPLEX = /sqrt\(\s*-|imaginary|complex|מרוכב|דמיוני/i;
  data.forEach((ex, idx) => {
    const id = ex && ex.id ? ex.id : `#${idx}`;
    if (!ex || typeof ex !== 'object') { err(id, 'not an object'); return; }
    if (typeof ex.id !== 'string' || !/^ex-[a-z0-9]+(-[a-z0-9]+)*$/.test(ex.id)) err(id, 'id must look like ex-math-3-elim');
    if (seen.has(ex.id)) err(id, 'duplicate id');
    seen.add(ex.id);
    if (!TOPICS.includes(ex.topic)) { err(id, `bad topic ${ex.topic}`); return; }
    perTopic[ex.topic] = (perTopic[ex.topic] || 0) + 1;
    if (typeof ex.id === 'string' && !ex.id.startsWith(`ex-${ex.topic}-`)) err(id, `id should start with ex-${ex.topic}-`);
    for (const f of ['title', 'problem', 'takeaway']) {
      if (typeof ex[f] !== 'string' || !ex[f].trim()) err(id, `${f} empty`);
      else {
        if (!heb(ex[f])) err(id, `${f} has no Hebrew`);
        for (const p of htmlProblems(ex[f])) err(id, `${f}: ${p}`);
        if (COMPLEX.test(plain(ex[f]))) err(id, `${f}: complex-number text`);
      }
    }
    if (!Array.isArray(ex.steps) || ex.steps.length < 3) err(id, 'steps needs at least 3 entries');
    else {
      ex.steps.forEach((s, i) => {
        if (typeof s !== 'string' || !heb(s)) err(id, `step ${i + 1} empty or not Hebrew`);
        else {
          for (const p of htmlProblems(s)) err(id, `step ${i + 1}: ${p}`);
          if (COMPLEX.test(plain(s))) err(id, `step ${i + 1}: complex-number text`);
          if (!/\d/.test(s)) err(id, `step ${i + 1} has no numbers (steps need real work)`);
        }
      });
    }
    // numeric verification
    const specs = ex.verify === undefined ? [] : Array.isArray(ex.verify) ? ex.verify : [ex.verify];
    if (!specs.length) {
      if (requireVerify) err(id, 'verify block missing');
      return;
    }
    const isMath = ex.topic === 'math-3' || ex.topic === 'math-4';
    const values = [];
    specs.forEach((spec, k) => {
      const e = (msg) => err(id, `verify[${k}]: ${msg}`);
      if (!spec || typeof spec !== 'object') { e('not an object'); return; }
      if (isMath) {
        if (spec.model) e('math example must use system/equations, not model');
        else values.push(...checkMath(spec, ex.topic, e));
      } else if (!spec.model) e('physics example needs model/params/expect');
      else values.push(...checkPhysics(spec, e));
    });
    const text = plain(Array.isArray(ex.steps) ? ex.steps.join(' ') : '');
    for (const v of values) if (!mentions(text, v)) err(id, `verified value ${v} does not appear in the steps`);
  });
  if (!opts.skipCoverage) for (const t of TOPICS) if (!perTopic[t]) err(t, 'no worked example for this topic');
  return errors;
}

// ---------------------------------------------------------------- wording lint
// Strings found wrong in the 2026-11-03 teaching-correctness audit; they must not come back anywhere in data/*.json.
export const BANNED_WORDING = [
  [/ו?לקחו\s*(\{\{)?\s*g\b/, 'use the imperative "קחו g", not "לקחו g"'],
  [/מהירות\s+ההקרבה|מהירות\s+הקרבה/, '"הקרבה" means sacrifice: use "מהירות התקרבות" or "מהירות יחסית"'],
  [/מרבעים/, 'use "מעלים בריבוע"'],
  [/מ['׳’]\/ש/, 'the speed unit is written "מ/ש" everywhere (no apostrophe)'],
  [/(?<!\()log_\d+\(x\)\^2/, 'write the squared logarithm as (log_2(x))^2 so it cannot be read as log_2(x^2)'],
];

/** Problems found by scanning the raw text of every data/*.json. `files` = [[name, text]]. */
export function wordingProblems(files) {
  const out = [];
  for (const [name, text] of files) {
    for (const [re, why] of BANNED_WORDING) {
      const m = re.exec(text);
      if (m) out.push(`${name}: banned wording "${m[0]}": ${why}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------- CLI
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
  const fFile = process.argv[2] || path.join(dir, 'formulas.json');
  const eFile = process.argv[3] || path.join(dir, 'examples.json');
  const errors = [];
  let formulas;
  let examples;
  try { formulas = JSON.parse(readFileSync(fFile, 'utf8')); } catch (e) { errors.push(`cannot read ${fFile}: ${e.message}`); }
  try { examples = JSON.parse(readFileSync(eFile, 'utf8')); } catch (e) { errors.push(`cannot read ${eFile}: ${e.message}`); }
  if (formulas) errors.push(...validateFormulas(formulas));
  if (examples) errors.push(...validateExamples(examples));
  errors.push(...wordingProblems(readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => [f, readFileSync(path.join(dir, f), 'utf8')])));
  if (errors.length) {
    console.error(errors.map((e) => `FAIL ${e}`).join('\n'));
    console.error(`${errors.length} problem(s)`);
    process.exit(1);
  }
  const items = Object.values(formulas.topics).reduce((n, t) => n + t.sections.reduce((m, s) => m + s.items.length, 0), 0);
  console.log(`OK: ${Object.keys(formulas.topics).length} formula topics (${items} items), ${examples.length} worked examples verified`);
}

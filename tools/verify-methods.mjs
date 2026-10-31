// Independent check of data/methods.json. Structure: unique ids, 3-4 options with exactly one correct, Hebrew
// text, no empty explanations. Numbers: when an item shows equations, `vars` holds the true values (one object,
// or an array of objects for several roots); every shown equation must hold at every point, the correct option's
// `eq` must hold, and a wrong option's `eq` must fail at some point. Run: node tools/verify-methods.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const MIN_ITEMS = 30;
export const TOPICS = ['math-choose', 'math-quad', 'math-check', 'phys-axis', 'phys-formula', 'phys-given', 'phys-next'];
const KINDS = ['method', 'next'];
const hasHebrew = (s) => typeof s === 'string' && /[א-ת]/.test(s);

/** Evaluates one side of an equation with the given variables. Only our own data reaches this. */
export function evalExpr(src, vars) {
  const js = src
    .replace(/[−–]/g, '-').replace(/[·×]/g, '*').replace(/÷/g, '/')
    .replace(/²/g, '**2').replace(/³/g, '**3')
    .replace(/√\(/g, 'Math.sqrt(')
    .replace(/(\d)\s*(?=[A-Za-z(])/g, '$1*') // 2x, 5t²... (digits directly before a letter or "(")
    .replace(/\)\s*(?=[A-Za-z0-9(])/g, ')*');
  if (!/^[\w\s+\-*/().]*$/.test(js)) throw new Error(`unsupported characters in "${src}"`);
  const names = Object.keys(vars);
  const val = new Function(...names, `"use strict"; return (${js});`)(...names.map((n) => vars[n]));
  if (!Number.isFinite(val)) throw new Error(`"${src}" is not finite`);
  return val;
}

/** True if "lhs = rhs" holds at these variables. */
export function holds(eq, vars) {
  const parts = eq.split('=');
  if (parts.length !== 2) throw new Error(`"${eq}" must contain exactly one "="`);
  const l = evalExpr(parts[0], vars), r = evalExpr(parts[1], vars);
  return Math.abs(l - r) <= 1e-9 * Math.max(1, Math.abs(l), Math.abs(r));
}

const pointsOf = (v) => (Array.isArray(v) ? v : [v]);

export function validateMethods(data) {
  const errs = [];
  if (!data || !Array.isArray(data.items)) return ['items array missing'];
  if (data.items.length < MIN_ITEMS) errs.push(`expected at least ${MIN_ITEMS} items, got ${data.items.length}`);
  const count = (p) => data.items.filter((i) => i && String(i.topic).startsWith(p)).length;
  if (count('math') < 15 || count('phys') < 15) errs.push(`need at least 15 math and 15 physics items, got ${count('math')}/${count('phys')}`);
  const seen = new Set();
  for (const it of data.items) {
    const id = it && it.id ? it.id : '(no id)';
    const e = (msg) => errs.push(`${id}: ${msg}`);
    if (!it || typeof it.id !== 'string' || !it.id) { e('missing id'); continue; }
    if (seen.has(id)) e('duplicate id');
    seen.add(id);
    if (!TOPICS.includes(it.topic)) e(`bad topic "${it.topic}"`);
    if (!KINDS.includes(it.kind)) e(`bad kind "${it.kind}"`);
    if (!hasHebrew(it.prompt)) e('prompt must contain Hebrew');
    const eqs = it.equations === undefined ? [] : it.equations;
    if (!Array.isArray(eqs) || !eqs.every((x) => typeof x === 'string' && x.trim())) { e('equations must be non-empty strings'); continue; }
    if (!Array.isArray(it.options) || it.options.length < 3 || it.options.length > 4) { e('needs 3-4 options'); continue; }
    const correct = it.options.filter((o) => o && o.correct === true);
    if (correct.length !== 1) e(`exactly one option must be correct, got ${correct.length}`);
    const oids = new Set();
    for (const o of it.options) {
      if (!o || typeof o.id !== 'string' || !o.id) { e('option without id'); continue; }
      if (oids.has(o.id)) e(`duplicate option id "${o.id}"`);
      oids.add(o.id);
      if (!hasHebrew(o.text)) e(`option ${o.id} text must contain Hebrew`);
      if (typeof o.why !== 'string' || !o.why.trim()) e(`option ${o.id} has an empty explanation`);
      else if (!hasHebrew(o.why)) e(`option ${o.id} explanation must contain Hebrew`);
    }
    // numeric checks
    const needsVars = eqs.length > 0 || it.options.some((o) => o && o.eq);
    if (!needsVars) continue;
    if (it.vars === undefined) { e('vars missing although equations are shown'); continue; }
    const pts = pointsOf(it.vars);
    if (!pts.every((p) => p && typeof p === 'object' && Object.values(p).every(Number.isFinite))) { e('vars must be numbers'); continue; }
    try {
      for (const q of eqs) for (const p of pts) if (!holds(q, p)) e(`shown equation "${q}" is false at ${JSON.stringify(p)}`);
      if (it.kind === 'next' && eqs.length && !(correct[0] && correct[0].eq)) e('correct next step must have an eq to check');
      for (const o of it.options) {
        if (!o || !o.eq) continue;
        const all = pts.every((p) => holds(o.eq, p));
        if (o.correct && !all) e(`correct step "${o.eq}" is false at some point of ${JSON.stringify(it.vars)}`);
        if (!o.correct && all) e(`wrong option ${o.id} step "${o.eq}" is actually true at every point`);
      }
    } catch (err) { e(`equation check failed: ${err.message}`); }
  }
  return errs;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'methods.json');
  const errs = validateMethods(JSON.parse(readFileSync(file, 'utf8')));
  if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
  console.log('methods OK');
}

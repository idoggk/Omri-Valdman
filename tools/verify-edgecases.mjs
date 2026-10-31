// Independent check of data/edgecases.json. Every item stores its original equations (and, for physics, a domain
// and a polynomial model). Nothing from the stored answers is trusted:
//  1. every candidate is substituted back into the ORIGINAL equations and domain; its `ok` flag must match exactly,
//  2. the full solution set is found by an exhaustive grid search and must equal `answers` (no missing, no extra),
//  3. candidates must list every answer once, plus rejected ones, each with a Hebrew reason,
//  4. physics: the polynomial model must agree with the printed equation/domain, and the quadratic formula must
//     give the same valid roots (finite decimals, at most 2 decimals).
// Run: node tools/verify-edgecases.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const MIN_ITEMS = 20;
const hasHebrew = (s) => typeof s === 'string' && /[א-ת]/.test(s);
const okNum = (n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-9;
const same = (a, b) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-9);
const close = (l, r) => Math.abs(l - r) <= 1e-9 * Math.max(1, Math.abs(l), Math.abs(r));

/** Turns a printed side ("2x + 3", "√(x+6)", "(x² − 4)/(x − 2)") into a JS function of the variables. */
export function compileExpr(src, names) {
  const js = src
    .replace(/[−–]/g, '-').replace(/[·×]/g, '*').replace(/÷/g, '/')
    .replace(/²/g, '**2')
    .replace(/√\(/g, 'Math.sqrt(')
    .replace(/(\d)\s*(?=[A-Za-z(])/g, '$1*')
    .replace(/\)\s*(?=[A-Za-z0-9(])/g, ')*')
    .replace(/([A-Za-z])\s+(?=[A-Za-z(])/g, '$1*')
    .replace(/\bMath\*\./g, 'Math.');
  if (!/^[\w\s+\-*/().]*$/.test(js)) throw new Error(`unsupported characters in "${src}"`);
  return new Function(...names, `"use strict"; return (${js});`);
}

/** Compiles "lhs = rhs", "a >= b" or "a <= b" into a predicate (vals) => boolean. Undefined (NaN / ±Infinity) is false. */
export function compileRel(src, names) {
  const m = /^(.*?)(>=|<=|=)(.*)$/.exec(src);
  if (!m) throw new Error(`"${src}" has no relation`);
  const l = compileExpr(m[1], names), r = compileExpr(m[3], names);
  return (vals) => {
    const a = l(...vals), b = r(...vals);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    if (m[2] === '=') return close(a, b);
    return m[2] === '>=' ? a >= b - 1e-9 : a <= b + 1e-9;
  };
}

const polyAt = (c, t) => c.reduce((s, k, i) => s + k * t ** i, 0);

function defaultSearch(n) { return n >= 4 ? { min: -10, max: 10, step: 1 } : n === 3 ? { min: -12, max: 12, step: 0.5 } : { min: -10, max: 10, step: 0.01 }; }

/** All grid points that satisfy every equation and domain relation of the item. */
export function solveGrid(it) {
  const names = it.vars;
  const eqs = it.equations.map((q) => compileRel(q, names));
  const dom = (it.domain || []).map((q) => compileRel(q, names));
  const { min, max, step } = { ...defaultSearch(names.length), ...(it.search || {}) };
  const n = Math.round((max - min) / step);
  const out = [];
  const cur = new Array(names.length).fill(0);
  const rec = (k) => {
    if (k === names.length) { if (eqs.every((f) => f(cur)) && dom.every((f) => f(cur))) out.push(cur.map((x) => Math.round(x * 1e6) / 1e6)); return; }
    for (let i = 0; i <= n; i++) { cur[k] = min + i * step; rec(k + 1); }
  };
  rec(0);
  return out;
}

/** True if the tuple satisfies the original equations and the domain. */
export function isValid(it, tuple) {
  const names = it.vars;
  return it.equations.every((q) => compileRel(q, names)(tuple)) && (it.domain || []).every((q) => compileRel(q, names)(tuple));
}

/** Valid roots of model.eq (degree <= 2, = 0) that satisfy every model.dom polynomial (>= 0). */
export function polyRoots(model) {
  const [c, b = 0, a = 0] = model.eq;
  let roots = [];
  if (Math.abs(a) > 1e-12) {
    const d = b * b - 4 * a * c;
    if (d >= 0) roots = [(-b - Math.sqrt(d)) / (2 * a), (-b + Math.sqrt(d)) / (2 * a)];
  } else if (Math.abs(b) > 1e-12) roots = [-c / b];
  roots = roots.map((x) => Math.round(x * 1e6) / 1e6);
  return { all: roots, valid: [...new Set(roots)].filter((x) => model.dom.every((p) => polyAt(p, x) >= -1e-9)).sort((p, q) => p - q) };
}

const tupleKey = (t) => t.map((x) => Math.round(x * 1e6) / 1e6).join(',');

export function validateEdgecases(data) {
  const errs = [];
  const items = data && Array.isArray(data.items) ? data.items : [];
  if (!data || data.g !== 10) errs.push('g must be 10');
  if (items.length < MIN_ITEMS) errs.push(`need at least ${MIN_ITEMS} items, found ${items.length}`);
  if (items.filter((i) => i.kind === 'math').length < 10) errs.push('need at least 10 math items');
  if (items.filter((i) => i.kind === 'phys').length < 10) errs.push('need at least 10 physics items');
  const ids = new Set();
  let hasNone = false, hasFour = false;
  for (const it of items) {
    const e = (m) => errs.push(`${it && it.id}: ${m}`);
    if (!it || typeof it.id !== 'string' || !it.id) { errs.push('item without id'); continue; }
    if (ids.has(it.id)) e('duplicate id');
    ids.add(it.id);
    if (it.kind !== 'math' && it.kind !== 'phys') e('kind must be math or phys');
    if (!it.topic) e('missing topic');
    if (!hasHebrew(it.prompt)) e('prompt must be Hebrew');
    if (!hasHebrew(it.explanation) || it.explanation.trim().length < 40) e('explanation must be a full Hebrew text');
    if (!Array.isArray(it.vars) || !it.vars.length || !Array.isArray(it.equations) || !it.equations.length) { e('vars and equations required'); continue; }
    const n = it.vars.length;
    if (it.kind === 'math' && (n < 3 || n > 4)) e('math systems need 3-4 unknowns');
    if (it.kind === 'phys' && (n !== 1 || it.vars[0] !== 't')) e('physics items have the single unknown t');
    if (it.kind === 'math' && it.equations.length < n) e('fewer equations than unknowns');
    if (it.kind === 'math' && /ביום|בשעה|קנה|מחיר|ק"ג|₪/.test(it.prompt)) e('math must not be a word problem');
    const cands = Array.isArray(it.candidates) ? it.candidates : [];
    if (cands.length < 4 || cands.length > 6) e(`needs 4-6 candidates, has ${cands.length}`);
    try {
      // 1. substitute every candidate into the ORIGINAL equations
      const seen = new Set();
      for (const c of cands) {
        if (!Array.isArray(c.v) || c.v.length !== n || !c.v.every(okNum)) { e(`bad candidate ${JSON.stringify(c.v)}`); continue; }
        const k = tupleKey(c.v);
        if (seen.has(k)) e(`duplicate candidate ${k}`);
        seen.add(k);
        if (typeof c.why !== 'string' || c.why.trim().length < 8 || (!c.ok && !hasHebrew(c.why))) e(`candidate ${k} needs a reason (Hebrew when rejected)`);
        if (typeof c.ok !== 'boolean') e(`candidate ${k} needs ok:true/false`);
        const actual = isValid(it, c.v);
        if (actual !== c.ok) e(`candidate ${k} is marked ${c.ok} but substituting gives ${actual}`);
      }
      // 2. exhaustive solution set vs. stored answers
      if (!Array.isArray(it.answers) || !it.answers.every((a) => Array.isArray(a) && a.length === n && a.every(okNum))) e('answers must be tuples of finite decimals (<= 2 decimals)');
      else {
        const found = solveGrid(it).map(tupleKey).sort();
        const stored = it.answers.map(tupleKey).sort();
        if (found.join('|') !== stored.join('|')) e(`stored answers [${stored.join(' | ')}] differ from the independently solved set [${found.join(' | ')}]`);
        if (it.answers.some((a) => !isValid(it, a))) e('a stored answer fails the original equations');
        // 3. candidates cover all answers exactly
        const validCands = cands.filter((c) => c.ok).map((c) => tupleKey(c.v)).sort();
        if (validCands.join('|') !== stored.join('|')) e('the candidates marked valid must be exactly the stored answers');
        if (!cands.some((c) => !c.ok)) e('needs at least one rejected candidate');
        if (it.answers.length === 0) hasNone = true;
        if (it.answers.length === 4) hasFour = true;
        if (it.kind === 'math' && ![2, 4].includes(it.answers.length)) e('math systems have 2 or 4 solution tuples');
      }
      // 4. physics: model cross-check
      if (it.kind === 'phys') {
        const m = it.model;
        if (!m || !Array.isArray(m.eq) || !Array.isArray(m.dom)) e('physics needs model {eq, dom}');
        else {
          const diff = compileExpr(it.equations[0].split('=').map((s) => `(${s})`).join('-'), ['t']);
          for (const t of [-2, 0, 1, 2.5, 4, 7]) if (!close(diff(t), polyAt(m.eq, t))) e(`model.eq disagrees with the printed equation at t=${t}`);
          const doms = (it.domain || []).map((q) => { const [l, r] = q.split('>='); return compileExpr(`(${l})-(${r})`, ['t']); });
          if (doms.length !== m.dom.length) e('model.dom must have one polynomial per domain relation');
          else for (const t of [-2, 0, 1, 2.5, 4, 7]) doms.forEach((f, i) => { if (!close(f(t), polyAt(m.dom[i], t))) e(`model.dom[${i}] disagrees with the printed domain at t=${t}`); });
          const r = polyRoots(m);
          if (!same(r.valid, it.answers.map((a) => a[0]).sort((p, q) => p - q))) e(`quadratic-formula roots [${r.valid}] differ from the answers`);
          if (!r.valid.every(okNum)) e('valid roots must be finite decimals with at most 2 decimals');
          // each rejected root of the polynomial that is a real root must have been rejected for a reason (domain)
          for (const x of r.all) if (!okNum(x)) e('every real root must be a finite decimal');
        }
      }
    } catch (err) { e(`check failed: ${err.message}`); }
  }
  if (!hasNone) errs.push('need at least one item with no solution');
  if (!hasFour) errs.push('need at least one item with four solutions');
  return errs;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'edgecases.json');
  const errs = validateEdgecases(JSON.parse(readFileSync(file, 'utf8')));
  if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
  console.log('edgecases OK');
}

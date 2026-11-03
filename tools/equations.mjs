// Equation extraction and normalisation shared by the duplicate checks (tools/verify-transfer.mjs, tests/equations.test.mjs).
// An "equation text" is anything a student would copy: an item's eq[] entry, a {{...}} span of a writing task, or a
// <span dir="ltr">...</span> of a math statement. Two items with the same normalised text are duplicates; two items whose
// texts agree after every number is masked belong to the same "family" (same structure, different constants).
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };

/** Canonical text: no tags, spaces or unicode variants; lower case. */
export function normalizeEquation(s) {
  return String(s)
    .replace(/<sup>(.*?)<\/sup>/g, '^($1)')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => `^${SUP[c]}`)
    .replace(/[−–—]/g, '-').replace(/[·×]/g, '*').replace(/≤/g, '<=').replace(/≥/g, '>=')
    .replace(/\s+/g, '').replace(/\*(?=[a-z(])/g, '').toLowerCase();
}

/** Same structure with every number masked: "sqrt(x+7)=x-5" and "sqrt(x+10)=x-2" share the family "√(x+N)=x-N". */
// The relation sign (=, <, >, <=, >=) and the sign in front of a constant are masked too, so "√(x+7)=x+1" and "√(x+7)>x-5" match.
// A coefficient stays visible as N ("√(2x+13)" is "√(Nx±N)"), so scaling the unknown makes a different family.
export const equationFamily = (s) => normalizeEquation(s)
  .replace(/\d+(\.\d+)?/g, 'N')
  .replace(/<=|>=|=|<|>/g, 'R').replace(/[+-](?=N)/g, '±');

// a copyable equation: has a relation sign, a variable, and enough characters to be more than "x = 3"
const isEquation = (t) => /[=<>]/.test(t) && /[a-z]/.test(t) && t.length >= 5 && /[+\-*/^√()]/.test(t);
// plain unknown-finding equations only: skip formulas full of words/subscripts (physics derivations, definitions)
const isSolvable = (t) => !/[א-ת]/.test(t);

/** Equation texts of one item: eq[] entries plus {{..}} and <span dir="ltr"> spans of its statement/stem/ask. */
export function itemEquations(item) {
  const out = new Set();
  const add = (t) => { const n = normalizeEquation(t); if (isEquation(n) && isSolvable(n)) out.add(n); };
  for (const t of item.eq || []) add(t);
  for (const k of ['statement', 'stem', 'ask']) {
    const s = item[k];
    if (typeof s !== 'string') continue;
    for (const m of s.matchAll(/\{\{(.+?)\}\}/g)) add(m[1]);
    for (const m of s.matchAll(/<span dir="ltr">(.+?)<\/span>/g)) add(m[1]);
  }
  return [...out];
}

/** Items of every data file as [{ file, id, equations }] (arrays, {stages:[{items}]} and {key:[..]} shapes). */
export function loadEquationItems(dataDir) {
  const rows = [];
  for (const f of readdirSync(dataDir).filter((x) => x.endsWith('.json'))) {
    let d;
    try { d = JSON.parse(readFileSync(path.join(dataDir, f), 'utf8')); } catch (e) { continue; }
    const walk = (v) => {
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (!v || typeof v !== 'object') return;
      if (typeof v.id === 'string' && (v.eq || v.statement || v.stem)) rows.push({ file: f, id: v.id, equations: itemEquations(v) });
      for (const x of Object.values(v)) if (x && typeof x === 'object') walk(x);
    };
    walk(d);
  }
  return rows;
}

/** Whole-item signature: all of the item's equations, sorted. Items are duplicates when the signature is equal. */
export const signatureOf = (row) => [...row.equations].sort().join(' && ');
export const familyOf = (row) => row.equations.map(equationFamily).sort().join(' && ');

// A family is only meaningful when it carries structure: a root, a power, a logarithm, a trig function or a fraction with x
const STRUCTURED = /√|sqrt|\^|log|lg|sin|cos|tan|\/\(?[^)]*x|x\/|\|/;

/**
 * Duplicate problems over rows = loadEquationItems(). `reserved` = ids of the reserved transfer questions.
 *  - two different items with the same whole-item equation text;
 *  - a reserved item whose family (numbers, signs and relation masked) equals the family of any other item.
 */
export function equationProblems(rows, reserved) {
  const out = [];
  const withEq = rows.filter((r) => r.equations.length && signatureOf(r).length >= 9);
  const seen = new Map();
  for (const r of withEq) {
    const sig = signatureOf(r);
    const key = `${r.id}`;
    if (seen.has(sig) && seen.get(sig).id !== key) out.push(`duplicate equation "${sig}" in ${seen.get(sig).file}:${seen.get(sig).id} and ${r.file}:${r.id}`);
    else if (!seen.has(sig)) seen.set(sig, { id: key, file: r.file });
  }
  // a stand-alone one-unknown equation that is also written in another item (even inside a longer statement)
  for (const r of withEq) {
    if (r.equations.length !== 1 || /[yzwm]/.test(r.equations[0].replace(/sqrt|log/g, '')) || r.equations[0].length < 9) continue;
    for (const o of withEq) {
      if (o.id !== r.id && o.equations.includes(r.equations[0]) && !(seen.get(signatureOf(o)) && signatureOf(o) === signatureOf(r))) {
        out.push(`duplicate equation "${r.equations[0]}" in ${r.file}:${r.id} and ${o.file}:${o.id}`);
      }
    }
  }
  const fam = new Map();
  for (const r of withEq) { const f = familyOf(r); if (!fam.has(f)) fam.set(f, []); fam.get(f).push(r); }
  for (const [f, rs] of fam) {
    if (!STRUCTURED.test(f)) continue;
    const res = rs.filter((r) => reserved.has(r.id));
    const rest = rs.filter((r) => !reserved.has(r.id));
    if (res.length && rest.length) out.push(`reserved ${res.map((r) => r.id).join(', ')} shares the equation family "${f}" with ${rest.map((r) => `${r.file}:${r.id}`).slice(0, 4).join(', ')}`);
  }
  return out;
}

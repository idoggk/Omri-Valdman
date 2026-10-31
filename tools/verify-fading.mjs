// Independent check of data/fading.json (fading worked examples) against data/examples.json.
// Every checkable key value is recomputed from the example's own verified data (its "verify" block: the linear
// system / the solutions / the physics parameters and expected results) with the stored `expr`, and must equal the
// stored value. Each stage must hide a valid subset of the keyed steps.
// Run: node tools/verify-fading.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { hiddenKeys, STAGES } from '../js/fading-ui.js';

const dec2 = (n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-9;
const VARS = ['x', 'y', 'z', 'w'];

/** Evaluation scope of one example: S = solutions as {x,y,..}, sys = coefficient rows, p = params, e = expected. */
export function scopeOf(example) {
  const v = example.verify;
  const list = Array.isArray(v) ? v : [v];
  const first = list.find((q) => q && q.system) || {};
  const withSol = [...list].reverse().find((q) => q && (q.solution || q.solutions)) || {};
  const names = withSol.vars || VARS;
  const sols = withSol.solutions || (withSol.solution ? [withSol.solution] : []);
  const S = sols.map((s) => Object.fromEntries(s.map((val, i) => [names[i], val])));
  return { S, sys: first.system || [], p: (list[0] && list[0].params) || {}, e: (list[0] && list[0].expect) || {} };
}

function evaluate(expr, scope, sol) {
  const flat = scope.S[sol] || {};
  const names = [...Object.keys(flat), 'S', 'sys', 'p', 'e'];
  return new Function(...names, `"use strict"; return (${expr});`)(...Object.keys(flat).map((k) => flat[k]), scope.S, scope.sys, scope.p, scope.e);
}

export function validateFading(data, examples) {
  const errs = [];
  const map = data && data.examples && typeof data.examples === 'object' ? data.examples : null;
  if (!map) return ['fading.json: missing examples map'];
  const ids = new Set(examples.map((x) => x.id));
  for (const id of Object.keys(map)) if (!ids.has(id)) errs.push(`${id}: unknown example id`);
  for (const ex of examples) {
    const keys = map[ex.id];
    if (!Array.isArray(keys)) { errs.push(`${ex.id}: no key steps`); continue; }
    if (keys.length < 3) errs.push(`${ex.id}: needs at least 3 keyed steps`);
    let prev = -1;
    keys.forEach((k, i) => {
      if (!Number.isInteger(k.step) || k.step < 0 || k.step >= ex.steps.length) errs.push(`${ex.id}: key ${i} has an invalid step`);
      else if (k.step <= prev) errs.push(`${ex.id}: key steps must be strictly increasing`);
      prev = k.step;
      if (!!k.final !== (i === keys.length - 1)) errs.push(`${ex.id}: exactly the last keyed step must be final`);
      if (!Array.isArray(k.asks) || !k.asks.length) errs.push(`${ex.id}: key ${i} has no asks`);
    });
    const scope = scopeOf(ex);
    for (const k of keys) {
      for (const a of k.asks || []) {
        const where = `${ex.id}: step ${k.step} "${a.label}"`;
        if (typeof a.label !== 'string' || !a.label) errs.push(`${where}: missing label`);
        if (!dec2(a.value)) { errs.push(`${where}: value must be a real number with at most 2 decimals`); continue; }
        let got;
        try { got = evaluate(a.expr, scope, a.sol || 0); } catch (err) { errs.push(`${where}: expr fails (${err.message})`); continue; }
        if (!(typeof got === 'number' && Math.abs(got - a.value) < 1e-9)) errs.push(`${where}: value ${a.value} but example data gives ${got}`);
      }
    }
    // stage subsets
    const n = keys.length;
    const counts = STAGES.map((s) => hiddenKeys(keys, s));
    counts.forEach((hid, i) => {
      if (!hid.every((j) => Number.isInteger(j) && j >= 0 && j < n) || new Set(hid).size !== hid.length) errs.push(`${ex.id}: stage ${i + 1} hides an invalid subset`);
    });
    if (counts[0].length !== 0) errs.push(`${ex.id}: stage 1 must hide nothing`);
    if (counts[1].length !== 1) errs.push(`${ex.id}: stage 2 must hide exactly one keyed step`);
    if (!(counts[2].length > 1 && counts[2].length < n)) errs.push(`${ex.id}: stage 3 must hide about half of the keyed steps`);
    if (counts[3].length !== n) errs.push(`${ex.id}: stage 4 must hide all keyed steps`);
  }
  return errs;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const read = (f) => JSON.parse(readFileSync(new URL('../data/' + f, import.meta.url), 'utf8'));
  const errs = validateFading(read('fading.json'), read('examples.json'));
  if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
  console.log('fading.json: OK');
}

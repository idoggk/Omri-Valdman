// Verifies data/drills.json (trap drills, sanity-check questions, formula flashcards).
//  - schema per kind, unique ids, counts (30 traps / 15 sanity / 25 cards)
//  - multiple choice: 3-4 unique options, `correct` is a single valid index
//  - no answer leak: the correct option text may not appear inside the question
//  - Hebrew present in the written text
//  - every item may carry a "verify" array that is recomputed here:
//      {expr, vars?, equals|notEquals|gt|lt, tol?}   arithmetic expression (Math.* allowed)
//      {system:[[..augmented rows..]], kind:"unique"|"none"|"infinite", solution?:[..]}
// Usage: node tools/verify-drills.mjs [drills.json]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { solveSystem, parseFrac } from './verify-math.mjs';

export const TOPICS = ['math-3', 'math-4', 'phys-vertical', 'phys-horizontal'];
const MATH = new Set(['math-3', 'math-4']);
export const COUNTS = { traps: 30, sanity: 15, cards: 25 };
const HEB = /[֐-׿]/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MATH_FNS = new Set(['sqrt', 'abs', 'pow', 'min', 'max', 'PI']);
const VERIFY_KEYS = new Set(['expr', 'vars', 'equals', 'notEquals', 'gt', 'lt', 'tol', 'system', 'kind', 'solution']);

const isStr = (s) => typeof s === 'string' && s.trim().length > 0;
const hasHeb = (s) => typeof s === 'string' && HEB.test(s);
const norm = (s) => String(s).replace(/\s+/g, '').toLowerCase();

// Evaluates a restricted arithmetic expression; throws on anything unexpected.
export function evalExpr(expr, vars = {}) {
  if (!isStr(expr)) throw new Error('expr must be a non-empty string');
  if (!/^[\w\s+\-*/().,]*$/.test(expr)) throw new Error(`illegal characters in "${expr}"`);
  const names = Object.keys(vars);
  for (const n of names) if (!/^[a-z][a-z0-9]*$/i.test(n) || n === 'Math') throw new Error(`bad variable name "${n}"`);
  for (const [v, num] of Object.entries(vars)) if (typeof num !== 'number' || !Number.isFinite(num)) throw new Error(`variable ${v} is not a finite number`);
  const stripped = expr.replace(/Math\.([A-Za-z]+)/g, (_, f) => {
    if (!MATH_FNS.has(f)) throw new Error(`Math.${f} not allowed`);
    return '0';
  });
  for (const id of stripped.match(/[A-Za-z_]\w*/g) || []) if (!names.includes(id)) throw new Error(`unknown identifier "${id}" in "${expr}"`);
  // eslint-disable-next-line no-new-func
  const val = new Function(...names, `"use strict"; return (${expr});`)(...names.map((n) => vars[n]));
  if (typeof val !== 'number' || !Number.isFinite(val)) throw new Error(`"${expr}" is not a finite number`);
  return val;
}

function checkVerify(v, where, err) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return err(where, 'verify block must be an object');
  for (const k of Object.keys(v)) if (!VERIFY_KEYS.has(k)) err(where, `unknown verify key "${k}"`);
  if (v.system !== undefined) {
    if (!['unique', 'none', 'infinite'].includes(v.kind)) return err(where, 'system block needs kind unique|none|infinite');
    let res;
    try { res = solveSystem(v.system); } catch (e) { return err(where, `system invalid: ${e.message}`); }
    if (res.kind !== v.kind) return err(where, `declared kind "${v.kind}" but the system is "${res.kind}"`);
    if (v.solution !== undefined) {
      if (res.kind !== 'unique' || !Array.isArray(v.solution) || v.solution.length !== res.solution.length) return err(where, 'solution does not match system');
      v.solution.forEach((s, i) => { if (!parseFrac(String(s)).equals(res.solution[i])) err(where, `solution[${i}] should be ${res.solution[i]}`); });
    }
    return;
  }
  let val;
  try { val = evalExpr(v.expr, v.vars); } catch (e) { return err(where, e.message); }
  const tol = v.tol ?? 1e-9;
  const claims = ['equals', 'notEquals', 'gt', 'lt'].filter((k) => v[k] !== undefined);
  if (claims.length !== 1) return err(where, 'verify needs exactly one of equals|notEquals|gt|lt');
  const want = v[claims[0]];
  if (typeof want !== 'number') return err(where, `${claims[0]} must be a number`);
  const ok = { equals: Math.abs(val - want) <= tol, notEquals: Math.abs(val - want) > tol, gt: val > want, lt: val < want }[claims[0]];
  if (!ok) err(where, `"${v.expr}" computes ${val}, claim ${claims[0]} ${want} is false`);
}

export function validateDrills(data, opts = {}) {
  const counts = opts.counts ?? COUNTS;
  const errors = [];
  const push = (id, msg) => errors.push(`${id}: ${msg}`);
  if (!data || typeof data !== 'object') return ['drills: top level must be an object'];
  const lists = {};
  for (const key of ['traps', 'sanity', 'cards']) {
    if (!Array.isArray(data[key])) { errors.push(`drills: "${key}" must be an array`); lists[key] = []; continue; }
    lists[key] = data[key];
    if (data[key].length !== counts[key]) errors.push(`drills: expected ${counts[key]} ${key}, found ${data[key].length}`);
  }
  const ids = new Set();
  const trapIds = new Set();
  const kinds = { traps: 'trap', sanity: 'sanity', cards: 'card' };

  for (const [list, items] of Object.entries(lists)) {
    items.forEach((it, i) => {
      const id = isStr(it?.id) ? it.id : `${list}[${i}]`;
      const err = (w, m) => push(typeof w === 'string' && w !== id ? `${id} ${w}` : id, m);
      if (!it || typeof it !== 'object') return push(id, 'not an object');
      if (!isStr(it.id)) push(id, 'missing id');
      else if (ids.has(it.id)) push(id, 'duplicate id');
      else ids.add(it.id);
      if (it.kind !== kinds[list]) push(id, `kind must be "${kinds[list]}"`);
      if (!TOPICS.includes(it.topic)) push(id, `bad topic "${it.topic}"`);
      if (!Array.isArray(it.tags) || !it.tags.length || it.tags.some((t) => !isStr(t) || !SLUG.test(t))) push(id, 'tags must be a non-empty array of slugs');
      else if (new Set(it.tags).size !== it.tags.length) push(id, 'duplicate tags');

      if (list === 'cards') {
        if (!isStr(it.front) || !isStr(it.back)) push(id, 'front and back are required');
        else if (!hasHeb(it.front) || !hasHeb(it.back)) push(id, 'front and back must contain Hebrew');
        if (it.formulaRef !== undefined && !isStr(it.formulaRef)) push(id, 'formulaRef must be a non-empty string');
        if (it.trapId !== undefined && !SLUG.test(it.trapId || '')) push(id, 'bad trapId');
      } else {
        if (!isStr(it.trapId) || !SLUG.test(it.trapId)) push(id, 'trapId must be a slug');
        else if (list === 'traps') {
          if (trapIds.has(it.trapId)) push(id, `duplicate trapId "${it.trapId}"`);
          trapIds.add(it.trapId);
        }
        if (!isStr(it.question)) push(id, 'question is required');
        else if (!hasHeb(it.question)) push(id, 'question must contain Hebrew');
        if (!isStr(it.explain)) push(id, 'explain is required');
        else if (!hasHeb(it.explain)) push(id, 'explain must contain Hebrew');
        const opts2 = it.options;
        if (!Array.isArray(opts2) || opts2.length < 3 || opts2.length > 4 || opts2.some((o) => !isStr(o))) push(id, 'options must be 3-4 non-empty strings');
        else {
          if (new Set(opts2.map(norm)).size !== opts2.length) push(id, 'options must be unique');
          if (!Number.isInteger(it.correct) || it.correct < 0 || it.correct >= opts2.length) push(id, '"correct" must be a single valid option index');
          else if (isStr(it.question)) {
            const ans = norm(opts2[it.correct]);
            if (ans.length >= 4 && norm(it.question).includes(ans)) push(id, 'answer leaked in the question text');
          }
        }
      }
      if (it.verify !== undefined) {
        if (!Array.isArray(it.verify) || !it.verify.length) push(id, 'verify must be a non-empty array');
        else it.verify.forEach((v, j) => checkVerify(v, `verify[${j}]`, err));
      } else if (list === 'sanity') push(id, 'sanity questions need numeric verify');
    });
  }

  // 15 math + 15 physics traps, cards reference known traps, sanity items cover both areas
  const traps = lists.traps.filter((t) => t && TOPICS.includes(t.topic));
  const mathN = traps.filter((t) => MATH.has(t.topic)).length;
  if (lists.traps.length === counts.traps && (mathN !== counts.traps / 2 || traps.length - mathN !== counts.traps / 2)) errors.push(`drills: traps must split ${counts.traps / 2} math / ${counts.traps / 2} physics (found ${mathN} / ${traps.length - mathN})`);
  const known = new Set([...trapIds, ...lists.sanity.map((s) => s?.trapId)]);
  for (const c of lists.cards) if (c && c.trapId !== undefined && !known.has(c.trapId)) push(c.id, `trapId "${c.trapId}" matches no trap or sanity item`);
  return errors;
}

export function loadDrills(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'drills.json');
  const data = loadDrills(file);
  const errors = validateDrills(data);
  if (errors.length) {
    console.error(errors.join('\n'));
    console.error(`FAIL: ${errors.length} problem(s)`);
    process.exit(1);
  }
  const n = data.traps.length + data.sanity.length + data.cards.length;
  const checked = [...data.traps, ...data.sanity, ...data.cards].reduce((s, x) => s + (x.verify?.length || 0), 0);
  console.log(`OK: ${data.traps.length} traps, ${data.sanity.length} sanity, ${data.cards.length} cards (${n} items, ${checked} recomputed claims)`);
}

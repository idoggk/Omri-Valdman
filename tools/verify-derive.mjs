// Independent verifier for the derivation tasks (data/derive-math.json + data/derive-physics.json, 24 tasks).
// Every line of every chain is a machine-readable formula in the parser syntax of js/fbuilder.js (plus log_b(x), ln(x), sum(i;a;b;body)).
//  identity tasks: every checkpoint line must be TRUE at 200 deterministic points (the quantities of the "given laws" are derived
//                  from the free variables by `defs`), so a chain of true lines is a derivation identity; every wrong candidate
//                  must be FALSE at some point and must not be equivalent to the correct line.
//  solve tasks:    consecutive lines are equations in `unknown`; each must have exactly the same solution set as the one before
//                  (roots of both found by scanning, plus random values, at 60 random parameter points), and every wrong
//                  candidate must differ from the line it claims to follow.
// Also: the goal formula equals the last line, 12 tasks per subject, 4-7 checkpoints, 3 wrong candidates with named error types,
// Hebrew notes, 3 key lines that can be typed, no duplicate or empty candidates.
// Usage: node tools/verify-derive.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  DATA_FILES, ERR, POINTS, validTask, parseStatement, taskSampler, holdsEverywhere, sameSolutions, sameLine, typeable, hiddenSteps, lineText,
} from '../js/derive.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HEB = /[֐-׿]/;
const flat = (s) => String(s).replace(/\s+/g, '').toLowerCase();

export const loadDeriveFiles = () => DATA_FILES.flatMap((f) => JSON.parse(readFileSync(path.join(ROOT, f), 'utf8')).tasks);

/** Checks one task; pushes messages to `errs`; returns counters. */
export function verifyTask(t, errs) {
  const err = (m) => errs.push(`${t.id}: ${m}`);
  const c = { lines: 0, wrongs: 0, points: 0, solveTests: 0 };
  if (!validTask(t)) { err('invalid task record'); return c; }
  if (![t.title, t.start].every((s) => HEB.test(s))) err('title and start must contain Hebrew');
  let sampler;
  let pts = [];
  try { sampler = taskSampler(t); pts = sampler.points(POINTS); } catch (e) { err(`bad vars/defs/dom: ${e.message}`); return c; }
  c.points = pts.length;
  if (t.mode === 'identity' && pts.length < POINTS) err(`only ${pts.length} valid test points of ${POINTS}`);
  if (t.mode === 'solve' && pts.length < 40) err(`only ${pts.length} valid parameter points`);
  const parse = (label, text) => { try { return parseStatement(text); } catch (e) { err(`${label}: cannot parse "${text}" (${e.message})`); return null; } };
  const seen = new Set();
  let prev = t.startF ? parse('startF', t.startF) : null;
  let prevText = t.startF || null;
  t.steps.forEach((s, i) => {
    const tag = `step ${i}`;
    if (!HEB.test(s.n)) err(`${tag}: note must be Hebrew`);
    if (seen.has(flat(s.f))) err(`${tag}: repeats an earlier line`);
    seen.add(flat(s.f));
    const st = parse(tag, s.f);
    if (!st) return;
    c.lines++;
    if (t.mode === 'identity') {
      const r = holdsEverywhere(st, pts);
      if (!r.ok) err(`${tag}: "${s.f}" is not true at ${JSON.stringify(r.bad)}`);
    } else if (prev) {
      const r = sameSolutions(t, prev, st);
      c.solveTests += r.tested;
      if (!r.ok) err(`${tag}: "${s.f}" does not have the same solutions as "${prevText}" (differs at ${JSON.stringify(r.bad)})`);
      if (r.tested < 60) err(`${tag}: only ${r.tested} solve test points`);
    }
    const ref = t.mode === 'solve' ? (prev || st) : st;
    if (s.s != null && !String(s.s).trim()) err(`${tag}: empty display text`);
    if (/NaN|undefined/.test(lineText(t, s))) err(`${tag}: bad display`);
    const wf = new Set();
    for (const w of s.w) {
      c.wrongs++;
      if (!ERR[w.e]) err(`${tag}: unknown error type "${w.e}"`);
      if (flat(w.f) === flat(s.f) || wf.has(flat(w.f))) err(`${tag}: wrong candidate "${w.f}" duplicates another line`);
      wf.add(flat(w.f));
      const ws = parse(`${tag} wrong`, w.f);
      if (!ws) continue;
      if (t.mode === 'identity') {
        if (holdsEverywhere(ws, pts).ok) err(`${tag}: wrong candidate "${w.f}" is true everywhere (it is not an error)`);
        if (typeable(s)) { try { if (sameLine(t, w.f, s.f)) err(`${tag}: wrong candidate "${w.f}" is accepted as the typed answer`); } catch (e) { err(`${tag}: ${e.message}`); } }
      } else {
        const r = sameSolutions(t, ref, ws);
        c.solveTests += r.tested;
        if (r.ok) err(`${tag}: wrong candidate "${w.f}" has the same solutions as the correct line`);
      }
    }
    prev = st; prevText = s.f;
  });
  const last = t.steps[t.steps.length - 1];
  if (!t.goalF) err('missing goalF');
  else {
    const g = parse('goalF', t.goalF);
    const l = parse('last', last.f);
    if (g && l) {
      if (t.mode === 'solve') { if (!sameSolutions(t, g, l).ok) err('goalF does not match the last line'); }
      else if (typeable(last) ? !sameLine(t, t.goalF, last.f) : false) err('goalF does not match the last line');
      else if (!holdsEverywhere(g, pts).ok) err('goalF is not an identity');
    }
  }
  if (hiddenSteps(t).length < 2) err('fewer than 2 steps can be hidden at level 2');
  return c;
}

/** Validates the whole set; returns { errors, stats }. */
export function validate(tasks = loadDeriveFiles()) {
  const errors = [];
  const stats = { tasks: 0, math: 0, physics: 0, lines: 0, wrongs: 0, identity: 0, solve: 0, solveTests: 0 };
  const ids = new Set();
  for (const t of tasks) {
    stats.tasks++;
    if (ids.has(t.id)) errors.push(`${t.id}: duplicate id`);
    ids.add(t.id);
    if (t.subject === 'math') stats.math++; else if (t.subject === 'physics') stats.physics++;
    if (t.mode === 'identity') stats.identity++; else stats.solve++;
    const c = verifyTask(t, errors);
    stats.lines += c.lines; stats.wrongs += c.wrongs; stats.solveTests += c.solveTests;
  }
  if (stats.math !== 12 || stats.physics !== 12) errors.push(`expected 12 math and 12 physics tasks, found ${stats.math} and ${stats.physics}`);
  return { errors, stats };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const t0 = Date.now();
  const { errors, stats } = validate();
  console.log(`derive: ${stats.tasks} tasks (${stats.math} math, ${stats.physics} physics; ${stats.identity} identity chains, ${stats.solve} solution-set chains)`);
  console.log(`  ${stats.lines} checkpoint lines verified, ${stats.wrongs} wrong candidates refuted, ${stats.solveTests} solution-set test points (${Date.now() - t0} ms)`);
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('OK: every consecutive step and every wrong candidate verified numerically.');
}

// Verifies EVERY statement of the trig teacher (js/trig-data.js) numerically at many random angles:
//  - lesson formulas and every equation in "derive yourself" steps hold (chains A = B = C, and A ⟹ B parts)
//  - fill-the-blank: the right option gives an identity, each other option gives a false statement (also at a=30°, b=60°)
//  - "which is wrong": exactly the marked statement is false, and it also differs at the a=30°, b=60° spot check
//  - proof trainer: the claim holds; each step's correct option equals the previous expression; wrong options do not;
//    "detour" options are true but different text; the last correct expression is the claim's right side
// Usage: node tools/verify-trig.mjs
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  LESSONS, FILL, WRONG, PROOFS, CARDS, ANCHOR_IDS, CHAIN,
} from '../js/trig-data.js';
import {
  isIdentity, isFalse, chainHolds, splitChain, randomAngles, spotAgrees, spotValues, evalExpr, SPOT,
} from '../js/trig.js';

const HEB = /[֐-׿]/;
const ANGLES = randomAngles(200, 987654321);
const norm = (s) => String(s).replace(/\s+/g, '');
const clauses = (eq) => String(eq).split('⟹').map((s) => s.trim());

function spotDiffers(x, y) {
  try { const p = evalExpr(x, SPOT); const q = evalExpr(y, SPOT); return Number.isFinite(p) && Number.isFinite(q) && Math.abs(p - q) > 0.0015; } catch (e) { return false; }
}

export function validate() {
  const errs = [];
  const err = (m) => errs.push(m);
  const stats = { lessons: LESSONS.length, formulas: 0, deriveEqs: 0, fill: FILL.length, wrong: WRONG.length, proofs: PROOFS.length, proofSteps: 0, options: 0, statements: 0 };

  // --- lessons ---
  const ids = new Set();
  if (LESSONS.filter((l) => l.anchor).map((l) => l.id).join() !== ANCHOR_IDS.join()) err('anchors must be exactly pyth, sinsum, cossum');
  for (const l of LESSONS) {
    if (ids.has(l.id)) err(`duplicate lesson ${l.id}`);
    ids.add(l.id);
    if (!HEB.test(l.title) || !HEB.test(l.mnemonic)) err(`${l.id}: title/mnemonic must be Hebrew`);
    if (!l.derive || l.derive.length < 2) err(`${l.id}: needs at least 2 derive steps`);
    for (const f of l.formulas) {
      stats.formulas++;
      stats.statements++;
      if (!chainHolds(f.eq, ANGLES)) err(`${l.id}: formula is not an identity: ${f.eq}`);
      else if (!spotValues(f.eq).includes(null) && !spotAgrees(f.eq)) err(`${l.id}: formula fails the a=30°/b=60° spot check: ${f.eq} -> ${spotValues(f.eq)}`);
    }
    for (const [i, st] of l.derive.entries()) {
      if (!HEB.test(st.say)) err(`${l.id} step ${i + 1}: say must be Hebrew`);
      if (st.eq) {
        stats.deriveEqs++;
        for (const c of clauses(st.eq)) if (!chainHolds(c, ANGLES)) err(`${l.id} step ${i + 1}: not an identity: ${c}`);
      }
    }
    if (l.pattern) for (const row of l.pattern) if (row.length !== 3) err(`${l.id}: pattern rows need 3 cells`);
  }
  const cardIds = new Set(CARDS.map((c) => c.id));
  if (cardIds.size !== CARDS.length) err('duplicate card ids');
  if (CARDS.length < 25) err(`expected at least 25 flashcards, got ${CARDS.length}`);
  for (const link of CHAIN) if (!HEB.test(link.how)) err('chain link text must be Hebrew');

  // --- fill the blank ---
  for (const f of FILL) {
    if (!f.template.includes('?')) err(`${f.id}: template has no ?`);
    if (f.options.length < 3 || f.options.length > 4 || new Set(f.options).size !== f.options.length) err(`${f.id}: need 3-4 distinct options`);
    if (!(f.ans >= 0 && f.ans < f.options.length)) err(`${f.id}: ans out of range`);
    if (!HEB.test(f.tip)) err(`${f.id}: tip must be Hebrew`);
    f.options.forEach((o, i) => {
      stats.options++;
      const eq = f.template.replace('?', o);
      const [l, r] = splitChain(eq);
      if (i === f.ans) {
        if (!isIdentity(l, r, ANGLES)) err(`${f.id}: right option is not an identity: ${eq}`);
      } else {
        if (!isFalse(l, r, ANGLES)) err(`${f.id}: wrong option "${o}" is not clearly false: ${eq}`);
        if (!spotDiffers(l, r)) err(`${f.id}: wrong option "${o}" does not differ at a=30°, b=60°`);
      }
    });
  }

  // --- which is wrong ---
  for (const w of WRONG) {
    if (w.statements.length !== 4) err(`${w.id}: need 4 statements`);
    if (!HEB.test(w.why)) err(`${w.id}: why must be Hebrew`);
    w.statements.forEach((s, i) => {
      stats.statements++;
      const [l, r] = splitChain(s);
      if (i === w.wrong) {
        if (!isFalse(l, r, ANGLES)) err(`${w.id}: the marked statement is not false: ${s}`);
        if (!spotDiffers(l, r)) err(`${w.id}: the false statement agrees at a=30°, b=60°: ${s}`);
      } else {
        if (!isIdentity(l, r, ANGLES)) err(`${w.id}: statement ${i} should be true: ${s}`);
        if (!spotAgrees(s)) err(`${w.id}: true statement fails the spot check: ${s}`);
      }
    });
  }

  // --- proofs ---
  if (PROOFS.length < 12) err(`need at least 12 proofs, got ${PROOFS.length}`);
  const pids = new Set();
  let lastTier = 0;
  for (const p of PROOFS) {
    if (pids.has(p.id)) err(`duplicate proof ${p.id}`);
    pids.add(p.id);
    if (p.tier < lastTier) err(`${p.id}: tiers must not decrease`);
    lastTier = p.tier;
    if (!HEB.test(p.title)) err(`${p.id}: title must be Hebrew`);
    if (!isIdentity(p.lhs, p.rhs, ANGLES)) err(`${p.id}: claim is not an identity`);
    if (p.steps.length < 3) err(`${p.id}: needs at least 3 steps`);
    let cur = p.lhs;
    p.steps.forEach((s, i) => {
      stats.proofSteps++;
      const at = `${p.id} step ${i + 1}`;
      if (!HEB.test(s.hint) || !HEB.test(s.why)) err(`${at}: hint/why must be Hebrew`);
      if (!isIdentity(cur, s.ok, ANGLES)) err(`${at}: correct option is not equal to the previous expression: ${cur}  ->  ${s.ok}`);
      if (norm(cur) === norm(s.ok)) err(`${at}: correct option does not change anything`);
      if (s.bad.length < 1 || s.bad.length > 3) err(`${at}: need 1-3 wrong options`);
      const seen = new Set([norm(s.ok)]);
      for (const b of s.bad) {
        stats.options++;
        if (!HEB.test(b.why)) err(`${at}: wrong-option reason must be Hebrew`);
        if (seen.has(norm(b.to))) err(`${at}: duplicate option ${b.to}`);
        seen.add(norm(b.to));
        if (!isFalse(cur, b.to, ANGLES)) err(`${at}: wrong option is actually valid or unclear: ${cur}  ->  ${b.to}`);
      }
      if (s.detour) {
        stats.options++;
        if (seen.has(norm(s.detour.to))) err(`${at}: duplicate detour`);
        if (!isIdentity(cur, s.detour.to, ANGLES)) err(`${at}: detour option must be a true statement: ${s.detour.to}`);
        if (!HEB.test(s.detour.why)) err(`${at}: detour reason must be Hebrew`);
      }
      cur = s.ok;
    });
    if (norm(cur) !== norm(p.rhs)) err(`${p.id}: last correct expression "${cur}" is not the claim right side "${p.rhs}"`);
  }
  return { errs, stats };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const { errs, stats } = validate();
  if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
  console.log(`trig: ${stats.lessons} lessons, ${stats.formulas} formulas, ${stats.deriveEqs} derivation equations, ${stats.fill} fill-in, ${stats.wrong} which-is-wrong, `
    + `${stats.proofs} proofs (${stats.proofSteps} steps), ${stats.options} options verified at ${ANGLES.length} random angles`);
}

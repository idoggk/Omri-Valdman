// Independent verifier for the notes mode (data/notes.json, 12 cards + 16 questions). It never trusts a stored answer:
//  - every card mini-question and every drill question goes through verifyItem of tools/verify-logs.mjs: the displayed
//    statement is parsed and solved over the real line by scan (roots by sign changes, inequalities and domains by dense
//    sampling around every endpoint, values numerically);
//  - every claim "this expression is positive for every real x" (field `pos`) is checked twice: by exact sign reasoning on
//    a parsed expression tree (a positive base to any power is positive, a sum of positive and non-negative terms is positive ...)
//    and by sampling; every "this factor can change sign" (field `signs`) must be possible by reasoning and visible in samples;
//  - log rules of the cards (field `ver`) are checked as identities at many random points (positives; negatives where claimed);
//  - texts must be Hebrew, ids unique, counts exact.
// Usage: node tools/verify-notes.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { compileExpr } from '../js/mathhard.js';
import { validCard, validQuestion, GROUPS } from '../js/notes.js';
import { verifyItem, identityHolds } from './verify-logs.mjs';

const HEB = /[֐-׿]/;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fin = Number.isFinite;

export const loadNotesFile = () => JSON.parse(readFileSync(path.join(ROOT, 'data/notes.json'), 'utf8'));

/* ---------- exact sign reasoning ---------- */
// A sign set is [canBeNegative, canBeZero, canBePositive].
const POS = [false, false, true];
const ANY = [true, true, true];
const ofNumber = (n) => [n < 0, n === 0, n > 0];
const SIGNS = [-1, 0, 1];
const lift = (a, b, f) => {
  const out = [false, false, false];
  a.forEach((ai, i) => b.forEach((bj, j) => { if (ai && bj) f(SIGNS[i], SIGNS[j]).forEach((s) => { out[s + 1] = true; }); }));
  return out;
};
const addSign = (a, b) => lift(a, b, (p, q) => (p === 0 ? [q] : q === 0 ? [p] : p === q ? [p] : [-1, 0, 1]));
const mulSign = (a, b) => lift(a, b, (p, q) => [p * q]);
const negSign = (a) => [a[2], a[1], a[0]];

/** Parses +, -, *, /, ^, parentheses, numbers and x; returns { sign, value } where value is set for constants. */
export function exactSign(src) {
  const s = String(src).replace(/[·×]/g, '*').replace(/\s+/g, '');
  let i = 0;
  const peek = () => s[i];
  const num = (n) => ({ sign: ofNumber(n), value: n });
  const unknown = () => ({ sign: ANY, value: null });
  function expr() {
    let l = term();
    while (peek() === '+' || peek() === '-') {
      const op = s[i++];
      const r = term();
      const rr = op === '-' ? { sign: negSign(r.sign), value: r.value == null ? null : -r.value } : r;
      l = { sign: addSign(l.sign, rr.sign), value: l.value != null && rr.value != null ? l.value + rr.value : null };
    }
    return l;
  }
  function term() {
    let l = unary();
    while (peek() === '*' || peek() === '/') {
      const op = s[i++];
      const r = unary();
      if (op === '*') l = { sign: mulSign(l.sign, r.sign), value: l.value != null && r.value != null ? l.value * r.value : null };
      else l = { sign: mulSign(l.sign, [r.sign[0], false, r.sign[2]]), value: l.value != null && r.value ? l.value / r.value : null };
    }
    return l;
  }
  function unary() {
    if (peek() === '-') { i++; const v = unary(); return { sign: negSign(v.sign), value: v.value == null ? null : -v.value }; }
    return power();
  }
  function power() {
    const b = atom();
    if (peek() !== '^') return b;
    i++;
    const e = unary();
    const [neg, zero, pos] = b.sign;
    if (!neg && !zero && pos) return { sign: POS, value: b.value != null && e.value != null ? b.value ** e.value : null }; // positive base: any real power
    if (e.value != null && Number.isInteger(e.value) && e.value > 0) {
      const even = e.value % 2 === 0;
      if (even) return { sign: [false, zero, neg || pos], value: b.value != null ? b.value ** e.value : null };
      return { sign: b.sign, value: b.value != null ? b.value ** e.value : null };
    }
    return unknown();
  }
  function atom() {
    if (peek() === '(') { i++; const v = expr(); if (s[i++] !== ')') throw new Error('missing )'); return v; }
    const m = /^\d+(?:\.\d+)?/.exec(s.slice(i));
    if (m) { i += m[0].length; return num(Number(m[0])); }
    if (peek() === 'x') { i++; return unknown(); }
    throw new Error(`cannot parse "${src}" at ${i}`);
  }
  const out = expr();
  if (i !== s.length) throw new Error(`cannot parse "${src}" at ${i}`);
  return out.sign;
}

const GRID = (() => { const g = []; for (let k = -240; k <= 240; k++) g.push(k / 20); for (const e of [-20, -15, 15, 20]) g.push(e); return g; })();

function checkPositive(expr, id, err) {
  let sign;
  try { sign = exactSign(expr); } catch (x) { return err(`${id}: pos "${expr}": ${x.message}`); }
  if (!(sign[2] && !sign[0] && !sign[1])) err(`${id}: "${expr}" is not provably positive for every x (sign set ${JSON.stringify(sign)})`);
  const f = compileExpr(expr);
  for (const x of GRID) {
    const v = f({ x });
    if (fin(v) && !(v > 0)) return err(`${id}: "${expr}" is not positive at x = ${x} (value ${v})`);
    if (!fin(v) && Math.abs(x) <= 12) return err(`${id}: "${expr}" is undefined at x = ${x}`);
  }
}

function checkSigns(expr, id, err) {
  let sign;
  try { sign = exactSign(expr); } catch (x) { return err(`${id}: signs "${expr}": ${x.message}`); }
  if (!(sign[0] && sign[2])) err(`${id}: "${expr}" is claimed to change sign but reasoning says ${JSON.stringify(sign)}`);
  const f = compileExpr(expr);
  const vals = GRID.map((x) => f({ x })).filter(fin);
  if (!(vals.some((v) => v < 0) && vals.some((v) => v > 0))) err(`${id}: "${expr}" does not take both signs on the grid`);
}

/* ---------- the whole data set ---------- */
const mathLike = (s) => /[A-Za-z0-9]/.test(s);

export function validate(data = loadNotesFile()) {
  const errors = [];
  const err = (m) => errors.push(m);
  const stats = { cards: 0, questions: 0, byCheck: {}, pos: 0, signs: 0, ver: 0, byGroup: {}, wrongs: 0 };
  const ids = new Set();
  const uniq = (id) => { if (ids.has(id)) err(`duplicate id ${id}`); ids.add(id); };

  for (const c of data.cards) {
    stats.cards++;
    uniq(c.id);
    stats.byGroup[c.group] = (stats.byGroup[c.group] || 0) + 1;
    if (!validCard(c)) { err(`${c.id}: invalid card record`); continue; }
    if (![c.name, c.rule, c.why, c.trap.right, c.mini.ask].every((s) => HEB.test(s))) err(`${c.id}: card texts must be Hebrew`);
    if (!mathLike(c.trap.wrong)) err(`${c.id}: trap example must be a formula`);
    if (!c.mini.hints.some((s) => HEB.test(s)) || !c.mini.steps.some((s) => HEB.test(s))) err(`${c.id}: mini hints and steps need Hebrew`);
    stats.byCheck[c.mini.check.type] = (stats.byCheck[c.mini.check.type] || 0) + 1;
    verifyItem({ ...c.mini, id: c.id }, err);
    for (const v of c.ver || []) { stats.ver++; const r = identityHolds(v, c.neg === true); if (!r.ok) err(`${c.id}: rule "${v}" is not an identity: ${r.why}`); }
    for (const e of c.pos || []) { stats.pos++; checkPositive(e, c.id, err); }
    for (const e of c.signs || []) { stats.signs++; checkSigns(e, c.id, err); }
  }
  if (data.cards.length !== 12) err(`expected 12 cards, found ${data.cards.length}`);
  for (const g of GROUPS) if ((stats.byGroup[g.id] || 0) < 3) err(`group ${g.id} has fewer than 3 cards`);

  for (const q of data.questions) {
    stats.questions++;
    uniq(q.id);
    if (!validQuestion(q)) { err(`${q.id}: invalid question record`); continue; }
    stats.byCheck[q.check.type] = (stats.byCheck[q.check.type] || 0) + 1;
    stats.wrongs += (q.wrongs || []).length;
    if (!HEB.test(q.ask) || !q.hints.every((s) => HEB.test(s)) || q.steps.filter((s) => HEB.test(s)).length < Math.ceil(q.steps.length / 2)) err(`${q.id}: ask, hints and most steps must be Hebrew`);
    if (q.steps.length < 3 && q.check.type !== 'domain') err(`${q.id}: needs at least 3 worked steps`);
    verifyItem(q, err);
    for (const e of q.pos || []) { stats.pos++; checkPositive(e, q.id, err); }
    for (const e of q.signs || []) { stats.signs++; checkSigns(e, q.id, err); }
  }
  if (data.questions.length !== 16) err(`expected 16 questions, found ${data.questions.length}`);
  // coverage: the exponential-positivity traps need empty-set, all-reals and sign-free cases
  const answers = data.questions.map((q) => JSON.stringify(q.answer));
  if (!answers.some((a) => /"values":\[\]/.test(a) || /"text":"empty"/.test(a))) err('no question has the empty set as its answer');
  if (!answers.some((a) => /\(-inf,inf\)/.test(a))) err('no question has all of R as its answer');
  if (data.questions.filter((q) => (q.pos || []).length).length < 8) err('fewer than 8 questions rest on an exponential-positivity claim');
  if (data.questions.filter((q) => (q.trap && q.trap.kind === 'cases') || /\/\(/.test((q.eq || [''])[0])).length < 4) err('fewer than 4 sign-case questions');
  return { errors, stats };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const t0 = Date.now();
  const { errors, stats } = validate();
  console.log(`notes: ${stats.cards} cards ${JSON.stringify(stats.byGroup)}, ${stats.questions} questions, checks ${JSON.stringify(stats.byCheck)}`);
  console.log(`  ${stats.pos} positivity claims, ${stats.signs} sign-change claims, ${stats.ver} rule identities, ${stats.wrongs} typical wrong answers (${Date.now() - t0} ms)`);
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('OK: every card check, question, positivity claim and log rule verified.');
}
